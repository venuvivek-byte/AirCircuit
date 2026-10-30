// Runs a compiled sketch on one virtual board. Pure: no Three.js, no DOM.
//
// Virtual time: the board's clock (millis) advances when the sketch sleeps (delay, pulseIn) and is
// pulled along to real time when the sketch is busy, so timing code behaves like on hardware.
// Each step runs until the sketch sleeps past `now` or uses up an op budget (busy loops yield).

import { BOARDS, getPinDef, type BoardKind } from '../../components/boards';
import type { CompiledProgram } from './compiler';

export const MODE = { INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, INPUT_PULLDOWN: 3 } as const;

/** How a board's code reaches the circuit (implemented by the electrical model). */
export interface BoardIO {
  /** Logic level of the pin's net; `pull` is the pin's own pull resistor when nothing drives it. */
  digitalRead(pin: string, pull: 'up' | 'down' | null): 0 | 1;
  /** Voltage on the pin's net (0 when floating). */
  analogVolts(pin: string): number;
  /** Echo pulse (µs) an ultrasonic sensor sends back on this pin; 0 = no echo (not wired / not triggered). */
  echoUs(pin: string): number;
}

export class RuntimeError extends Error {}

/** Op budget per step: loop iterations / loop() calls before a busy sketch yields to the app. */
const BUDGET = 4000;
/** If the sketch falls this far behind real time (ms), skip ahead instead of catching up. */
const MAX_LAG_MS = 250;
const UNO_PWM = new Set([3, 5, 6, 9, 10, 11]);

export class BoardRuntime {
  readonly modes = new Map<string, number>();
  /** Output level 0..1 per pin (PWM duty; digital HIGH = 1). */
  readonly duty = new Map<string, number>();
  error: string | null = null;

  /** Virtual time since boot (ms). */
  private t = 0;
  private t0 = 0;
  private booted = false;
  private phase: 'init' | 'setup' | 'loop' = 'init';
  private gen: Generator<number, void> | null = null;
  private prog: ReturnType<CompiledProgram['create']>;
  ops = 0;
  private warned = new Set<string>();
  private adcBits = 12;
  private ledcChannels = new Map<number, { pin: string | null; bits: number }>();
  private ledcPins = new Map<number, number>();
  private seed = 1;

  constructor(
    readonly kind: BoardKind,
    program: CompiledProgram,
    private io: BoardIO,
    private onSerial: (text: string) => void,
  ) {
    this.prog = program.create(new ArduinoApi(this));
  }

  get millis(): number {
    return this.t;
  }

  /** Run the sketch up to wall-clock `now` (ms). */
  step(now: number): void {
    if (this.error) return;
    if (!this.booted) {
      this.booted = true;
      this.t0 = now;
    }
    const target = now - this.t0;
    if (target - this.t > MAX_LAG_MS) this.t = target - MAX_LAG_MS;
    this.ops = 0;
    while (this.t <= target) {
      if (!this.gen) this.gen = this.nextPhase();
      let r: IteratorResult<number, void>;
      try {
        r = this.gen.next();
      } catch (e) {
        this.fail(e);
        return;
      }
      if (r.done) {
        this.gen = null;
        if (++this.ops > BUDGET) {
          this.t = Math.max(this.t, target);
          break;
        }
        continue;
      }
      if (r.value > 0) this.t += r.value;
      else if (this.ops > BUDGET) {
        // Busy sketch: real time passes while it spins.
        this.t = Math.max(this.t, target);
        break;
      }
    }
  }

  private nextPhase(): Generator<number, void> {
    if (this.phase === 'init') {
      this.phase = 'setup';
      return this.prog.init();
    }
    if (this.phase === 'setup') {
      this.phase = 'loop';
      return this.prog.setup();
    }
    return this.prog.loop();
  }

  private fail(e: unknown): void {
    const msg =
      e instanceof RuntimeError ? e.message
      : e instanceof RangeError ? 'stack overflow (a function calls itself forever?)'
      : `internal error: ${(e as Error)?.message ?? e}`;
    this.error = msg;
    this.onSerial(`\n⚠ Runtime error: ${msg}\n`);
  }

  // ---- used by ArduinoApi ----

  serial(text: string): void {
    this.onSerial(text);
  }

  warnOnce(key: string, text: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.onSerial(`⚠ ${text}\n`);
  }

  /** Board pin name for an Arduino pin number, warning once when the simulated board doesn't have it. */
  pin(n: number, what: string): string | null {
    n = Math.trunc(n);
    let name: string | null;
    if (this.kind === 'arduino-uno') name = n >= 0 && n <= 13 ? `D${n}` : n >= 14 && n <= 19 ? `A${n - 14}` : null;
    else name = n >= 0 && n <= 39 ? `GPIO${n}` : null;
    if (!name || !getPinDef(this.kind, name)) {
      this.warnOnce(`pin${n}`, `${what}: pin ${n} is not on the simulated ${BOARDS[this.kind].label}`);
      return name;
    }
    return name;
  }

  analogPin(n: number): string | null {
    n = Math.trunc(n);
    // On the Uno, analogRead(0) means A0.
    if (this.kind === 'arduino-uno' && n >= 0 && n <= 5) n += 14;
    if (this.kind === 'arduino-uno' && (n < 14 || n > 19)) {
      this.warnOnce(`adc${n}`, `analogRead: pin ${n} is not an analog input (use A0-A5)`);
      return null;
    }
    return this.pin(n, 'analogRead');
  }

  setDuty(pin: string, d: number): void {
    this.duty.set(pin, Math.min(1, Math.max(0, d)));
  }

  digitalRead(pin: string): 0 | 1 {
    const m = this.modes.get(pin) ?? MODE.INPUT;
    if (m === MODE.OUTPUT) return (this.duty.get(pin) ?? 0) > 0 ? 1 : 0;
    return this.io.digitalRead(pin, m === MODE.INPUT_PULLUP ? 'up' : m === MODE.INPUT_PULLDOWN ? 'down' : null);
  }

  analogRead(pin: string): number {
    const ref = BOARDS[this.kind].logicLevel;
    const max = this.kind === 'arduino-uno' ? 1023 : (1 << this.adcBits) - 1;
    const v = Math.min(ref, Math.max(0, this.io.analogVolts(pin)));
    return Math.round((v / ref) * max);
  }

  echoUs(pin: string): number {
    return this.io.echoUs(pin);
  }

  setAdcBits(bits: number): void {
    this.adcBits = Math.min(16, Math.max(1, Math.trunc(bits)));
  }

  ledc = { channels: this.ledcChannels, pins: this.ledcPins };

  random(): number {
    // mulberry32, so randomSeed() makes runs repeatable.
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  setSeed(n: number): void {
    this.seed = Math.trunc(n) || 1;
  }

  isUnoPwm(n: number): boolean {
    return UNO_PWM.has(n);
  }
}

/** The `__rt` object compiled sketches call. Method names match what compiler.ts emits. */
class ArduinoApi {
  constructor(private b: BoardRuntime) {}

  // ---- scheduler / language support ----
  tick(): boolean {
    return ++this.b.ops > BUDGET;
  }
  idiv(a: number, b: number): number {
    if (Math.trunc(b) === 0) throw new RuntimeError('division by zero');
    return Math.trunc(Math.trunc(a) / Math.trunc(b));
  }
  imod(a: number, b: number): number {
    if (Math.trunc(b) === 0) throw new RuntimeError('division by zero (modulo)');
    return Math.trunc(a) % Math.trunc(b);
  }
  toInt(x: number): number {
    return Number.isFinite(x) ? Math.trunc(x) : 0;
  }
  idx(arr: unknown[], i: number): number {
    i = Math.trunc(i);
    if (i < 0 || i >= arr.length) throw new RuntimeError(`array index ${i} is out of bounds (the array has ${arr.length} elements)`);
    return i;
  }
  array(n: number, fill: () => unknown): unknown[] {
    n = Math.trunc(n);
    if (!(n > 0)) throw new RuntimeError(`array size must be positive (got ${n})`);
    return Array.from({ length: n }, fill);
  }
  pad(items: unknown[], n: number, fill: () => unknown): unknown[] {
    if (items.length > n) throw new RuntimeError(`too many initializers for an array of ${n}`);
    while (items.length < n) items.push(fill());
    return items;
  }
  String(v: unknown, t: string, arg?: number): string {
    return fmt(v, t, arg, false);
  }
  strToInt(s: string): number {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  strToFloat(s: string): number {
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  }
  charAt(s: string, i: number): number {
    return s.charCodeAt(Math.trunc(i)) || 0;
  }

  // ---- digital / analog I/O ----
  pinMode(n: number, mode: number): void {
    const p = this.b.pin(n, 'pinMode');
    if (p) this.b.modes.set(p, mode);
  }
  digitalWrite(n: number, v: number): void {
    const p = this.b.pin(n, 'digitalWrite');
    if (!p) return;
    if ((this.b.modes.get(p) ?? MODE.INPUT) !== MODE.OUTPUT) {
      this.b.warnOnce(`dw${p}`, `digitalWrite(${n}) before pinMode(${n}, OUTPUT): the pin is not driving anything`);
    }
    this.b.setDuty(p, v ? 1 : 0);
  }
  digitalRead(n: number): number {
    const p = this.b.pin(n, 'digitalRead');
    return p ? this.b.digitalRead(p) : 0;
  }
  analogRead(n: number): number {
    const p = this.b.analogPin(n);
    return p ? this.b.analogRead(p) : 0;
  }
  analogReadResolution(bits: number): void {
    this.b.setAdcBits(bits);
  }
  analogWrite(n: number, v: number): void {
    const p = this.b.pin(n, 'analogWrite');
    if (!p) return;
    this.b.modes.set(p, MODE.OUTPUT);
    const x = Math.min(255, Math.max(0, Math.trunc(v)));
    // Uno pins without PWM act digital: below half is LOW, above is HIGH.
    if (this.b.kind === 'arduino-uno' && !this.b.isUnoPwm(Math.trunc(n))) {
      this.b.warnOnce(`pwm${n}`, `analogWrite: pin ${n} has no PWM on the Uno (use 3, 5, 6, 9, 10 or 11)`);
      this.b.setDuty(p, x >= 128 ? 1 : 0);
    } else this.b.setDuty(p, x / 255);
  }
  tone(n: number): void {
    const p = this.b.pin(n, 'tone');
    if (!p) return;
    this.b.modes.set(p, MODE.OUTPUT);
    this.b.setDuty(p, 0.5);
  }
  noTone(n: number): void {
    const p = this.b.pin(n, 'noTone');
    if (p) this.b.setDuty(p, 0);
  }
  ledcSetup(ch: number, freq: number, bits: number): number {
    this.b.ledc.channels.set(Math.trunc(ch), { pin: null, bits: Math.trunc(bits) });
    return freq;
  }
  ledcAttachPin(n: number, ch: number): void {
    const p = this.b.pin(n, 'ledcAttachPin');
    const c = this.b.ledc.channels.get(Math.trunc(ch));
    if (!c) {
      this.b.warnOnce(`ledc${ch}`, `ledcAttachPin: call ledcSetup(${ch}, freq, bits) first`);
      return;
    }
    c.pin = p;
    if (p) this.b.modes.set(p, MODE.OUTPUT);
  }
  ledcAttach(n: number, _freq: number, bits: number): boolean {
    const p = this.b.pin(n, 'ledcAttach');
    this.b.ledc.pins.set(Math.trunc(n), Math.trunc(bits));
    if (p) this.b.modes.set(p, MODE.OUTPUT);
    return true;
  }
  ledcWrite(chOrPin: number, duty: number): void {
    const k = Math.trunc(chOrPin);
    const bitsForPin = this.b.ledc.pins.get(k);
    if (bitsForPin !== undefined) {
      const p = this.b.pin(k, 'ledcWrite');
      if (p) this.b.setDuty(p, duty / ((1 << bitsForPin) - 1));
      return;
    }
    const c = this.b.ledc.channels.get(k);
    if (!c?.pin) {
      this.b.warnOnce(`ledcw${k}`, `ledcWrite(${k}): channel not attached to a pin`);
      return;
    }
    this.b.setDuty(c.pin, duty / ((1 << c.bits) - 1));
  }

  // ---- time ----
  *delay(ms: number): Generator<number, void> {
    yield Math.max(0, ms);
  }
  *delayMicroseconds(us: number): Generator<number, void> {
    yield Math.max(0, us) / 1000;
  }
  millis(): number {
    return Math.floor(this.b.millis);
  }
  micros(): number {
    return Math.floor(this.b.millis * 1000);
  }
  *pulseIn(n: number, level: number, timeoutUs = 1_000_000): Generator<number, number> {
    const p = this.b.pin(n, 'pulseIn');
    const us = p && level ? this.b.echoUs(p) : 0;
    if (us > 0 && us <= timeoutUs) {
      yield us / 1000;
      return us;
    }
    yield timeoutUs / 1000;
    return 0;
  }

  // ---- NewPing ----
  newNewPing(trig: number, echo: number, maxCm = 500): { trig: number; echo: number; maxCm: number } {
    const t = this.b.pin(trig, 'NewPing');
    if (t) this.b.modes.set(t, MODE.OUTPUT);
    return { trig, echo, maxCm };
  }
  *pingUs(s: { echo: number; maxCm: number }, maxCm?: number): Generator<number, number> {
    const p = this.b.pin(s.echo, 'NewPing');
    const us = p ? this.b.echoUs(p) : 0;
    const limit = (maxCm ?? s.maxCm) * 57;
    yield (us > 0 ? Math.min(us, limit) : limit) / 1000 + 0.05;
    return us > 0 && us <= limit ? us : 0;
  }
  *pingCm(s: { echo: number; maxCm: number }, maxCm?: number): Generator<number, number> {
    return Math.trunc((yield* this.pingUs(s, maxCm)) / 57);
  }
  *pingIn(s: { echo: number; maxCm: number }, maxCm?: number): Generator<number, number> {
    return Math.trunc((yield* this.pingUs(s, maxCm)) / 146);
  }

  // ---- maths ----
  map(x: number, a: number, b: number, c: number, d: number): number {
    if (b === a) throw new RuntimeError('map(): input range is empty (division by zero)');
    return Math.trunc(((x - a) * (d - c)) / (b - a)) + c;
  }
  constrain(x: number, lo: number, hi: number): number {
    return x < lo ? lo : x > hi ? hi : x;
  }
  min(a: number, b: number): number {
    return Math.min(a, b);
  }
  max(a: number, b: number): number {
    return Math.max(a, b);
  }
  abs(x: number): number {
    return Math.abs(x);
  }
  sq(x: number): number {
    return x * x;
  }
  pow(a: number, b: number): number {
    return Math.pow(a, b);
  }
  sqrt(x: number): number {
    return Math.sqrt(x);
  }
  sin(x: number): number {
    return Math.sin(x);
  }
  cos(x: number): number {
    return Math.cos(x);
  }
  tan(x: number): number {
    return Math.tan(x);
  }
  atan(x: number): number {
    return Math.atan(x);
  }
  atan2(y: number, x: number): number {
    return Math.atan2(y, x);
  }
  exp(x: number): number {
    return Math.exp(x);
  }
  log(x: number): number {
    return Math.log(x);
  }
  log10(x: number): number {
    return Math.log10(x);
  }
  floor(x: number): number {
    return Math.floor(x);
  }
  ceil(x: number): number {
    return Math.ceil(x);
  }
  round(x: number): number {
    return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
  }
  random(a: number, b?: number): number {
    const [lo, hi] = b === undefined ? [0, a] : [a, b];
    if (hi <= lo) return lo;
    return lo + Math.floor(this.b.random() * (hi - lo));
  }
  randomSeed(n: number): void {
    this.b.setSeed(n);
  }
  isnan(x: number): boolean {
    return Number.isNaN(x);
  }
  isinf(x: number): boolean {
    return x === Infinity || x === -Infinity;
  }
  bitRead(x: number, n: number): number {
    return (x >> n) & 1;
  }
  bit(n: number): number {
    return 1 << n;
  }
  lowByte(x: number): number {
    return x & 0xff;
  }
  highByte(x: number): number {
    return (x >> 8) & 0xff;
  }

  // ---- Serial ----
  serialBegin(): void {}
  print(v: unknown, t: string, f?: number): number {
    const s = fmt(v, t, f, true);
    this.b.serial(s);
    return s.length;
  }
  println(v?: unknown, t?: string, f?: number): number {
    const s = (v === undefined ? '' : fmt(v, t ?? 'string', f, true)) + '\n';
    this.b.serial(s);
    return s.length;
  }
  printf(format: string, ...args: unknown[]): number {
    const s = printf(format, args);
    this.b.serial(s);
    return s.length;
  }
  serialWrite(c: number): number {
    this.b.serial(String.fromCharCode(c));
    return 1;
  }
  serialAvailable(): number {
    return 0;
  }
  serialRead(): number {
    return -1;
  }
  serialFlush(): void {}
}

/** Arduino formatting: floats with 2 decimals, bools as 1/0, chars as characters. `upper` = Serial (HEX in caps). */
function fmt(v: unknown, t: string, arg: number | undefined, upper: boolean): string {
  switch (t) {
    case 'string':
      return String(v);
    case 'char':
      return String.fromCharCode(Number(v));
    case 'bool':
      return v ? '1' : '0';
    case 'float': {
      const n = Number(v);
      if (Number.isNaN(n)) return 'nan';
      if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf';
      return n.toFixed(arg ?? 2);
    }
    default: {
      const n = Math.trunc(Number(v));
      if (arg === 2 || arg === 8 || arg === 16) {
        const s = (n < 0 ? n >>> 0 : n).toString(arg);
        return upper ? s.toUpperCase() : s;
      }
      return String(n);
    }
  }
}

/** Minimal printf: %d %i %u %l* %f %.Nf %s %c %x %X %%, with width / zero-pad. */
function printf(format: string, args: unknown[]): string {
  let i = 0;
  return format.replace(/%([-0]?)(\d*)(?:\.(\d+))?(l{0,2})([diufscxX%])/g, (_m, flag: string, width: string, prec: string, _l, conv: string) => {
    if (conv === '%') return '%';
    const a = args[i++];
    let s: string;
    switch (conv) {
      case 'f':
        s = Number(a).toFixed(prec === undefined ? 6 : Number(prec));
        break;
      case 's':
        s = String(a);
        break;
      case 'c':
        s = typeof a === 'number' ? String.fromCharCode(a) : String(a);
        break;
      case 'x':
      case 'X':
        s = (Math.trunc(Number(a)) >>> 0).toString(16);
        if (conv === 'X') s = s.toUpperCase();
        break;
      case 'u':
        s = String(Math.trunc(Number(a)) >>> 0);
        break;
      default:
        s = String(Math.trunc(Number(a)));
    }
    const w = Number(width || 0);
    if (s.length < w) s = flag === '-' ? s.padEnd(w) : s.padStart(w, flag === '0' ? '0' : ' ');
    return s;
  });
}

import { describe, expect, it } from 'vitest';
import type { BoardKind } from '../src/components/boards';
import { QUIET_ENV, type SensorEnv } from '../src/components/sensors';
import { compile } from '../src/sim/arduino/compiler';
import { presets } from '../src/sim/arduino/presets';
import { Machine } from '../src/sim/machine';
import { buildNetlist } from '../src/sim/netlist';
import type { Circuit, Connection, SimComponent } from '../src/sim/types';

const p = (componentId: string, pin: string) => ({ componentId, pin });
const wire = (a: [string, string], b: [string, string]): Connection => ({ a: p(...a), b: p(...b) });

/** Compile `src` for a board, run it for `ms` (in 1 ms frames), return the serial output. */
function run(src: string, ms = 50, kind: BoardKind = 'arduino-uno', extra: SimComponent[] = [], conns: Connection[] = [], env = new Map<string, SensorEnv>()) {
  const r = compile(src, kind);
  if (!r.ok) throw new Error(`compile failed: ${JSON.stringify(r.errors)}`);
  const circuit: Circuit = { components: [{ id: 'b', type: 'board', boardKind: kind }, ...extra], connections: conns };
  const net = buildNetlist(circuit);
  const m = new Machine();
  m.upload('b', r.program);
  let out = m.step(0, circuit, net, env);
  for (let t = 1; t <= ms; t++) out = m.step(t, circuit, net, env);
  return { log: m.serialLog('b').replace(/^\n--- upload complete, board reset ---\n/, ''), out, m, circuit, net };
}

const sketch = (setup: string, loop = '') => `void setup() { Serial.begin(9600); ${setup} }\nvoid loop() { ${loop} delay(1000); }`;

describe('compiler: language', () => {
  it('compiles every preset on both boards', () => {
    for (const kind of ['arduino-uno', 'esp32'] as const) {
      for (const pr of presets(kind)) {
        const r = compile(pr.code, kind);
        expect(r.ok ? 'ok' : `${pr.id}: ${JSON.stringify(r.errors)}`).toBe('ok');
      }
    }
  });

  it('integer division truncates, float division does not', () => {
    const { log } = run(sketch('int a = 7; int b = 2; float f = 7; Serial.println(a / b); Serial.println(f / b); Serial.println(-7 / 2); Serial.println(7 % 3);'));
    expect(log).toBe('3\n3.50\n-3\n1\n');
  });

  it('assigning a float to an int truncates; prints follow Arduino formatting', () => {
    const { log } = run(
      sketch('int x = 2.9; float y = 1.0 / 3; bool t = true; char c = 65; Serial.println(x); Serial.println(y); Serial.println(y, 4); Serial.println(t); Serial.println(c); Serial.println(255, HEX); Serial.println(5, BIN);'),
    );
    expect(log).toBe('2\n0.33\n0.3333\n1\nA\nFF\n101\n');
  });

  it('String concatenation and methods', () => {
    const { log } = run(
      sketch('String s = "Temp: "; s += 21.5; s = s + " C"; Serial.println(s); Serial.println(s.length()); String n = "42"; Serial.println(n.toInt() + 1); s.toUpperCase(); Serial.println(s); Serial.println(String(10) + String(3.14159, 3));'),
    );
    expect(log).toBe('Temp: 21.50 C\n13\n43\nTEMP: 21.50 C\n103.142\n');
  });

  it('functions, recursion, arrays, sizeof, switch, ternary, #define, static locals', () => {
    const src = `
#define N 5
int vals[N] = {3, 1, 4};
int fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }
int counter() { static int c = 0; c++; return c; }
void setup() {
  Serial.begin(9600);
  Serial.println(fact(5));
  int sum = 0;
  for (int i = 0; i < sizeof(vals) / sizeof(vals[0]); i++) sum += vals[i];
  Serial.println(sum);
  counter(); counter();
  Serial.println(counter());
  int grid[2][3];
  grid[1][2] = 9;
  Serial.println(grid[1][2] + grid[0][0]);
  switch (sum) {
    case 8: Serial.println("eight"); break;
    default: Serial.println("other");
  }
  unsigned long t = millis();
  Serial.println(t < 10 ? "early" : "late");
}
void loop() {}
`;
    expect(run(src).log).toBe('120\n8\n3\n9\neight\nearly\n');
  });

  it('while / do-while / break / continue / compound operators / printf', () => {
    const src = sketch(
      'int i = 0; int s = 0; while (true) { i++; if (i % 2 == 0) continue; if (i > 9) break; s += i; } Serial.println(s); int k = 3; do { k--; } while (k > 0); Serial.println(k); int b = 6; b <<= 2; b |= 1; Serial.println(b); Serial.printf("v=%d f=%.1f %s\\n", 7, 2.25, "ok");',
    );
    expect(run(src).log).toBe('25\n0\n25\nv=7 f=2.3 ok\n');
  });
});

describe('compiler: errors', () => {
  const err = (src: string, kind: BoardKind = 'arduino-uno') => {
    const r = compile(src, kind);
    if (r.ok) throw new Error('expected a compile error');
    return r.errors[0];
  };

  it('missing semicolon points at the line', () => {
    const e = err('void setup() {\n  int x = 1\n  x++;\n}\nvoid loop() {}');
    expect(e.line).toBe(2);
    expect(e.message).toMatch(/expected ';'/);
  });

  it('undeclared names, typos in built-ins and missing loop()', () => {
    expect(err('void setup() { y = 1; }\nvoid loop() {}').message).toBe("'y' was not declared in this scope");
    expect(err('void setup() { digitalWrte(13, HIGH); }\nvoid loop() {}').message).toBe("'digitalWrte' was not declared in this scope");
    expect(err('void setup() {}').message).toMatch(/loop/);
  });

  it('unknown libraries and unsupported features are explained', () => {
    expect(err('#include <WiFi.h>\nvoid setup() {}\nvoid loop() {}', 'esp32').message).toMatch(/not available.*networking/);
    expect(err('void setup() { int *p; }\nvoid loop() {}').message).toMatch(/pointers/);
    expect(err('void setup() { ledcWrite(0, 1); }\nvoid loop() {}').message).toMatch(/not declared/);
  });

  it('wrong argument counts', () => {
    expect(err('void setup() { pinMode(13); }\nvoid loop() {}').message).toBe("too few arguments to function 'pinMode'");
    expect(err('int f(int a) { return a; }\nvoid setup() { f(1, 2); }\nvoid loop() {}').message).toBe("too many arguments to function 'f'");
  });
});

describe('runtime', () => {
  it('a busy loop without delay does not hang the app and millis keeps up with real time', () => {
    const { m } = run('void setup() {}\nvoid loop() { int x = 0; while (x < 1000000) x++; }', 30);
    expect(m.millis('b')).toBeGreaterThanOrEqual(29);
  });

  it('runtime errors stop the board with a message', () => {
    const { log, m } = run(sketch('int a[3]; a[5] = 1;'));
    expect(log).toMatch(/Runtime error: array index 5 is out of bounds/);
    expect(m.runtimeError('b')).toMatch(/out of bounds/);
    expect(run(sketch('int z = 0; Serial.println(10 / z);')).log).toMatch(/division by zero/);
  });

  it('delay advances millis exactly', () => {
    const { log } = run('void setup() { Serial.begin(9600); delay(20); Serial.println(millis()); }\nvoid loop() {}', 40);
    expect(log).toBe('20\n');
  });
});

describe('machine + circuit', () => {
  // Uno D13 -> resistor -> LED -> GND
  const ledParts: SimComponent[] = [{ id: 'r', type: 'resistor' }, { id: 'led', type: 'led' }];
  const ledWires = (pin: string) => [wire(['b', pin], ['r', 'a']), wire(['r', 'b'], ['led', 'anode']), wire(['led', 'cathode'], ['b', 'GND'])];

  it('the default Blink blinks the built-in LED and an LED on D13', () => {
    const circuit: Circuit = { components: [{ id: 'b', type: 'board', boardKind: 'arduino-uno' }, ...ledParts], connections: ledWires('D13') };
    const net = buildNetlist(circuit);
    const m = new Machine();
    m.start();
    const env = new Map<string, SensorEnv>();
    m.step(0, circuit, net, env);
    expect(m.step(100, circuit, net, env).leds.get('led')).toBe(1);
    expect(m.step(100, circuit, net, env).builtin.get('b')).toBe(true);
    expect(m.step(600, circuit, net, env).leds.get('led')).toBe(0);
    expect(m.step(1100, circuit, net, env).leds.get('led')).toBe(1);
    m.stop();
    expect(m.step(1200, circuit, net, env).leds.get('led')).toBe(0);
  });

  it('analogWrite dims an LED on a PWM pin', () => {
    const { out } = run('void setup() { analogWrite(9, 64); }\nvoid loop() {}', 5, 'arduino-uno', ledParts, ledWires('D9'));
    expect(out.leds.get('led')).toBeCloseTo(64 / 255, 5);
  });

  it('IR sensor: OUT is LOW only with an obstacle, and only when powered', () => {
    const ir: SimComponent = { id: 'ir', type: 'sensor', sensorKind: 'ir' };
    const powered = [wire(['ir', 'VCC'], ['b', '5V']), wire(['ir', 'GND'], ['b', 'GND']), wire(['ir', 'OUT'], ['b', 'D7'])];
    const src = 'void setup() { Serial.begin(9600); pinMode(7, INPUT); }\nvoid loop() { Serial.println(digitalRead(7)); delay(10); }';
    const near = new Map([['ir', { ...QUIET_ENV, obstacle: true }]]);
    expect(run(src, 5, 'arduino-uno', [ir], powered, near).log).toBe('0\n');
    expect(run(src, 5, 'arduino-uno', [ir], powered).log).toBe('1\n');
    // Unpowered module: the pin floats (reads LOW without a pull-up), and the module shows unpowered.
    const r = run(src, 5, 'arduino-uno', [ir], [wire(['ir', 'OUT'], ['b', 'D7'])], near);
    expect(r.out.sensors.get('ir')).toEqual({ powered: false, active: false });
  });

  it('ultrasonic preset measures the distance to the hand', () => {
    const us: SimComponent = { id: 'us', type: 'sensor', sensorKind: 'ultrasonic' };
    const conns = [
      wire(['us', 'VCC'], ['b', '5V']), wire(['us', 'GND'], ['b', 'GND']),
      wire(['us', 'TRIG'], ['b', 'D9']), wire(['us', 'ECHO'], ['b', 'D10']),
    ];
    const src = presets('arduino-uno').find((x) => x.id === 'ultrasonic')!.code;
    const env = new Map([['us', { ...QUIET_ENV, distanceCm: 20 }]]);
    const { log, out } = run(src, 30, 'arduino-uno', [us], conns, env);
    expect(log.split('\n')[0]).toBe('Distance: 19.72 cm');
    expect(out.builtin.get('b')).toBe(false);

    // ECHO not wired: pulseIn times out after 1 s and returns 0.
    const r = run(src, 30, 'arduino-uno', [us], conns.slice(0, 3), env);
    expect(r.log).toBe('');
  });

  it('gas sensor analog level on an ESP32 (12-bit ADC, 3.3 V)', () => {
    const gas: SimComponent = { id: 'g', type: 'sensor', sensorKind: 'gas' };
    const conns = [wire(['g', 'VCC'], ['b', '3V3']), wire(['g', 'GND'], ['b', 'GND']), wire(['g', 'AO'], ['b', 'GPIO35'])];
    const src = 'void setup() { Serial.begin(115200); Serial.println(analogRead(35)); }\nvoid loop() {}';
    const env = new Map([['g', { ...QUIET_ENV, gas: 1 }]]);
    expect(run(src, 2, 'esp32', [gas], conns, env).log).toBe(`${Math.round(0.95 * 4095)}\n`);
    expect(run(src, 2, 'esp32', [gas], conns).log).toBe(`${Math.round(0.05 * 4095)}\n`);
  });

  it('INPUT_PULLUP reads HIGH when floating and LOW when tied to GND', () => {
    const src = 'void setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); pinMode(3, INPUT_PULLUP); Serial.println(digitalRead(2)); Serial.println(digitalRead(3)); }\nvoid loop() {}';
    expect(run(src, 2, 'arduino-uno', [], [wire(['b', 'D3'], ['b', 'GND'])]).log).toBe('1\n0\n');
  });
});

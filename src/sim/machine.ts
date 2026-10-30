// Runs every board's program against the circuit (pure: no Three.js, no DOM).
// Run powers all boards (as if on USB) and boots their programs; Stop powers them off; uploading a
// sketch reboots that board with the new program. Boards without an upload run Blink.

import type { BoardKind } from '../components/boards';
import type { SensorEnv, SensorKind } from '../components/sensors';
import { compile, type CompiledProgram } from './arduino/compiler';
import { presets } from './arduino/presets';
import { BoardRuntime, MODE, type BoardIO } from './arduino/runtime';
import { Electrical, type BoardPinState } from './electrical';
import type { Netlist } from './netlist';
import type { Circuit } from './types';

export interface MachineOutputs {
  /** LED id -> brightness 0..1. */
  leds: Map<string, number>;
  /** Board id -> on-board LED (LED_BUILTIN) lit. */
  builtin: Map<string, boolean>;
  sensors: Map<string, { powered: boolean; active: boolean }>;
}

const BUILTIN_PIN: Record<BoardKind, string> = { 'arduino-uno': 'D13', esp32: 'GPIO2' };
const MAX_LOG = 20_000;

const defaults = new Map<BoardKind, CompiledProgram>();
function defaultProgram(kind: BoardKind): CompiledProgram {
  let p = defaults.get(kind);
  if (!p) {
    const r = compile(presets(kind)[0].code, kind);
    if (!r.ok) throw new Error(`default sketch failed to compile: ${r.errors[0].message}`);
    defaults.set(kind, (p = r.program));
  }
  return p;
}

export class Machine {
  running = false;
  private runtimes = new Map<string, BoardRuntime>();
  private programs = new Map<string, CompiledProgram>();
  private logs = new Map<string, string>();
  private elec: Electrical | null = null;

  start(): void {
    this.running = true;
  }

  /** Power off: programs stop and restart from setup() on the next Run. */
  stop(): void {
    this.running = false;
    this.runtimes.clear();
  }

  reset(): void {
    this.stop();
    this.programs.clear();
    this.logs.clear();
  }

  /** Flash a program onto a board and boot it (powering the circuit, like plugging in USB). */
  upload(boardId: string, program: CompiledProgram, boot = true): void {
    this.programs.set(boardId, program);
    this.runtimes.delete(boardId);
    // Loading a saved circuit only stores the sketch: it runs on the next Run.
    if (!boot) return;
    this.appendLog(boardId, '\n--- upload complete, board reset ---\n');
    this.running = true;
  }

  /** Source of the program a board runs (its upload, else Blink). */
  sourceFor(boardId: string, kind: BoardKind): string {
    return (this.programs.get(boardId) ?? defaultProgram(kind)).source;
  }

  /** Source uploaded to a board, or null while it runs the default Blink. */
  uploadedSource(boardId: string): string | null {
    return this.programs.get(boardId)?.source ?? null;
  }

  serialLog(boardId: string): string {
    return this.logs.get(boardId) ?? '';
  }

  clearLog(boardId: string): void {
    this.logs.delete(boardId);
  }

  runtimeError(boardId: string): string | null {
    return this.runtimes.get(boardId)?.error ?? null;
  }

  millis(boardId: string): number | null {
    const r = this.runtimes.get(boardId);
    return r ? r.millis : null;
  }

  private appendLog(boardId: string, text: string): void {
    let log = (this.logs.get(boardId) ?? '') + text;
    if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG * 0.75);
    this.logs.set(boardId, log);
  }

  step(now: number, circuit: Circuit, netlist: Netlist, env: Map<string, SensorEnv>): MachineOutputs {
    const boards = circuit.components.filter((c) => c.type === 'board' && c.boardKind);
    const ids = new Set(boards.map((b) => b.id));
    for (const id of [...this.runtimes.keys()]) if (!ids.has(id)) this.runtimes.delete(id);
    for (const id of [...this.programs.keys()]) if (!ids.has(id)) this.programs.delete(id);

    if (this.running) {
      for (const b of boards) {
        if (this.runtimes.has(b.id)) continue;
        const kind = b.boardKind!;
        const io: BoardIO = {
          digitalRead: (pin, pull) => this.elec?.digitalRead(b.id, pin, pull) ?? 0,
          analogVolts: (pin) => this.elec?.analogVolts(b.id, pin) ?? 0,
          echoUs: (pin) => this.elec?.echoUs(b.id, pin) ?? 0,
        };
        const program = this.programs.get(b.id) ?? defaultProgram(kind);
        this.runtimes.set(b.id, new BoardRuntime(kind, program, io, (t) => this.appendLog(b.id, t)));
      }
    }

    const states = new Map<string, BoardPinState>();
    for (const [id, r] of this.runtimes) states.set(id, { kind: r.kind, modes: r.modes, duty: r.duty });
    // Pin states are live maps, so reads during the step see writes made earlier in it.
    this.elec = new Electrical(circuit, netlist, states, env, this.running);
    if (this.running) for (const r of this.runtimes.values()) r.step(now);

    const builtin = new Map<string, boolean>();
    for (const b of boards) {
      const r = this.runtimes.get(b.id);
      const pin = BUILTIN_PIN[b.boardKind!];
      builtin.set(b.id, !!r && r.modes.get(pin) === MODE.OUTPUT && (r.duty.get(pin) ?? 0) > 0);
    }
    const sensors = new Map<string, { powered: boolean; active: boolean }>();
    for (const c of circuit.components) {
      if (c.type === 'sensor' && c.sensorKind) sensors.set(c.id, this.elec.sensorState(c.id, c.sensorKind as SensorKind));
    }
    return { leds: this.elec.ledBrightness(), builtin, sensors };
  }
}

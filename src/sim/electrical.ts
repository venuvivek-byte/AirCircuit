// Logic-level electrical model for running programs (pure: no Three.js, no DOM).
//
// Sources are board power / ground pins (while running), board GPIOs set to OUTPUT, and powered
// sensor outputs. A net's voltage comes from sources on the same net, else from sources reached
// through resistors (pull-ups / pull-downs), else it floats. An LED lights when its anode's
// resistor-bridged net has a source >= 1.8 V and its cathode's has a 0 V sink; brightness = the
// source's duty (PWM). A sensor module is powered when VCC sees a board supply and GND a ground.

import { BOARDS, type BoardKind, type BoardPinDef } from '../components/boards';
import { GAS_DO_THRESHOLD, SENSORS, SOUND_DO_THRESHOLD, QUIET_ENV, type SensorEnv, type SensorKind, type SensorPinRole } from '../components/sensors';
import type { Netlist } from './netlist';
import { bridgeResistors, type BridgedNetOf } from './simulator';
import { MODE } from './arduino/runtime';
import type { Circuit, PinRef } from './types';

export interface BoardPinState {
  kind: BoardKind;
  modes: Map<string, number>;
  duty: Map<string, number>;
}

type Source =
  | { kind: 'board'; ref: PinRef; net: string; bridged: string; boardId: string; def: BoardPinDef; board: BoardKind }
  | { kind: 'sensor'; ref: PinRef; net: string; bridged: string; sensorId: string; sensor: SensorKind; role: SensorPinRole };

const LED_MIN_VOLTS = 1.8;
/** Ultrasonic echo when nothing is in range (HC-SR04 times out at ~38 ms). */
const NO_ECHO_US = 38_000;

export class Electrical {
  private bridged: BridgedNetOf;
  private sources: Source[] = [];
  private byNet = new Map<string, Source[]>();
  private byBridged = new Map<string, Source[]>();

  constructor(
    private circuit: Circuit,
    private netlist: Netlist,
    /** Pin states of running boards (absent = not running). */
    private boards: Map<string, BoardPinState>,
    private env: Map<string, SensorEnv>,
    /** Boards are powered (the simulation is running). */
    private powered: boolean,
  ) {
    this.bridged = bridgeResistors(circuit, netlist);
    for (const c of circuit.components) {
      if (c.type === 'board' && c.boardKind) {
        for (const def of BOARDS[c.boardKind].pins) this.add({ kind: 'board', ...this.at(c.id, def.name), boardId: c.id, def, board: c.boardKind });
      } else if (c.type === 'sensor' && c.sensorKind) {
        for (const p of SENSORS[c.sensorKind].pins) {
          if (p.role === 'out' || p.role === 'aout') {
            this.add({ kind: 'sensor', ...this.at(c.id, p.name), sensorId: c.id, sensor: c.sensorKind, role: p.role });
          }
        }
      }
    }
  }

  private at(componentId: string, pin: string): { ref: PinRef; net: string; bridged: string } {
    const ref = { componentId, pin };
    return { ref, net: this.netlist.netOf(ref), bridged: this.bridged(ref) };
  }

  private add(s: Source): void {
    this.sources.push(s);
    for (const [map, key] of [[this.byNet, s.net], [this.byBridged, s.bridged]] as const) {
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(s);
    }
  }

  /** Live voltage a source drives, or null when it isn't driving. */
  private volts(s: Source): number | null {
    if (s.kind === 'board') {
      if (!this.powered) return null;
      if (s.def.role === 'power') return s.def.voltage ?? BOARDS[s.board].logicLevel;
      if (s.def.role === 'ground') return 0;
      const st = this.boards.get(s.boardId);
      if (!st || (st.modes.get(s.def.name) ?? MODE.INPUT) !== MODE.OUTPUT) return null;
      return (st.duty.get(s.def.name) ?? 0) > 0 ? BOARDS[s.board].logicLevel : 0;
    }
    const vcc = this.sensorVcc(s.sensorId);
    if (vcc === null) return null;
    const e = this.env.get(s.sensorId) ?? QUIET_ENV;
    switch (s.sensor) {
      case 'ir':
        return e.obstacle ? 0 : vcc;
      case 'sound':
        return s.role === 'out' ? (e.sound > SOUND_DO_THRESHOLD ? vcc : 0) : vcc * (0.05 + 0.9 * e.sound);
      case 'gas':
        return s.role === 'out' ? (e.gas > GAS_DO_THRESHOLD ? 0 : vcc) : vcc * (0.05 + 0.9 * e.gas);
      default:
        return null;
    }
  }

  /** PWM duty of a source (how bright an LED it feeds glows). */
  private duty(s: Source, v: number): number {
    if (s.kind === 'board') {
      if (s.def.role !== 'gpio') return 1;
      return this.boards.get(s.boardId)?.duty.get(s.def.name) ?? 0;
    }
    const vcc = this.sensorVcc(s.sensorId) ?? 1;
    return Math.min(1, v / vcc);
  }

  /** Resolved voltage of a set of sources: null = floating; a short (0 V + supply) reads as 0 V. */
  private resolve(list: Source[] | undefined, exclude?: PinRef, boardsOnly = false): number | null {
    let max: number | null = null;
    let low = false;
    for (const s of list ?? []) {
      if (boardsOnly && s.kind !== 'board') continue;
      if (exclude && s.ref.componentId === exclude.componentId && s.ref.pin === exclude.pin) continue;
      const v = this.volts(s);
      if (v === null) continue;
      if (v === 0) low = true;
      max = max === null ? v : Math.max(max, v);
    }
    return low ? (max === null ? null : 0) : max;
  }

  /** Voltage on a pin's net: directly driven, else via resistors, else null (floating). */
  netVolts(ref: PinRef, boardsOnly = false): number | null {
    return (
      this.resolve(this.byNet.get(this.netlist.netOf(ref)), ref, boardsOnly) ??
      this.resolve(this.byBridged.get(this.bridged(ref)), ref, boardsOnly)
    );
  }

  /** Supply voltage of a sensor module, or null when VCC / GND aren't both connected. */
  sensorVcc(sensorId: string): number | null {
    const c = this.circuit.components.find((x) => x.id === sensorId);
    if (!c?.sensorKind) return null;
    const pins = SENSORS[c.sensorKind].pins;
    const vccPin = pins.find((p) => p.role === 'vcc')!.name;
    const gndPin = pins.find((p) => p.role === 'gnd')!.name;
    const vcc = this.netVolts({ componentId: sensorId, pin: vccPin }, true);
    const gnd = this.netVolts({ componentId: sensorId, pin: gndPin }, true);
    return vcc !== null && vcc > 0 && gnd === 0 ? vcc : null;
  }

  digitalRead(boardId: string, pin: string, pull: 'up' | 'down' | null): 0 | 1 {
    const v = this.netVolts({ componentId: boardId, pin });
    if (v === null) return pull === 'up' ? 1 : 0;
    const kind = this.boards.get(boardId)?.kind ?? 'arduino-uno';
    return v >= BOARDS[kind].logicLevel / 2 ? 1 : 0;
  }

  analogVolts(boardId: string, pin: string): number {
    return this.netVolts({ componentId: boardId, pin }) ?? 0;
  }

  /** Echo time from an ultrasonic module whose ECHO shares the pin's net and whose TRIG is driven by an output. */
  echoUs(boardId: string, pin: string): number {
    const net = this.netlist.netOf({ componentId: boardId, pin });
    for (const c of this.circuit.components) {
      if (c.sensorKind !== 'ultrasonic') continue;
      if (this.netlist.netOf({ componentId: c.id, pin: 'ECHO' }) !== net) continue;
      if (this.sensorVcc(c.id) === null) continue;
      const trigNet = this.netlist.netOf({ componentId: c.id, pin: 'TRIG' });
      const triggered = (this.byNet.get(trigNet) ?? []).some(
        (s) => s.kind === 'board' && s.def.role === 'gpio' && this.boards.get(s.boardId)?.modes.get(s.def.name) === MODE.OUTPUT,
      );
      if (!triggered) continue;
      const d = this.env.get(c.id)?.distanceCm;
      return d == null ? NO_ECHO_US : Math.round(d * 58);
    }
    return 0;
  }

  /** LED id -> brightness 0..1. */
  ledBrightness(): Map<string, number> {
    const out = new Map<string, number>();
    for (const c of this.circuit.components) {
      if (c.type !== 'led') continue;
      const a = this.bridged({ componentId: c.id, pin: 'anode' });
      const k = this.bridged({ componentId: c.id, pin: 'cathode' });
      let b = 0;
      if (a !== k) {
        const sink = (this.byBridged.get(k) ?? []).some((s) => this.volts(s) === 0);
        if (sink) {
          for (const s of this.byBridged.get(a) ?? []) {
            const v = this.volts(s);
            if (v !== null && v >= LED_MIN_VOLTS) b = Math.max(b, this.duty(s, v));
          }
        }
      }
      out.set(c.id, b);
    }
    return out;
  }

  /** Module state for its indicator LEDs: powered, and whether it is currently detecting. */
  sensorState(sensorId: string, kind: SensorKind): { powered: boolean; active: boolean } {
    const powered = this.sensorVcc(sensorId) !== null;
    const e = this.env.get(sensorId) ?? QUIET_ENV;
    const active =
      powered &&
      (kind === 'ir' ? e.obstacle : kind === 'sound' ? e.sound > SOUND_DO_THRESHOLD : kind === 'gas' ? e.gas > GAS_DO_THRESHOLD : e.distanceCm !== null);
    return { powered, active };
  }
}

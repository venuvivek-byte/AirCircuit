// Logic-level simulator (MVP_SPEC §3.5). Pure: no Three.js, no DOM.
//
// The board program is a preset blink: each board's blinkPin toggles HIGH/LOW every
// config.sim.blinkIntervalMs while running. An LED is ON iff, for some board B:
//   1. B.blinkPin reaches the LED anode directly or through one or more resistors,
//   2. the LED cathode reaches a ground pin of B directly or through resistors,
//   3. the blink pin is currently HIGH.
// Resistors are treated as conductors between their two nets ("resistor-bridged" nets).
// LEDs are never conductors, so a reversed LED never lights.
// If anode and cathode end up in the same bridged net (LED shorted out, e.g. by a
// resistor placed across it), the LED is considered OFF.

import { config } from '../config';
import { BOARDS, type BoardDef } from '../components/boards';
import { buildNetlist, type Netlist } from './netlist';
import type { Circuit, PinRef } from './types';

/** HIGH during the first interval, then toggles every interval. */
export function isBlinkHigh(elapsedMs: number, intervalMs: number = config.sim.blinkIntervalMs): boolean {
  if (intervalMs <= 0) return true;
  if (elapsedMs < 0) return false;
  return Math.floor(elapsedMs / intervalMs) % 2 === 0;
}

/** Maps a net id to its resistor-bridged group id (nets joined through resistors share one id). */
export type BridgedNetOf = (ref: PinRef) => string;

/** Builds connectivity over nets where each resistor conducts between its 'a' and 'b' nets. */
export function bridgeResistors(circuit: Circuit, netlist: Netlist): BridgedNetOf {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of circuit.components) {
    if (c.type !== 'resistor') continue;
    const ra = find(netlist.netOf({ componentId: c.id, pin: 'a' }));
    const rb = find(netlist.netOf({ componentId: c.id, pin: 'b' }));
    if (ra === rb) continue;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  }
  return (ref) => find(netlist.netOf(ref));
}

/** Returns the board (id + def) whose blink pin drives this LED, or undefined. */
export function drivingBoard(
  circuit: Circuit,
  netlist: Netlist,
  ledId: string,
  bridged: BridgedNetOf = bridgeResistors(circuit, netlist),
): { id: string; def: BoardDef } | undefined {
  const anode = bridged({ componentId: ledId, pin: 'anode' });
  const cathode = bridged({ componentId: ledId, pin: 'cathode' });
  if (anode === cathode) return undefined;
  for (const c of circuit.components) {
    if (c.type !== 'board' || !c.boardKind) continue;
    const def = BOARDS[c.boardKind];
    if (bridged({ componentId: c.id, pin: def.blinkPin }) !== anode) continue;
    const grounded = def.groundPins.some((g) => bridged({ componentId: c.id, pin: g }) === cathode);
    if (grounded) return { id: c.id, def };
  }
  return undefined;
}

/** LED id -> ON state for the given blink level. */
export function computeLedStates(circuit: Circuit, netlist: Netlist, blinkHigh: boolean): Map<string, boolean> {
  const states = new Map<string, boolean>();
  const bridged = bridgeResistors(circuit, netlist);
  for (const c of circuit.components) {
    if (c.type !== 'led') continue;
    states.set(c.id, blinkHigh && drivingBoard(circuit, netlist, c.id, bridged) !== undefined);
  }
  return states;
}

/** Stateful run/stop/reset wrapper around the pure functions. Time is supplied by the caller. */
export class Simulator {
  private startTime: number | null = null;

  constructor(private readonly intervalMs: number = config.sim.blinkIntervalMs) {}

  get running(): boolean {
    return this.startTime !== null;
  }

  /** Starts (or keeps running). Calling start while running does not restart the blink phase. */
  start(now: number): void {
    if (this.startTime === null) this.startTime = now;
  }

  stop(): void {
    this.startTime = null;
  }

  /** Stops and clears timing; the next start begins with HIGH. */
  reset(): void {
    this.startTime = null;
  }

  /** LED states at time `now`. All LEDs are OFF while not running. */
  step(now: number, circuit: Circuit, netlist: Netlist = buildNetlist(circuit)): Map<string, boolean> {
    if (this.startTime === null) return computeLedStates(circuit, netlist, false);
    return computeLedStates(circuit, netlist, isBlinkHigh(now - this.startTime, this.intervalMs));
  }
}

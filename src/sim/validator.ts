// Rule-based circuit validator ("AI-lite", MVP_SPEC §3.6). Pure: no Three.js, no DOM.
//
// Terminology: a "net" is a set of directly connected pins (wires + breadboard groups).
// A "bridged net" additionally joins nets through resistors (see simulator.bridgeResistors).
// A "source" pin is a board pin with role 'gpio' or 'power'; a "ground" pin has role 'ground'.
//
// Per-LED rules (an LED whose anode and cathode share a bridged net is skipped):
//  - led-reversed (error): the cathode's bridged net contains a source pin and the
//    anode's bridged net contains a ground pin.
//  - open-circuit (error): the anode's bridged net contains a source pin but the
//    cathode's bridged net contains no ground pin.
//  - no-resistor (warning): interpretation — the loop source -> LED -> GND contains no
//    resistor at all, i.e. the anode's DIRECT net contains a source pin AND the cathode's
//    DIRECT net contains a ground pin. A resistor on either side (anode or cathode side)
//    suppresses the warning.
// Global per-net rules (direct nets only; "connected" means wired together, not via a resistor):
//  - short (error): a power pin and a ground pin (any boards) share a net.
//  - esp32-5v (error): a 3.3V-logic board GPIO shares a net with a 5V power pin.
//  - level-mismatch (warning): a 3.3V-logic board GPIO shares a net with a 5V-logic board GPIO.
//  - ok: emitted alone when there are no errors/warnings and at least one LED would light
//    while the blink pin is HIGH. An empty / unwired scene yields [].

import { BOARDS, type BoardKind, type BoardPinDef } from '../components/boards';
import { buildNetlist, type Netlist } from './netlist';
import { bridgeResistors, computeLedStates } from './simulator';
import type { Circuit } from './types';

export interface ValidationMessage {
  level: 'error' | 'warning' | 'ok';
  code: string;
  text: string;
  componentIds?: string[];
}

export const MESSAGES = {
  'no-resistor': 'LED may burn out; add a resistor.',
  'led-reversed': 'LED is reversed (anode/cathode).',
  'open-circuit': 'Circuit is open: cathode not connected to GND.',
  short: 'Short circuit.',
  'esp32-5v': 'ESP32 GPIO is 3.3V only; 5V can damage it.',
  'level-mismatch': 'Level mismatch: use a level shifter or voltage divider.',
  ok: 'Circuit OK.',
} as const;

type Code = keyof typeof MESSAGES;

interface BoardPin {
  boardId: string;
  kind: BoardKind;
  def: BoardPinDef;
  net: string;
  bridged: string;
}

export function validate(circuit: Circuit, netlist: Netlist = buildNetlist(circuit)): ValidationMessage[] {
  const bridgedOf = bridgeResistors(circuit, netlist);
  const messages: ValidationMessage[] = [];
  const seen = new Set<string>();

  const emit = (level: ValidationMessage['level'], code: Code, componentIds: string[], dedupeKey: string): void => {
    const key = `${code}|${dedupeKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    const ids = [...new Set(componentIds)].sort();
    messages.push({ level, code, text: MESSAGES[code], ...(ids.length ? { componentIds: ids } : {}) });
  };

  // Collect every board pin with its net and bridged net.
  const boardPins: BoardPin[] = [];
  for (const c of circuit.components) {
    if (c.type !== 'board' || !c.boardKind) continue;
    for (const def of BOARDS[c.boardKind].pins) {
      const ref = { componentId: c.id, pin: def.name };
      boardPins.push({ boardId: c.id, kind: c.boardKind, def, net: netlist.netOf(ref), bridged: bridgedOf(ref) });
    }
  }
  const isSource = (p: BoardPin) => p.def.role === 'gpio' || p.def.role === 'power';
  const isGround = (p: BoardPin) => p.def.role === 'ground';
  const pinsWhere = (pred: (p: BoardPin) => boolean) => boardPins.filter(pred);

  // ---- Global per-net rules ----
  const byNet = new Map<string, BoardPin[]>();
  for (const p of boardPins) {
    let list = byNet.get(p.net);
    if (!list) byNet.set(p.net, (list = []));
    list.push(p);
  }
  for (const [net, pins] of byNet) {
    const power = pins.filter((p) => p.def.role === 'power');
    const ground = pins.filter(isGround);
    if (power.length && ground.length) {
      emit('error', 'short', [...power, ...ground].map((p) => p.boardId), net);
    }
    const lowGpio = pins.filter((p) => p.def.role === 'gpio' && BOARDS[p.kind].logicLevel < 5);
    if (!lowGpio.length) continue;
    const fiveVolt = pins.filter((p) => p.def.role === 'power' && p.def.voltage === 5);
    if (fiveVolt.length) {
      emit('error', 'esp32-5v', [...lowGpio, ...fiveVolt].map((p) => p.boardId), net);
    }
    const highGpio = pins.filter((p) => p.def.role === 'gpio' && BOARDS[p.kind].logicLevel === 5);
    if (highGpio.length) {
      emit('warning', 'level-mismatch', [...lowGpio, ...highGpio].map((p) => p.boardId), net);
    }
  }

  // ---- Per-LED rules ----
  for (const led of circuit.components) {
    if (led.type !== 'led') continue;
    const anodeRef = { componentId: led.id, pin: 'anode' };
    const cathodeRef = { componentId: led.id, pin: 'cathode' };
    const anodeB = bridgedOf(anodeRef);
    const cathodeB = bridgedOf(cathodeRef);
    if (anodeB === cathodeB) continue;

    const anodeSources = pinsWhere((p) => isSource(p) && p.bridged === anodeB);
    const anodeGrounds = pinsWhere((p) => isGround(p) && p.bridged === anodeB);
    const cathodeSources = pinsWhere((p) => isSource(p) && p.bridged === cathodeB);
    const cathodeGrounds = pinsWhere((p) => isGround(p) && p.bridged === cathodeB);

    if (cathodeSources.length && anodeGrounds.length) {
      emit('error', 'led-reversed', [led.id, ...cathodeSources.map((p) => p.boardId)], led.id);
      continue;
    }
    if (!anodeSources.length) continue;
    if (!cathodeGrounds.length) {
      emit('error', 'open-circuit', [led.id, ...anodeSources.map((p) => p.boardId)], led.id);
      continue;
    }
    const anodeNet = netlist.netOf(anodeRef);
    const cathodeNet = netlist.netOf(cathodeRef);
    const directSource = anodeSources.filter((p) => p.net === anodeNet);
    const directGround = cathodeGrounds.some((p) => p.net === cathodeNet);
    if (directSource.length && directGround) {
      emit('warning', 'no-resistor', [led.id, ...directSource.map((p) => p.boardId)], led.id);
    }
  }

  if (messages.length) return messages;

  const lit = [...computeLedStates(circuit, netlist, true)].filter(([, on]) => on).map(([id]) => id);
  if (!lit.length) return [];
  return [{ level: 'ok', code: 'ok', text: MESSAGES.ok, componentIds: lit.sort() }];
}

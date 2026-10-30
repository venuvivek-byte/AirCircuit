// Saving / loading whole circuits (parts, wires, uploaded sketches) and the ready-made templates.
// Saves live in localStorage; a saved circuit is plain JSON so it survives app updates.

import * as THREE from 'three';
import { Board } from '../components/board';
import { BOARDS, type BoardKind } from '../components/boards';
import type { SceneComponent } from '../components/component';
import { Sensor } from '../components/sensor';
import { isPinEnd, type WireEnd } from '../components/wire';
import { presets } from '../sim/arduino/presets';
import type { PinRef } from '../sim/types';
import type { SpawnKind, World } from './world';

type SavedEnd = { part: number; pin: string } | { point: [number, number, number] };

export interface SavedCircuit {
  name: string;
  /** ms since epoch. */
  savedAt: number;
  parts: Array<{ kind: SpawnKind; x: number; z: number; rotY: number }>;
  wires: Array<{ a: SavedEnd; b: SavedEnd }>;
  /** Part index -> sketch source uploaded to that board. */
  sketches: Record<number, string>;
}

export function kindOf(c: SceneComponent): SpawnKind {
  if (c instanceof Board) return c.def.kind;
  if (c instanceof Sensor) return c.def.kind;
  return c.type as SpawnKind;
}

/** Snapshot of the scene. `sketchFor` gives a board's uploaded source, or null when it runs the default. */
export function serialize(world: World, name: string, sketchFor: (b: Board) => string | null): SavedCircuit {
  const index = new Map(world.components.map((c, i) => [c.id, i]));
  const end = (e: WireEnd): SavedEnd =>
    isPinEnd(e) ? { part: index.get(e.componentId)!, pin: e.pin } : { point: [e.point.x, e.point.y, e.point.z] };
  const sketches: Record<number, string> = {};
  world.components.forEach((c, i) => {
    const s = c instanceof Board ? sketchFor(c) : null;
    if (s) sketches[i] = s;
  });
  return {
    name,
    savedAt: Date.now(),
    parts: world.components.map((c) => ({ kind: kindOf(c), x: c.root.position.x, z: c.root.position.z, rotY: c.root.rotation.y })),
    wires: world.wires.map((w) => ({ a: end(w.a), b: end(w.b) })),
    sketches,
  };
}

/**
 * Replaces the scene with a saved circuit. Breadboards go first so plugged-in parts re-snap into
 * their holes. Returns the new board id for each saved sketch, for the caller to upload.
 */
export function restore(world: World, saved: SavedCircuit): Array<{ boardId: string; source: string }> {
  world.clear();
  const order = saved.parts.map((_, i) => i).sort((i, j) => rank(saved.parts[i].kind) - rank(saved.parts[j].kind));
  const made: SceneComponent[] = [];
  for (const i of order) {
    const p = saved.parts[i];
    const c = world.spawn(p.kind);
    c.root.position.set(p.x, 0, p.z);
    c.root.rotation.set(0, p.rotY, 0);
    world.trySnap(c);
    made[i] = c;
  }
  const end = (e: SavedEnd): WireEnd =>
    'point' in e ? { point: new THREE.Vector3(...e.point) } : { componentId: made[e.part].id, pin: e.pin };
  for (const w of saved.wires) {
    const a = end(w.a);
    const b = end(w.b);
    // A wire needs a pin at its start: flip it when only the far end is plugged in.
    if (isPinEnd(a)) world.addWire(a, b);
    else if (isPinEnd(b)) world.addWire(b, a);
  }
  world.updateWires();
  return Object.entries(saved.sketches)
    .filter(([i]) => made[+i])
    .map(([i, source]) => ({ boardId: made[+i].id, source }));
}

function rank(kind: SpawnKind): number {
  return kind === 'breadboard' ? 0 : kind in BOARDS ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------

const KEY = 'aircircuit.saves';
/** Written when the tab closes (a closing page can't ask for a file name). */
export const AUTOSAVE_NAME = 'Last session (autosave)';

export function listSaves(): SavedCircuit[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedCircuit[];
    return Array.isArray(list) ? list.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

/** Saves under `saved.name`, replacing an older save with the same name. */
export function storeSave(saved: SavedCircuit): boolean {
  try {
    const rest = listSaves().filter((s) => s.name !== saved.name);
    localStorage.setItem(KEY, JSON.stringify([saved, ...rest]));
    return true;
  } catch {
    return false;
  }
}

export function deleteSave(name: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listSaves().filter((s) => s.name !== name)));
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Templates: working circuits built from breadboard holes, so they plug in exactly.
// ---------------------------------------------------------------------------

/** A template wire end: a board pin, or a breadboard hole. */
type TEnd = { board: string } | { hole: string };

export interface Template {
  id: string;
  title: string;
  blurb: string;
  /** How to try it once it's running. */
  tryIt: string;
  board: BoardKind;
  /** Preset sketch id (presets.ts). */
  sketch: string;
  /** Parts plugged into the breadboard: first pin goes into `hole`, legs along +x. */
  parts: Array<{ kind: SpawnKind; hole: string }>;
  wires: Array<[TEnd, TEnd]>;
}

const B = (board: string): TEnd => ({ board });
const H = (hole: string): TEnd => ({ hole });

/** Resistor e5-e9 feeding an LED a9 (anode) / a10 (cathode), cathode column to GND. */
function ledOn(pin: string): Pick<Template, 'parts' | 'wires'> {
  return {
    parts: [
      { kind: 'resistor', hole: 'e5' },
      { kind: 'led', hole: 'a9' },
    ],
    wires: [
      [B(pin), H('c5')],
      [B('GND'), H('d10')],
    ],
  };
}

/** A sensor module in the lower half (f13…) with header wires from row j, plus the D13 LED. */
function withSensor(kind: SpawnKind, pins: string[]): Pick<Template, 'parts' | 'wires'> {
  const led = ledOn('D13');
  return {
    parts: [...led.parts, { kind, hole: 'f13' }],
    wires: [...led.wires, ...pins.map((p, i): [TEnd, TEnd] => [B(p), H(`j${13 + i}`)]).filter(([b]) => (b as { board: string }).board)],
  };
}

export const TEMPLATES: Template[] = [
  {
    id: 'blink', title: 'Blink LED', board: 'arduino-uno', sketch: 'blink',
    blurb: 'D13 → 220 Ω → LED → GND. The classic first circuit.',
    tryIt: 'Press Run: the LED blinks every half second.',
    ...ledOn('D13'),
  },
  {
    id: 'fade', title: 'Fading LED (PWM)', board: 'arduino-uno', sketch: 'fade',
    blurb: 'analogWrite on D9 slowly brightens and dims an LED.',
    tryIt: 'Press Run and watch it breathe.',
    ...ledOn('D9'),
  },
  {
    id: 'ir', title: 'IR proximity light', board: 'arduino-uno', sketch: 'ir',
    blurb: 'FC-51 IR sensor on D7 switches the LED on D13.',
    tryIt: 'Run, then bring your hand close in front of the blue sensor.',
    ...withSensor('ir', ['5V', 'GND2', 'D7']),
  },
  {
    id: 'ultrasonic', title: 'Parking sensor', board: 'arduino-uno', sketch: 'ultrasonic',
    blurb: 'HC-SR04 measures distance; the LED lights closer than 15 cm.',
    tryIt: 'Run, move your hand toward the sensor, open Code (C) for the Serial Monitor.',
    ...withSensor('ultrasonic', ['5V', 'D9', 'D10', 'GND2']),
  },
  {
    id: 'sound', title: 'Clap switch', board: 'arduino-uno', sketch: 'sound',
    blurb: 'KY-038 sound sensor toggles the LED on every loud sound.',
    tryIt: 'Run, then clap (enable the mic) or hold V.',
    ...withSensor('sound', ['A0', 'GND2', '5V', 'D6']),
  },
  {
    id: 'gas', title: 'Gas leak alarm', board: 'arduino-uno', sketch: 'gas',
    blurb: 'MQ-2 analog level on A1; the LED flashes above the limit.',
    tryIt: 'Run, then hold G to leak gas.',
    ...withSensor('gas', ['5V', 'GND2', '', 'A1']),
  },
];

/**
 * Builds a template into an empty scene: breadboard and board at their spawn spots, parts dropped
 * onto their holes and snapped, wires plugged into holes / board pins. Returns the board and sketch.
 */
export function buildTemplate(world: World, t: Template): { boardId: string; source: string } {
  world.clear();
  const bb = world.spawn('breadboard');
  const board = world.spawn(t.board);
  bb.root.updateMatrix();
  for (const p of t.parts) {
    const c = world.spawn(p.kind);
    c.root.rotation.set(0, 0, 0);
    c.root.position.set(0, 0, 0);
    c.root.updateMatrix();
    // Move the part so its first leg sits on the hole, then let snapping plug in the rest.
    const hole = bb.pin(p.hole)!.local.clone().applyMatrix4(bb.root.matrix);
    const leg = c.pins[0].local.clone().applyMatrix4(c.root.matrix);
    c.root.position.set(hole.x - leg.x, 0, hole.z - leg.z);
    if (!world.trySnap(c)) console.warn(`template ${t.id}: ${p.kind} did not plug into ${p.hole}`);
  }
  const ref = (e: TEnd): PinRef => ('board' in e ? { componentId: board.id, pin: e.board } : { componentId: bb.id, pin: e.hole });
  for (const [a, b] of t.wires) world.addWire(ref(a), ref(b));
  const source = presets(t.board).find((p) => p.id === t.sketch)?.code ?? presets(t.board)[0].code;
  return { boardId: board.id, source };
}

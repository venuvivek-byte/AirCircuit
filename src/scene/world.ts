import * as THREE from 'three';
import { config } from '../config';
import { Board } from '../components/board';
import type { BoardKind } from '../components/boards';
import { Breadboard } from '../components/breadboard';
import type { SceneComponent } from '../components/component';
import { Led } from '../components/led';
import { Resistor } from '../components/resistor';
import { Sensor } from '../components/sensor';
import { SENSORS, type SensorKind } from '../components/sensors';
import { Wire, isPinEnd, wireCurve, type EndName, type WireEnd } from '../components/wire';
import type { Circuit, Connection, PinRef } from '../sim/types';
import type { SceneManager } from './sceneManager';

export type SpawnKind = BoardKind | SensorKind | 'breadboard' | 'led' | 'resistor';

export interface PinHit {
  component: SceneComponent;
  pin: string;
  /** Screen distance in px. */
  dist: number;
}

export interface LooseEndHit {
  wire: Wire;
  end: EndName;
  /** Screen distance in px. */
  dist: number;
}

export interface ComponentHit {
  component: SceneComponent;
  object: THREE.Object3D;
}

const QUARTER = Math.PI / 2;

/** Registry of placed components, wires and breadboard insertions, plus picking and snapping. */
export class World {
  readonly components: SceneComponent[] = [];
  readonly wires: Wire[] = [];
  /** Leg-to-hole connections of components snapped into a breadboard, keyed by component id. */
  readonly insertions = new Map<string, { breadboardId: string; connections: Connection[] }>();
  /** Bumped whenever connectivity changes, so callers can re-run the validator. */
  version = 0;
  private counters = new Map<string, number>();

  constructor(private sm: SceneManager) {}

  private nextId(kind: string): string {
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    return `${kind}-${n}`;
  }

  spawn(kind: SpawnKind): SceneComponent {
    const id = this.nextId(kind);
    const n = this.counters.get(kind)!;
    const c =
      kind === 'breadboard' ? new Breadboard(id)
      : kind === 'led' ? new Led(id)
      : kind === 'resistor' ? new Resistor(id)
      : kind in SENSORS ? new Sensor(id, kind as SensorKind)
      : new Board(id, kind as BoardKind);

    const [x, z] = config.components.spawnPositions[kind];
    const off = ((n - 1) % 5) * config.components.spawnOffset;
    c.root.position.set(x + off, 0, z + off);
    this.components.push(c);
    this.sm.workspace.add(c.root);
    this.version++;
    return c;
  }

  remove(c: SceneComponent): void {
    const i = this.components.indexOf(c);
    if (i >= 0) this.components.splice(i, 1);
    this.unsnap(c);
    // Anything plugged into a removed breadboard is now loose.
    for (const [id, ins] of [...this.insertions]) if (ins.breadboardId === c.id) this.insertions.delete(id);
    const touches = (e: WireEnd) => isPinEnd(e) && e.componentId === c.id;
    [...this.wires].filter((w) => touches(w.a) || touches(w.b)).forEach((w) => this.removeWire(w));
    this.sm.workspace.remove(c.root);
    c.dispose();
    this.version++;
  }

  clear(): void {
    [...this.components].forEach((c) => this.remove(c));
  }

  get(id: string): SceneComponent | undefined {
    return this.components.find((c) => c.id === id);
  }

  // ---- Wires ----

  /** Adds a wire; `b` may be a loose point (a wire being drawn). Null for a same-pin or duplicate wire. */
  addWire(a: PinRef, b: WireEnd): Wire | null {
    if (isPinEnd(b) && (sameRef(a, b) || this.isDuplicate(a, b))) return null;
    const w = new Wire(this.nextId('wire'), a, b);
    this.wires.push(w);
    this.sm.workspace.add(w.mesh);
    this.updateWires();
    this.version++;
    return w;
  }

  /** True when some other wire already joins pins a and b. */
  isDuplicate(a: PinRef, b: PinRef, except?: Wire): boolean {
    return this.wires.some(
      (w) =>
        w !== except &&
        w.connected &&
        ((sameRef(w.a as PinRef, a) && sameRef(w.b as PinRef, b)) || (sameRef(w.a as PinRef, b) && sameRef(w.b as PinRef, a))),
    );
  }

  /** Plug a wire end into a pin or leave it loose at a point. */
  setWireEnd(w: Wire, end: EndName, value: WireEnd): void {
    const was = w[end];
    w[end] = value;
    // Moving a loose point around doesn't change connectivity; plugging / unplugging does.
    if (isPinEnd(was) || isPinEnd(value)) this.version++;
    this.updateWires();
  }

  removeWire(w: Wire): void {
    const i = this.wires.indexOf(w);
    if (i >= 0) this.wires.splice(i, 1);
    this.sm.workspace.remove(w.mesh);
    w.dispose();
    this.version++;
  }

  /** Workspace-local position of a pin. */
  pinLocal(ref: PinRef, target = new THREE.Vector3()): THREE.Vector3 {
    const c = this.get(ref.componentId)!;
    const p = c.pin(ref.pin)!;
    c.root.updateMatrix();
    return target.copy(p.local).applyMatrix4(c.root.matrix);
  }

  /** Workspace-local position of a wire end. */
  endLocal(e: WireEnd, target = new THREE.Vector3()): THREE.Vector3 {
    return isPinEnd(e) ? this.pinLocal(e, target) : target.copy(e.point);
  }

  /** Re-shapes wires whose endpoints moved (cheap no-op otherwise). */
  updateWires(): void {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const w of this.wires) w.update(this.endLocal(w.a, a), this.endLocal(w.b, b));
  }

  /** Screen position of a wire end. */
  endScreen(w: Wire, end: EndName): { px: number; py: number; behind: boolean } {
    return this.sm.worldToScreen(this.endLocal(w[end]).applyMatrix4(this.sm.workspace.matrixWorld));
  }

  /** Nearest loose wire end to a screen pixel within the pin pick radius. */
  looseEndAt(px: number, py: number, radius = config.interaction.pinPickRadiusPx): LooseEndHit | null {
    let best: LooseEndHit | null = null;
    for (const wire of this.wires) {
      for (const end of ['a', 'b'] as const) {
        if (isPinEnd(wire[end])) continue;
        const s = this.endScreen(wire, end);
        const dist = Math.hypot(s.px - px, s.py - py);
        if (!s.behind && dist <= radius && (!best || dist < best.dist)) best = { wire, end, dist };
      }
    }
    return best;
  }

  /** Wire whose on-screen curve passes nearest a screen pixel, within `radius` px (forgiving, unlike wireAt). */
  wireNear(px: number, py: number, radius: number): Wire | null {
    let best: { w: Wire; d: number } | null = null;
    const m = this.sm.workspace.matrixWorld;
    for (const w of this.wires) {
      const pts = wireCurve(this.endLocal(w.a), this.endLocal(w.b))
        .getPoints(24)
        .map((p) => this.sm.worldToScreen(p.applyMatrix4(m)));
      for (let i = 1; i < pts.length; i++) {
        const d = segmentDist(px, py, pts[i - 1], pts[i]);
        if (d <= radius && (!best || d < best.d)) best = { w, d };
      }
    }
    return best?.w ?? null;
  }

  wireAt(px: number, py: number): Wire | null {
    const hit = this.sm.rayAt(px, py).intersectObjects(this.wires.map((w) => w.mesh), false)[0];
    return hit ? (hit.object.userData.wire as Wire) : null;
  }

  // ---- Snapping ----

  /** Components currently plugged into the given breadboard. */
  insertedInto(breadboardId: string): SceneComponent[] {
    return [...this.insertions]
      .filter(([, ins]) => ins.breadboardId === breadboardId)
      .map(([id]) => this.get(id)!)
      .filter(Boolean);
  }

  unsnap(c: SceneComponent): void {
    if (this.insertions.delete(c.id)) this.version++;
  }

  /**
   * Tries to plug an LED / resistor into the nearest breadboard: squares its yaw to the grid,
   * moves the first leg onto the nearest hole, and accepts if every leg then sits on a hole.
   */
  trySnap(c: SceneComponent): boolean {
    if (c.type !== 'led' && c.type !== 'resistor' && c.type !== 'sensor') return false;
    const { snapRadius, legTolerance } = config.snapping;
    const saved = { pos: c.root.position.clone(), rot: c.root.rotation.clone() };

    for (const bb of this.components) {
      if (!(bb instanceof Breadboard)) continue;
      c.root.rotation.set(0, bb.root.rotation.y + Math.round((c.root.rotation.y - bb.root.rotation.y) / QUARTER) * QUARTER, 0);
      c.root.position.y = bb.root.position.y + bb.holeY;

      bb.root.updateMatrix();
      const toBb = bb.root.matrix.clone().invert();
      const legInBb = (name: string) => {
        c.root.updateMatrix();
        return c.pin(name)!.local.clone().applyMatrix4(c.root.matrix).applyMatrix4(toBb);
      };

      const first = legInBb(c.pins[0].name);
      const hole = nearestHole(bb, first);
      if (!hole || hole.dist > snapRadius) {
        c.root.position.copy(saved.pos);
        c.root.rotation.copy(saved.rot);
        continue;
      }
      // Shift in breadboard-local XZ, converted back to workspace space.
      const shiftBb = new THREE.Vector3(hole.local.x - first.x, 0, hole.local.z - first.z);
      c.root.position.add(shiftBb.applyQuaternion(bb.root.quaternion));

      const connections: Connection[] = [];
      for (const p of c.pins) {
        const h = nearestHole(bb, legInBb(p.name));
        if (!h || h.dist > legTolerance) break;
        connections.push({ a: { componentId: c.id, pin: p.name }, b: { componentId: bb.id, pin: h.name } });
      }
      if (connections.length === c.pins.length) {
        this.insertions.set(c.id, { breadboardId: bb.id, connections });
        this.version++;
        return true;
      }
      c.root.position.copy(saved.pos);
      c.root.rotation.copy(saved.rot);
    }
    return false;
  }

  // ---- Simulation export ----

  toCircuit(): Circuit {
    return {
      components: this.components.map((c) => c.toSim()),
      connections: [
        // Wires with a loose end carry no current.
        ...this.wires.filter((w) => w.connected).map((w) => ({ a: w.a as PinRef, b: w.b as PinRef })),
        ...[...this.insertions.values()].flatMap((i) => i.connections),
      ],
    };
  }

  // ---- Picking ----

  /** Topmost component under a screen pixel (raycast), with the mesh that was hit. */
  componentAt(px: number, py: number, exclude?: SceneComponent): ComponentHit | null {
    const roots = this.components.filter((c) => c !== exclude).map((c) => c.root);
    const hits = this.sm.rayAt(px, py).intersectObjects(roots, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.component) o = o.parent;
      if (o) return { component: o.userData.component as SceneComponent, object: h.object };
    }
    return null;
  }

  /** Nearest pin to a screen pixel within the pick radius. Non-breadboard pins win ties over breadboard holes. */
  pinAt(px: number, py: number, radius = config.interaction.pinPickRadiusPx, exclude?: SceneComponent): PinHit | null {
    let best: PinHit | null = null;
    const v = new THREE.Vector3();
    for (const c of this.components) {
      if (c === exclude) continue;
      // Holes are a lower-priority target than component pins sitting on top of them.
      const penalty = c.type === 'breadboard' ? radius * 0.5 : 0;
      c.root.updateWorldMatrix(true, false);
      for (const p of c.pins) {
        v.copy(p.local).applyMatrix4(c.root.matrixWorld);
        const s = this.sm.worldToScreen(v);
        if (s.behind) continue;
        const d = Math.hypot(s.px - px, s.py - py);
        if (d <= radius && (!best || d + penalty < best.dist)) best = { component: c, pin: p.name, dist: d + penalty };
      }
    }
    return best;
  }

  /**
   * Like pinAt, but keeps `prev` while the pointer stays within the stick radius of it, unless another
   * pin is clearly closer. Stops hand tremor flicking the target between neighbouring holes.
   */
  pinAtSticky(px: number, py: number, prev: PinHit | null): PinHit | null {
    const next = this.pinAt(px, py);
    if (!prev || !this.components.includes(prev.component) || (next && sameHit(next, prev))) return next;
    const { pinPickRadiusPx, pinStickRadiusPx, pinSwitchMarginPx } = config.interaction;
    const s = this.sm.worldToScreen(prev.component.pinWorld(prev.pin));
    const penalty = prev.component.type === 'breadboard' ? pinPickRadiusPx * 0.5 : 0;
    const d = Math.hypot(s.px - px, s.py - py);
    if (s.behind || d > pinStickRadiusPx) return next;
    if (next && next.dist < d + penalty - pinSwitchMarginPx) return next;
    return { component: prev.component, pin: prev.pin, dist: d + penalty };
  }
}

/** Distance from point (px, py) to the screen segment a-b. */
function segmentDist(px: number, py: number, a: { px: number; py: number }, b: { px: number; py: number }): number {
  const dx = b.px - a.px;
  const dy = b.py - a.py;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a.px) * dx + (py - a.py) * dy) / len2)) : 0;
  return Math.hypot(px - (a.px + t * dx), py - (a.py + t * dy));
}

function sameHit(a: PinHit, b: PinHit): boolean {
  return a.component === b.component && a.pin === b.pin;
}

function sameRef(a: PinRef, b: PinRef): boolean {
  return a.componentId === b.componentId && a.pin === b.pin;
}

function nearestHole(bb: Breadboard, p: THREE.Vector3): { name: string; local: THREE.Vector3; dist: number } | null {
  let best: { name: string; local: THREE.Vector3; dist: number } | null = null;
  for (const h of bb.pins) {
    const d = Math.hypot(h.local.x - p.x, h.local.z - p.z);
    if (!best || d < best.dist) best = { name: h.name, local: h.local, dist: d };
  }
  return best;
}

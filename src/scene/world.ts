import * as THREE from 'three';
import { config } from '../config';
import { Board } from '../components/board';
import type { BoardKind } from '../components/boards';
import { Breadboard } from '../components/breadboard';
import type { SceneComponent } from '../components/component';
import { Led } from '../components/led';
import { Resistor } from '../components/resistor';
import { Wire } from '../components/wire';
import type { Circuit, Connection, PinRef } from '../sim/types';
import type { SceneManager } from './sceneManager';

export type SpawnKind = BoardKind | 'breadboard' | 'led' | 'resistor';

export interface PinHit {
  component: SceneComponent;
  pin: string;
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
      : new Board(id, kind);

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
    [...this.wires].filter((w) => w.a.componentId === c.id || w.b.componentId === c.id).forEach((w) => this.removeWire(w));
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

  addWire(a: PinRef, b: PinRef): Wire | null {
    if (a.componentId === b.componentId && a.pin === b.pin) return null;
    const dup = this.wires.some(
      (w) =>
        (sameRef(w.a, a) && sameRef(w.b, b)) || (sameRef(w.a, b) && sameRef(w.b, a)),
    );
    if (dup) return null;
    const w = new Wire(this.nextId('wire'), a, b);
    this.wires.push(w);
    this.sm.workspace.add(w.mesh);
    this.updateWires();
    this.version++;
    return w;
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

  /** Re-shapes wires whose endpoints moved (cheap no-op otherwise). */
  updateWires(): void {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const w of this.wires) w.update(this.pinLocal(w.a, a), this.pinLocal(w.b, b));
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
    if (c.type !== 'led' && c.type !== 'resistor') return false;
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
        ...this.wires.map((w) => ({ a: w.a, b: w.b })),
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

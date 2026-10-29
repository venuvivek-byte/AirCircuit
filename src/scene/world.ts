import * as THREE from 'three';
import { config } from '../config';
import { Board } from '../components/board';
import type { BoardKind } from '../components/boards';
import { Breadboard } from '../components/breadboard';
import type { SceneComponent } from '../components/component';
import { Led } from '../components/led';
import { Resistor } from '../components/resistor';
import type { SceneManager } from './sceneManager';

export type SpawnKind = BoardKind | 'breadboard' | 'led' | 'resistor';

export interface PinHit {
  component: SceneComponent;
  pin: string;
  /** Screen distance in px. */
  dist: number;
}

/** Registry of the components placed in the workspace, plus picking helpers. */
export class World {
  readonly components: SceneComponent[] = [];
  private counters = new Map<string, number>();

  constructor(private sm: SceneManager) {}

  spawn(kind: SpawnKind): SceneComponent {
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const id = `${kind}-${n}`;
    const c =
      kind === 'breadboard' ? new Breadboard(id)
      : kind === 'led' ? new Led(id)
      : kind === 'resistor' ? new Resistor(id)
      : new Board(id, kind);

    const [x, z] = config.components.spawnPositions[kind];
    const off = ((n - 1) % 5) * config.components.spawnOffset;
    c.root.position.set(x + off, 0, z + off);
    this.add(c);
    return c;
  }

  add(c: SceneComponent): void {
    this.components.push(c);
    this.sm.workspace.add(c.root);
  }

  remove(c: SceneComponent): void {
    const i = this.components.indexOf(c);
    if (i >= 0) this.components.splice(i, 1);
    this.sm.workspace.remove(c.root);
    c.dispose();
  }

  clear(): void {
    [...this.components].forEach((c) => this.remove(c));
  }

  get(id: string): SceneComponent | undefined {
    return this.components.find((c) => c.id === id);
  }

  /** Topmost component under a screen pixel (raycast). */
  componentAt(px: number, py: number, exclude?: SceneComponent): SceneComponent | null {
    const roots = this.components.filter((c) => c !== exclude).map((c) => c.root);
    const hits = this.sm.rayAt(px, py).intersectObjects(roots, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.component) o = o.parent;
      if (o) return o.userData.component as SceneComponent;
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

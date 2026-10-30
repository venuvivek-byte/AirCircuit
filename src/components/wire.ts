import * as THREE from 'three';
import { config } from '../config';
import type { PinRef } from '../sim/types';

const COLORS = [0xff3b3b, 0x3b82ff, 0x2ecc71, 0xffc93b, 0xb05cff, 0xff8c2e];
let colorIndex = 0;

/** Arched tube between two points in workspace-local coords. */
export function wireCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const lift = config.wires.baseLift + a.distanceTo(b) * config.wires.liftPerUnit;
  const mid = a.clone().lerp(b, 0.5);
  mid.y = Math.max(a.y, b.y) + lift;
  const qa = a.clone().lerp(mid, 0.5).setY(mid.y * 0.85);
  const qb = b.clone().lerp(mid, 0.5).setY(mid.y * 0.85);
  return new THREE.CatmullRomCurve3([a.clone(), qa, mid, qb, b.clone()]);
}

/** A wire end: plugged into a pin, or loose at a workspace-local point. */
export type WireEnd = PinRef | { point: THREE.Vector3 };
export type EndName = 'a' | 'b';

export function isPinEnd(e: WireEnd): e is PinRef {
  return 'componentId' in e;
}

/**
 * A jumper wire between two ends. Not a SceneComponent: it has no pins of its own.
 * A loose end (released in the air, or unplugged) shows a plug tip and can be picked up again.
 */
export class Wire {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private tips: Record<EndName, THREE.Mesh>;
  private lastA = new THREE.Vector3(NaN, NaN, NaN);
  private lastB = new THREE.Vector3(NaN, NaN, NaN);

  constructor(
    readonly id: string,
    public a: WireEnd,
    public b: WireEnd,
    color = COLORS[colorIndex++ % COLORS.length],
  ) {
    this.material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.userData.wire = this;
    // Tips are children of the mesh (which sits at the workspace origin), so their positions are workspace-local.
    const tipGeo = new THREE.SphereGeometry(config.wires.radius * 2.2, 12, 8);
    this.tips = { a: new THREE.Mesh(tipGeo, this.material), b: new THREE.Mesh(tipGeo, this.material) };
    this.mesh.add(this.tips.a, this.tips.b);
  }

  /** Both ends plugged in: only then does the wire count in the circuit. */
  get connected(): boolean {
    return isPinEnd(this.a) && isPinEnd(this.b);
  }

  /** Rebuilds the tube when an endpoint moved. Endpoints are workspace-local. */
  update(pa: THREE.Vector3, pb: THREE.Vector3): void {
    this.tips.a.visible = !isPinEnd(this.a);
    this.tips.b.visible = !isPinEnd(this.b);
    if (pa.equals(this.lastA) && pb.equals(this.lastB)) return;
    this.lastA.copy(pa);
    this.lastB.copy(pb);
    this.tips.a.position.copy(pa);
    this.tips.b.position.copy(pb);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.TubeGeometry(wireCurve(pa, pb), 24, config.wires.radius, 6, false);
  }

  /** true = hover glow; 'cut' = red, about to be snipped by scissors. */
  setHighlight(on: boolean | 'cut'): void {
    this.material.emissive.setHex(on === 'cut' ? 0xcc0000 : on ? 0x444444 : 0x000000);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.tips.a.geometry.dispose();
    this.material.dispose();
  }
}

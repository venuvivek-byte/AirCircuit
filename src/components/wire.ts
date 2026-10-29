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

/** A jumper wire between two pins. Not a SceneComponent: it has no pins of its own. */
export class Wire {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private lastA = new THREE.Vector3(NaN, NaN, NaN);
  private lastB = new THREE.Vector3(NaN, NaN, NaN);

  constructor(
    readonly id: string,
    readonly a: PinRef,
    readonly b: PinRef,
    color = COLORS[colorIndex++ % COLORS.length],
  ) {
    this.material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.userData.wire = this;
  }

  /** Rebuilds the tube when an endpoint moved. Endpoints are workspace-local. */
  update(pa: THREE.Vector3, pb: THREE.Vector3): void {
    if (pa.equals(this.lastA) && pb.equals(this.lastB)) return;
    this.lastA.copy(pa);
    this.lastB.copy(pb);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.TubeGeometry(wireCurve(pa, pb), 24, config.wires.radius, 6, false);
  }

  setHighlight(on: boolean): void {
    this.material.emissive.setHex(on ? 0x444444 : 0x000000);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

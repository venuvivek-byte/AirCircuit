import * as THREE from 'three';
import { config } from '../config';
import { SceneComponent, makeLabel } from './component';

/** Red 5mm LED: two legs (anode = longer, marked '+'), dome body that glows when lit. */
export class Led extends SceneComponent {
  private bodyMat: THREE.MeshStandardMaterial;
  private light: THREE.PointLight;
  lit = false;

  constructor(id: string) {
    super(id, 'led');
    const half = config.components.ledLegSpacing / 2;
    const legMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, metalness: 0.9, roughness: 0.3 });

    // Anode at -x (longer leg), cathode at +x.
    for (const [name, x, len] of [['anode', -half, 0.28], ['cathode', half, 0.24]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 6), legMat);
      leg.position.set(x, 0.24 - len / 2, 0);
      this.root.add(leg);
      this.pins.push({ name, local: new THREE.Vector3(x, 0.24 - len, 0) });
    }

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0xcc2020, emissive: 0xff2020, emissiveIntensity: 0, transparent: true, opacity: 0.9,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.14, 16), this.bodyMat);
    body.position.y = 0.31;
    this.root.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.bodyMat);
    dome.position.y = 0.38;
    this.root.add(dome);

    const plus = makeLabel('+', '#ff8080', 0.07);
    plus.position.set(-half - 0.07, 0.2, 0);
    this.root.add(plus);

    this.light = new THREE.PointLight(0xff3030, 0, 1.5);
    this.light.position.y = 0.4;
    this.root.add(this.light);
  }

  setLit(on: boolean): void {
    if (on === this.lit) return;
    this.lit = on;
    this.bodyMat.emissiveIntensity = on ? 2.5 : 0;
    this.light.intensity = on ? 3 : 0;
  }
}

import * as THREE from 'three';
import { config } from '../config';
import { SceneComponent } from './component';

/** 220 ohm axial resistor (bands red-red-brown-gold). Legs 'a' (-x) and 'b' (+x). */
export class Resistor extends SceneComponent {
  readonly ohms = config.sim.resistorOhms;

  constructor(id: string) {
    super(id, 'resistor');
    const half = config.components.resistorLegSpacing / 2;
    const bodyY = 0.12;
    const leadMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, metalness: 0.9, roughness: 0.3 });

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8c39a }),
    );
    body.rotation.z = Math.PI / 2;
    body.position.y = bodyY;
    this.root.add(body);

    const bands = [0xd02020, 0xd02020, 0x6b3a1a, 0xd4af37];
    bands.forEach((color, i) => {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.047, 0.047, 0.025, 12),
        new THREE.MeshStandardMaterial({ color }),
      );
      band.rotation.z = Math.PI / 2;
      band.position.set(-0.09 + i * 0.055 + (i === 3 ? 0.03 : 0), bodyY, 0);
      this.root.add(band);
    });

    for (const [name, sign] of [['a', -1], ['b', 1]] as const) {
      const horiz = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, half - 0.15, 6), leadMat);
      horiz.rotation.z = Math.PI / 2;
      horiz.position.set(sign * (0.15 + (half - 0.15) / 2), bodyY, 0);
      this.root.add(horiz);
      const vert = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, bodyY, 6), leadMat);
      vert.position.set(sign * half, bodyY / 2, 0);
      this.root.add(vert);
      this.pins.push({ name, local: new THREE.Vector3(sign * half, 0, 0) });
    }
  }
}

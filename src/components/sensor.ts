import * as THREE from 'three';
import { config } from '../config';
import type { SimComponent } from '../sim/types';
import { SceneComponent, makeLabel } from './component';
import { SENSORS, type SensorDef, type SensorKind } from './sensors';

/**
 * A sensor module (blue / red / green PCB). Its sensing face points along local +z (toward the user
 * by default, away from the pin header), so a hand coming toward it from the front is "in front".
 * Header pins sit at breadboard pitch on the -z edge, so the module plugs into the breadboard.
 */
export class Sensor extends SceneComponent {
  readonly def: SensorDef;
  private powerLed: THREE.MeshStandardMaterial;
  private activeLed: THREE.MeshStandardMaterial;

  constructor(id: string, kind: SensorKind) {
    super(id, 'sensor');
    this.def = SENSORS[kind];
    const [w, h, d] = this.def.size;
    const lift = 0.14;

    const pcb = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: this.def.color, roughness: 0.6 }));
    pcb.position.y = lift + h / 2;
    this.root.add(pcb);
    const top = lift + h;

    const metal = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.8, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    if (kind === 'ultrasonic') {
      // Two transducer "eyes".
      for (const x of [-0.26, 0.26]) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 20), metal);
        can.position.set(x, top + 0.07, 0.02);
        this.root.add(can);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 20), dark);
        mesh.position.set(x, top + 0.145, 0.02);
        this.root.add(mesh);
      }
    } else if (kind === 'ir') {
      // IR emitter (clear) + receiver (dark) at the front.
      for (const [x, mat] of [[-0.1, new THREE.MeshStandardMaterial({ color: 0xeeeeff, transparent: true, opacity: 0.8 })], [0.1, dark]] as const) {
        const led = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 12), mat);
        led.rotation.x = Math.PI / 2;
        led.position.set(x, top + 0.05, d / 2 + 0.02);
        this.root.add(led);
      }
    } else if (kind === 'sound') {
      const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 20), metal);
      mic.position.set(0, top + 0.06, d / 2 - 0.18);
      this.root.add(mic);
    } else {
      // MQ-2: mesh-capped dome.
      const dome = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.19, 0.2, 20),
        new THREE.MeshStandardMaterial({ color: 0xb0b0b0, metalness: 0.6, roughness: 0.6, wireframe: false }),
      );
      dome.position.set(0, top + 0.1, 0.08);
      this.root.add(dome);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 20), new THREE.MeshStandardMaterial({ color: 0xd08030 }));
      cap.position.set(0, top + 0.205, 0.08);
      this.root.add(cap);
    }

    // Power (red) and detect (green) indicator LEDs.
    const mk = (color: number, x: number) => {
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), mat);
      m.position.set(x, top + 0.015, -d / 2 + 0.2);
      this.root.add(m);
      return mat;
    };
    this.powerLed = mk(0xff2020, w / 2 - 0.08);
    this.activeLed = mk(0x20ff40, w / 2 - 0.18);

    const label = makeLabel(this.def.label, '#ffffff', 0.09);
    label.position.set(0, top + 0.32, 0);
    this.root.add(label);

    // Header pins along the -z (back) edge at breadboard pitch.
    const pitch = config.components.breadboardPitch;
    const n = this.def.pins.length;
    const pinGeo = new THREE.BoxGeometry(0.03, lift, 0.03);
    this.def.pins.forEach((pin, i) => {
      const x = (i - (n - 1) / 2) * pitch;
      const z = -d / 2 + 0.06;
      const leg = new THREE.Mesh(pinGeo, metal);
      leg.position.set(x, lift / 2, z);
      this.root.add(leg);
      const l = makeLabel(pin.name, '#ffe27a', 0.06);
      l.position.set(x, top + 0.04, z + 0.08);
      this.root.add(l);
      this.pins.push({ name: pin.name, local: new THREE.Vector3(x, -0.02, z) });
    });
  }

  setState(powered: boolean, active: boolean): void {
    this.powerLed.emissiveIntensity = powered ? 2 : 0;
    this.activeLed.emissiveIntensity = active ? 2.5 : 0;
  }

  override toSim(): SimComponent {
    return { id: this.id, type: 'sensor', sensorKind: this.def.kind };
  }
}

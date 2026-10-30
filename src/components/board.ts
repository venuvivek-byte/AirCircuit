import * as THREE from 'three';
import type { SimComponent } from '../sim/types';
import { BOARDS, type BoardDef, type BoardKind } from './boards';
import { SceneComponent, makeLabel } from './component';

const PIN_COLORS = { gpio: '#ffffff', ground: '#9ad0ff', power: '#ff9a9a' } as const;

/** One generic board class; everything board-specific comes from `boards.ts` data. */
export class Board extends SceneComponent {
  readonly def: BoardDef;
  private onLed: THREE.MeshStandardMaterial;
  private builtinLed: THREE.MeshStandardMaterial;

  constructor(id: string, kind: BoardKind) {
    super(id, 'board');
    this.def = BOARDS[kind];
    const [w, h, d] = this.def.size;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: this.def.color, roughness: 0.7 }),
    );
    body.position.y = h / 2;
    this.root.add(body);

    // Chip in the middle to make the board read as a board.
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.3, 0.05, d * 0.2),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    );
    chip.position.y = h + 0.025;
    this.root.add(chip);

    // Power "ON" LED (green) and the built-in "L" LED (orange on the Uno, blue on the ESP32).
    const smd = (color: number, x: number, z: number, text: string) => {
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.05), mat);
      m.position.set(x, h + 0.015, z);
      this.root.add(m);
      const l = makeLabel(text, '#dddddd', 0.05);
      l.position.set(x, h + 0.06, z + 0.07);
      this.root.add(l);
      return mat;
    };
    const esp = kind === 'esp32';
    this.onLed = smd(0x30ff50, esp ? -0.15 : 0.55, esp ? -0.85 : -0.3, 'ON');
    this.builtinLed = smd(esp ? 0x3080ff : 0xffa020, esp ? 0.15 : 0.75, esp ? -0.85 : -0.3, esp ? 'IO2' : 'L');

    const title = makeLabel(this.def.label, '#ffffff', 0.16);
    title.position.set(0, h + 0.25, 0);
    this.root.add(title);

    const headerGeo = new THREE.BoxGeometry(0.11, 0.08, 0.11);
    const headerMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const padGeo = new THREE.BoxGeometry(0.05, 0.01, 0.05);
    const padMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 });

    for (const pin of this.def.pins) {
      const [x, , z] = pin.pos;
      const header = new THREE.Mesh(headerGeo, headerMat);
      header.position.set(x, h + 0.04, z);
      this.root.add(header);
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(x, h + 0.085, z);
      this.root.add(pad);

      const label = makeLabel(pin.name, PIN_COLORS[pin.role], 0.07);
      // Labels sit just inside the header, toward the board center, along the axis nearest an edge.
      const nearZEdge = Math.abs(z) / d >= Math.abs(x) / w;
      label.position.set(
        nearZEdge ? x : x - Math.sign(x) * 0.2,
        h + 0.12,
        nearZEdge ? z - Math.sign(z) * 0.13 : z,
      );
      this.root.add(label);

      this.pins.push({ name: pin.name, local: new THREE.Vector3(x, h + 0.09, z) });
    }
  }

  /** `powered`: the simulation is running; `builtin`: LED_BUILTIN is HIGH. */
  setLeds(powered: boolean, builtin: boolean): void {
    this.onLed.emissiveIntensity = powered ? 2 : 0;
    this.builtinLed.emissiveIntensity = builtin ? 3 : 0;
  }

  override toSim(): SimComponent {
    return { id: this.id, type: 'board', boardKind: this.def.kind };
  }
}

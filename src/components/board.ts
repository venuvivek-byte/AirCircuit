import * as THREE from 'three';
import type { SimComponent } from '../sim/types';
import { BOARDS, type BoardDef, type BoardKind } from './boards';
import { SceneComponent, makeLabel } from './component';

const PIN_COLORS = { gpio: '#ffffff', ground: '#9ad0ff', power: '#ff9a9a' } as const;

/** One generic board class; everything board-specific comes from `boards.ts` data. */
export class Board extends SceneComponent {
  readonly def: BoardDef;

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

  override toSim(): SimComponent {
    return { id: this.id, type: 'board', boardKind: this.def.kind };
  }
}

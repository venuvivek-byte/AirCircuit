import * as THREE from 'three';
import { config } from '../config';
import { BOTTOM_ROWS, COLUMNS, RAILS, TOP_ROWS } from './breadboardLayout';
import { SceneComponent, makeLabel } from './component';

/** Row position in pitch units, back (-z) to front (+z): rails, gap, a-e, center channel, f-j. */
const ROW_INDEX: Record<string, number> = {
  '+': 0, '-': 1,
  a: 2.5, b: 3.5, c: 4.5, d: 5.5, e: 6.5,
  f: 8, g: 9, h: 10, i: 11, j: 12,
};
const ROW_CENTER = 6;

export class Breadboard extends SceneComponent {
  readonly holeY: number;

  constructor(id: string) {
    super(id, 'breadboard');
    const p = config.components.breadboardPitch;
    const t = config.components.breadboardThickness;
    const width = (COLUMNS + 1) * p;
    const depth = 13.5 * p;
    this.holeY = t;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, t, depth),
      new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.9 }),
    );
    body.position.y = t / 2;
    this.root.add(body);

    // Holes cover the whole top, so the breadboard is grabbed by this front tab instead.
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.5, t * 0.8, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x5a6b80, roughness: 0.6 }),
    );
    handle.position.set(0, t * 0.4, depth / 2 + 0.11);
    handle.userData.handle = true;
    this.root.add(handle);
    const grip = makeLabel('✋ grab here', '#ffffff', 0.09);
    grip.position.set(0, t + 0.05, depth / 2 + 0.11);
    this.root.add(grip);

    const rowZ = (row: string) => (ROW_INDEX[row] - ROW_CENTER) * p;
    const colX = (col: number) => (col - (COLUMNS + 1) / 2) * p;

    // Rail stripes.
    for (const [rail, color] of [['+', 0xd03030], ['-', 0x3050d0]] as const) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.96, 0.003, 0.02),
        new THREE.MeshBasicMaterial({ color }),
      );
      stripe.position.set(0, t + 0.002, rowZ(rail) + (rail === '+' ? -0.5 : 0.5) * p);
      this.root.add(stripe);
      const label = makeLabel(rail, rail === '+' ? '#ff7070' : '#80a0ff', 0.1);
      label.position.set(-width / 2 - 0.08, t + 0.05, rowZ(rail));
      this.root.add(label);
    }

    // Center channel.
    const channel = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.98, 0.004, p * 0.4),
      new THREE.MeshBasicMaterial({ color: 0xc8c8c0 }),
    );
    channel.position.set(0, t + 0.002, ((7.25 - ROW_CENTER) * p));
    this.root.add(channel);

    const rows = [...RAILS, ...TOP_ROWS, ...BOTTOM_ROWS];
    const holes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(p * 0.38, 0.004, p * 0.38),
      new THREE.MeshBasicMaterial({ color: 0x333333 }),
      rows.length * COLUMNS,
    );
    const m = new THREE.Matrix4();
    let i = 0;
    for (let c = 1; c <= COLUMNS; c++) {
      for (const row of rows) {
        const pos = new THREE.Vector3(colX(c), t + 0.002, rowZ(row));
        m.makeTranslation(pos.x, pos.y, pos.z);
        holes.setMatrixAt(i++, m);
        this.pins.push({ name: `${row}${c}`, local: new THREE.Vector3(pos.x, t, pos.z) });
      }
    }
    this.root.add(holes);

    // Column numbers every 5 columns, row letters on the left.
    for (let c = 1; c <= COLUMNS; c += c === 1 ? 4 : 5) {
      const l = makeLabel(String(c), '#444444', 0.07);
      l.position.set(colX(c), t + 0.04, rowZ('a') - p * 0.75);
      this.root.add(l);
    }
    for (const row of [...TOP_ROWS, ...BOTTOM_ROWS]) {
      const l = makeLabel(row, '#444444', 0.07);
      l.position.set(-width / 2 + 0.03, t + 0.04, rowZ(row));
      this.root.add(l);
    }
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { config } from '../src/config';
import { SceneComponent } from '../src/components/component';
import { isPinEnd, wireCurve } from '../src/components/wire';
import { SceneManager } from '../src/scene/sceneManager';
import { World } from '../src/scene/world';
import { Interaction } from '../src/scene/interaction';

// Node has no window / WebGL: give SceneManager's screen maths a window size and build its scene by hand.
Object.assign(globalThis, { window: { innerWidth: 1000, innerHeight: 800, addEventListener() {} } });

function makeSceneManager(): SceneManager {
  const camera = new THREE.PerspectiveCamera(config.scene.fov, 1000 / 800, config.scene.near, config.scene.far);
  camera.position.set(0, 0, config.scene.cameraZ);
  camera.updateMatrixWorld();
  const workspace = new THREE.Group();
  workspace.rotation.x = config.workspace.tiltRad;
  workspace.position.y = config.workspace.y;
  workspace.scale.setScalar(config.workspace.scale);
  workspace.updateMatrixWorld();
  return Object.assign(Object.create(SceneManager.prototype), {
    scene: new THREE.Scene(),
    camera,
    workspace,
    raycaster: new THREE.Raycaster(),
    zoomGoal: { x: 0, y: 0, zoom: 1 },
  });
}

/** A part with named pins at workspace (x, z), no meshes (labels need a DOM canvas). */
class Part extends SceneComponent {
  constructor(id: string, pins: Array<[string, number, number]>) {
    super(id, 'board');
    for (const [name, x, z] of pins) this.pins.push({ name, local: new THREE.Vector3(x, 0.1, z) });
  }
}

describe('wiring with loose ends', () => {
  let sm: SceneManager;
  let world: World;
  let ix: Interaction;
  let now = 0;

  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    sm = makeSceneManager();
    world = new World(sm);
    const part = new Part('p', [['A', -1.5, 0], ['B', 1.5, 0], ['C', 0, 1]]);
    world.components.push(part);
    sm.workspace.add(part.root);
    // Trash is the screen's left 10 px.
    ix = new Interaction(sm, world, (px) => px < 10);
  });
  afterEach(() => vi.restoreAllMocks());

  const pinScreen = (pin: string) => sm.worldToScreen(world.components[0].pinWorld(pin));
  const empty = { px: 500, py: 150 };
  /** One hover frame (sets the highlighted pin / end), then the pinch closes. */
  function pinchAt(pt: { px: number; py: number }): void {
    ix.update({ ...pt, down: false });
    ix.update({ ...pt, down: true, grip: 'pinch' });
  }
  function moveTo(pt: { px: number; py: number }): void {
    ix.update({ ...pt, down: true, grip: 'pinch' });
  }
  function releaseAt(pt: { px: number; py: number }): void {
    ix.update({ ...pt, down: false });
  }

  it('a wire released in the air stays with a loose end, and can be picked up and plugged in', () => {
    pinchAt(pinScreen('A'));
    moveTo(empty);
    releaseAt(empty);
    expect(world.wires).toHaveLength(1);
    const w = world.wires[0];
    expect(w.connected).toBe(false);
    expect(isPinEnd(w.b)).toBe(false);
    expect(world.toCircuit().connections).toHaveLength(0);

    // Pinch the loose end and carry on to pin B.
    pinchAt(empty);
    expect(ix.action).toBe('wire');
    moveTo(pinScreen('B'));
    releaseAt(pinScreen('B'));
    expect(world.wires).toHaveLength(1);
    expect(w.connected).toBe(true);
    expect(w.b).toEqual({ componentId: 'p', pin: 'B' });
    expect(world.toCircuit().connections).toHaveLength(1);
  });

  it('pinching a pin and letting go on it leaves no stub wire', () => {
    pinchAt(pinScreen('A'));
    releaseAt(pinScreen('A'));
    expect(world.wires).toHaveLength(0);
  });

  it('a dragged end dropped on the trash deletes the wire', () => {
    pinchAt(pinScreen('A'));
    moveTo({ px: 5, py: 400 });
    releaseAt({ px: 5, py: 400 });
    expect(world.wires).toHaveLength(0);
  });

  it('holding a wire still for 2 s unplugs its nearest end into the hand', () => {
    const w = world.addWire({ componentId: 'p', pin: 'A' }, { componentId: 'p', pin: 'B' })!;
    world.updateWires();
    sm.workspace.updateMatrixWorld(true); // normally done by render()
    // A point on the wire nearer A than B.
    const a = world.endLocal(w.a);
    const b = world.endLocal(w.b);
    const onWire = sm.worldToScreen(wireCurve(a, b).getPoint(0.2).applyMatrix4(sm.workspace.matrixWorld));

    pinchAt(onWire);
    expect(ix.action).toBe('holdWire');
    now += config.interaction.wireDetachMs / 2;
    moveTo(onWire);
    expect(ix.action).toBe('holdWire');
    expect(ix.detachProgress).toBeCloseTo(0.5, 1);
    now += config.interaction.wireDetachMs / 2 + 10;
    moveTo(onWire);
    expect(ix.action).toBe('wire');
    expect(w.connected).toBe(false);
    expect(isPinEnd(w.a)).toBe(false);
    expect(w.b).toEqual({ componentId: 'p', pin: 'B' });

    // Re-plug the unplugged end into C.
    moveTo(pinScreen('C'));
    releaseAt(pinScreen('C'));
    expect(w.a).toEqual({ componentId: 'p', pin: 'C' });
    expect(w.connected).toBe(true);
  });

  it('moving while holding a wire cancels the unplug timer (drag to trash still deletes)', () => {
    const w = world.addWire({ componentId: 'p', pin: 'A' }, { componentId: 'p', pin: 'B' })!;
    world.updateWires();
    sm.workspace.updateMatrixWorld(true); // normally done by render()
    const mid = sm.worldToScreen(wireCurve(world.endLocal(w.a), world.endLocal(w.b)).getPoint(0.5).applyMatrix4(sm.workspace.matrixWorld));
    pinchAt(mid);
    moveTo({ px: mid.px - 100, py: mid.py });
    now += config.interaction.wireDetachMs * 2;
    moveTo({ px: 5, py: mid.py });
    expect(ix.action).toBe('holdWire');
    expect(ix.detachProgress).toBeNull();
    releaseAt({ px: 5, py: mid.py });
    expect(world.wires).toHaveLength(0);
  });

  it('losing the hand mid-drag leaves the end loose instead of deleting the wire', () => {
    pinchAt(pinScreen('A'));
    moveTo(empty);
    ix.update(null);
    expect(world.wires).toHaveLength(1);
    expect(world.wires[0].connected).toBe(false);
  });
});

describe('scissors', () => {
  it('targets the wire near the cut point (shown red) and deletes it on a snip', () => {
    const sm = makeSceneManager();
    const world = new World(sm);
    const part = new Part('p', [['A', -1.5, 0], ['B', 1.5, 0]]);
    world.components.push(part);
    sm.workspace.add(part.root);
    const ix = new Interaction(sm, world, () => false);
    const w = world.addWire({ componentId: 'p', pin: 'A' }, { componentId: 'p', pin: 'B' })!;
    const on = sm.worldToScreen(wireCurve(world.endLocal(w.a), world.endLocal(w.b)).getPoint(0.5).applyMatrix4(sm.workspace.matrixWorld));

    // Slightly off the wire still aims at it; far away doesn't.
    ix.scissors({ px: on.px + 8, py: on.py, snip: false });
    expect(ix.cutWire).toBe(w);
    ix.scissors({ px: on.px, py: on.py + 200, snip: false });
    expect(ix.cutWire).toBeNull();
    expect(world.wires).toHaveLength(1);

    ix.scissors({ px: on.px, py: on.py, snip: true });
    expect(world.wires).toHaveLength(0);
    expect(ix.cutWire).toBeNull();
  });
});

describe('fist enlarge', () => {
  it('scales only the held part (wires follow its pins) and drops it back at true size', () => {
    const sm = makeSceneManager();
    const world = new World(sm);
    const held = new Part('held', [['A', 0.3, 0]]);
    held.root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1)));
    const other = new Part('other', [['B', 2, 1]]);
    for (const c of [held, other]) {
      world.components.push(c);
      sm.workspace.add(c.root);
    }
    sm.workspace.updateMatrixWorld(true);
    const ix = new Interaction(sm, world, () => false);
    world.addWire({ componentId: 'held', pin: 'A' }, { componentId: 'other', pin: 'B' });

    const at = sm.worldToScreen(new THREE.Vector3(0, 0.2, 0).applyMatrix4(sm.workspace.matrixWorld));
    ix.update({ ...at, down: false });
    ix.update({ ...at, down: true, grip: 'fist' });
    expect(ix.grabbed).toBe(held);

    const before = world.endLocal(world.wires[0].a).clone();
    ix.scaleGrabbed(2);
    expect(held.root.scale.x).toBe(2);
    expect(other.root.scale.x).toBe(1);
    // The pin moved outward with the scaled part, so the wire end did too.
    expect(world.endLocal(world.wires[0].a).x - held.root.position.x).toBeCloseTo((before.x - held.root.position.x) * 2, 5);

    ix.update({ ...at, down: false });
    expect(ix.grabbed).toBeNull();
    expect(held.root.scale.x).toBe(1);
  });
});

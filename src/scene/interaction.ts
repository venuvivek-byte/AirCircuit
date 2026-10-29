import * as THREE from 'three';
import { config } from '../config';
import type { SceneComponent } from '../components/component';
import { wireCurve, type Wire } from '../components/wire';
import type { PinRef } from '../sim/types';
import type { SceneManager } from './sceneManager';
import type { PinHit, World } from './world';

/** Input-agnostic pointer: driven by the mouse in mouse mode, by the pinch point in hand mode. */
export interface PointerState {
  px: number;
  py: number;
  down: boolean;
}

const LIFT = 0.15;
const WIRE_PREVIEW_Y = 0.2;

type Mode =
  | { kind: 'idle' }
  | { kind: 'grab'; component: SceneComponent; carried: Array<{ c: SceneComponent; rel: THREE.Matrix4 }> }
  | { kind: 'wire'; from: PinRef }
  | { kind: 'holdWire'; wire: Wire };

/**
 * Pointer interaction: grab / move / rotate / drop components (snapping into the breadboard),
 * drag from pin to pin to create wires, and drop a component or wire on the trash to delete it.
 */
export class Interaction {
  hoverPin: PinHit | null = null;
  hoverComponent: SceneComponent | null = null;
  hoverWire: Wire | null = null;

  private mode: Mode = { kind: 'idle' };
  private wasDown = false;
  private offset = new THREE.Vector3();
  private grabRotation = new THREE.Euler();
  private preview: THREE.Mesh;

  constructor(
    private sm: SceneManager,
    private world: World,
    /** True when the screen point is over the trash drop zone. */
    private isOverTrash: (px: number, py: number) => boolean,
  ) {
    this.preview = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
    );
    this.preview.visible = false;
    sm.workspace.add(this.preview);
  }

  get grabbed(): SceneComponent | null {
    return this.mode.kind === 'grab' ? this.mode.component : null;
  }

  get action(): Mode['kind'] {
    return this.mode.kind;
  }

  get busy(): boolean {
    return this.mode.kind !== 'idle';
  }

  update(p: PointerState | null): void {
    if (!p) {
      this.finish(null);
      this.hoverPin = null;
      this.hoverComponent = null;
      this.setHoverWire(null);
      this.wasDown = false;
      this.world.updateWires();
      return;
    }

    const pressed = p.down && !this.wasDown;
    const released = !p.down && this.wasDown;
    this.wasDown = p.down;

    if (pressed) this.begin(p);
    else if (released) this.finish(p);

    switch (this.mode.kind) {
      case 'grab': {
        const hit = this.sm.screenToWorkspace(p.px, p.py, LIFT);
        if (hit) this.mode.component.root.position.set(hit.x + this.offset.x, LIFT, hit.z + this.offset.z);
        this.moveCarried();
        this.hoverPin = null;
        this.hoverComponent = this.mode.component;
        break;
      }
      case 'wire': {
        this.hoverPin = this.world.pinAt(p.px, p.py);
        const from = this.world.pinLocal(this.mode.from);
        const to = this.hoverPin
          ? this.world.pinLocal({ componentId: this.hoverPin.component.id, pin: this.hoverPin.pin })
          : this.sm.screenToWorkspace(p.px, p.py, WIRE_PREVIEW_Y);
        if (to) {
          this.preview.geometry.dispose();
          this.preview.geometry = new THREE.TubeGeometry(wireCurve(from, to), 20, config.wires.radius, 6, false);
          this.preview.visible = true;
        }
        break;
      }
      case 'holdWire':
        this.hoverPin = null;
        break;
      case 'idle':
        this.hoverPin = this.world.pinAt(p.px, p.py);
        this.hoverComponent = this.world.componentAt(p.px, p.py)?.component ?? null;
        // Wires lying over the breadboard win over the holes beneath them.
        this.setHoverWire(
          this.hoverPin && this.hoverPin.component.type !== 'breadboard' ? null : this.world.wireAt(p.px, p.py),
        );
        if (this.hoverWire) this.hoverPin = null;
        break;
    }
    this.world.updateWires();
  }

  /** Rotation relative to the orientation the component had when grabbed. */
  rotateGrabbed(yaw: number, pitch = 0): void {
    const c = this.grabbed;
    if (!c) return;
    c.root.rotation.set(this.grabRotation.x + pitch, this.grabRotation.y + yaw, this.grabRotation.z);
    this.moveCarried();
  }

  /** Rotate the grabbed component (or the hovered one) by a fixed step around Y. */
  rotateStep(yaw: number): void {
    const c = this.grabbed ?? this.hoverComponent;
    if (!c) return;
    if (c === this.grabbed) {
      this.grabRotation.y += yaw;
      c.root.rotation.y += yaw;
      this.moveCarried();
    } else {
      // Rotating a placed part pulls it out of the breadboard; re-snap at the new angle.
      this.world.unsnap(c);
      c.root.rotation.y += yaw;
      this.world.trySnap(c);
    }
    this.world.updateWires();
  }

  /** Mouse-mode Delete key: remove the hovered wire, else the hovered component. */
  deleteHovered(): void {
    if (this.busy) return;
    if (this.hoverWire) {
      this.world.removeWire(this.hoverWire);
      this.hoverWire = null;
    } else if (this.hoverComponent) {
      this.world.remove(this.hoverComponent);
      this.hoverComponent = null;
    }
  }

  private begin(p: PointerState): void {
    const hit = this.world.componentAt(p.px, p.py);
    const pin = this.world.pinAt(p.px, p.py);
    const ref = pin && { componentId: pin.component.id, pin: pin.pin };

    if (hit && hit.component.type !== 'breadboard') {
      // On a part: its own pin starts a wire, anywhere else grabs it.
      if (ref && pin.component === hit.component) this.mode = { kind: 'wire', from: ref };
      else this.startGrab(hit.component, p);
    } else if (hit?.object.userData.handle) {
      this.startGrab(hit.component, p);
    } else if (this.hoverWire) {
      this.mode = { kind: 'holdWire', wire: this.hoverWire };
    } else if (ref) {
      this.mode = { kind: 'wire', from: ref };
    } else if (hit) {
      this.startGrab(hit.component, p);
    }
  }

  private startGrab(c: SceneComponent, p: PointerState): void {
    const hit = this.sm.screenToWorkspace(p.px, p.py, LIFT);
    if (!hit) return;
    this.world.unsnap(c);
    this.offset.set(c.root.position.x - hit.x, 0, c.root.position.z - hit.z);
    this.grabRotation.copy(c.root.rotation);
    // Parts plugged into a breadboard travel with it.
    c.root.updateMatrix();
    const inv = c.root.matrix.clone().invert();
    const carried =
      c.type === 'breadboard'
        ? this.world.insertedInto(c.id).map((x) => {
            x.root.updateMatrix();
            return { c: x, rel: inv.clone().multiply(x.root.matrix) };
          })
        : [];
    this.mode = { kind: 'grab', component: c, carried };
  }

  private moveCarried(): void {
    if (this.mode.kind !== 'grab') return;
    const base = this.mode.component.root;
    base.updateMatrix();
    for (const { c, rel } of this.mode.carried) {
      new THREE.Matrix4().multiplyMatrices(base.matrix, rel).decompose(c.root.position, c.root.quaternion, c.root.scale);
    }
  }

  /** Ends the current action; `p` is null when the pointer was lost (cancel without trash). */
  private finish(p: PointerState | null): void {
    const overTrash = !!p && this.isOverTrash(p.px, p.py);
    const mode = this.mode;
    this.mode = { kind: 'idle' };
    this.preview.visible = false;

    if (mode.kind === 'grab') {
      const c = mode.component;
      if (overTrash) {
        this.world.remove(c);
        return;
      }
      c.root.position.y = 0;
      // Pitch is only for inspecting while held; components always land flat.
      c.root.rotation.x = 0;
      c.root.rotation.z = 0;
      this.mode = mode;
      this.moveCarried();
      this.mode = { kind: 'idle' };
      this.world.trySnap(c);
    } else if (mode.kind === 'wire' && p) {
      const target = this.world.pinAt(p.px, p.py);
      if (target) this.world.addWire(mode.from, { componentId: target.component.id, pin: target.pin });
    } else if (mode.kind === 'holdWire' && overTrash) {
      this.world.removeWire(mode.wire);
      this.setHoverWire(null);
    }
  }

  private setHoverWire(w: Wire | null): void {
    if (w === this.hoverWire) return;
    this.hoverWire?.setHighlight(false);
    w?.setHighlight(true);
    this.hoverWire = w;
  }
}

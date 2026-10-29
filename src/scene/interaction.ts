import * as THREE from 'three';
import type { SceneComponent } from '../components/component';
import type { SceneManager } from './sceneManager';
import type { PinHit, World } from './world';

/** Input-agnostic pointer: driven by the mouse in mouse mode, by the pinch point in hand mode. */
export interface PointerState {
  px: number;
  py: number;
  down: boolean;
}

const LIFT = 0.15;

/** Hover / grab / move / release of components. Rotation is applied by the caller via `rotateGrabbed`. */
export class Interaction {
  hoverPin: PinHit | null = null;
  hoverComponent: SceneComponent | null = null;
  grabbed: SceneComponent | null = null;

  private wasDown = false;
  private offset = new THREE.Vector3();
  private grabRotation = new THREE.Euler();

  constructor(
    private sm: SceneManager,
    private world: World,
  ) {}

  update(p: PointerState | null): void {
    if (!p) {
      if (this.grabbed) this.release();
      this.hoverPin = null;
      this.hoverComponent = null;
      this.wasDown = false;
      return;
    }

    const pressed = p.down && !this.wasDown;
    const released = !p.down && this.wasDown;
    this.wasDown = p.down;

    if (pressed) this.tryGrab(p);
    else if (released && this.grabbed) this.release();

    if (this.grabbed) {
      const hit = this.sm.screenToWorkspace(p.px, p.py, LIFT);
      if (hit) {
        this.grabbed.root.position.set(hit.x + this.offset.x, LIFT, hit.z + this.offset.z);
      }
      this.hoverPin = null;
      this.hoverComponent = this.grabbed;
    } else {
      this.hoverPin = this.world.pinAt(p.px, p.py);
      this.hoverComponent = this.world.componentAt(p.px, p.py);
    }
  }

  /** Rotation relative to the orientation the component had when grabbed. */
  rotateGrabbed(yaw: number, pitch = 0): void {
    if (!this.grabbed) return;
    this.grabbed.root.rotation.set(this.grabRotation.x + pitch, this.grabRotation.y + yaw, this.grabRotation.z);
  }

  /** Rotate the grabbed component (or the hovered one) by a fixed step around Y. */
  rotateStep(yaw: number): void {
    const c = this.grabbed ?? this.hoverComponent;
    if (!c) return;
    c.root.rotation.y += yaw;
    if (c === this.grabbed) this.grabRotation.y += yaw;
  }

  private tryGrab(p: PointerState): void {
    const c = this.world.componentAt(p.px, p.py);
    if (!c) return;
    const hit = this.sm.screenToWorkspace(p.px, p.py, LIFT);
    if (!hit) return;
    this.grabbed = c;
    this.offset.set(c.root.position.x - hit.x, 0, c.root.position.z - hit.z);
    this.grabRotation.copy(c.root.rotation);
  }

  private release(): void {
    const c = this.grabbed!;
    c.root.position.y = 0;
    // Pitch is only for inspecting while held; components always land flat.
    c.root.rotation.x = 0;
    c.root.rotation.z = 0;
    this.grabbed = null;
  }
}

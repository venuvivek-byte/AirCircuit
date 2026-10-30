import * as THREE from 'three';
import { config } from '../config';
import type { SceneComponent } from '../components/component';
import { isPinEnd, type EndName, type Wire } from '../components/wire';
import type { PinRef } from '../sim/types';
import type { SceneManager } from './sceneManager';
import type { LooseEndHit, PinHit, World } from './world';

/** Hand grip: a fist grabs / moves / rotates components, a pinch draws wires. */
export type Grip = 'fist' | 'pinch';

/** Input-agnostic pointer: driven by the mouse in mouse mode, by the hand in hand mode. */
export interface PointerState {
  px: number;
  py: number;
  down: boolean;
  /** Hand mode only. Undefined (mouse) means one button does everything, by what is under it. */
  grip?: Grip;
}

const LIFT = 0.15;
/** Height above the table at which a loose wire end floats. */
const WIRE_LOOSE_Y = 0.2;

function toRef(pin: PinHit): PinRef {
  return { componentId: pin.component.id, pin: pin.pin };
}

function sameRef(a: PinRef, b: PinRef): boolean {
  return a.componentId === b.componentId && a.pin === b.pin;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'grab'; component: SceneComponent; carried: Array<{ c: SceneComponent; rel: THREE.Matrix4 }> }
  /** Dragging one end of a wire. `fresh`: the wire was started by this pinch. */
  | { kind: 'wire'; wire: Wire; end: EndName; fresh: boolean }
  /** Holding a wire by its body: drag to the trash to delete, or hold still to unplug the nearest end. */
  | { kind: 'holdWire'; wire: Wire; end: EndName; since: number; px: number; py: number; moved: boolean };

/**
 * Pointer interaction: grab / move / rotate / drop components (snapping into the breadboard),
 * drag from a pin to create wires, and drop a component or wire on the trash to delete it.
 * A wire end released away from any pin stays loose in the air and can be picked up again;
 * holding a wire still for `wireDetachMs` unplugs its nearest end into the hand.
 */
export class Interaction {
  hoverPin: PinHit | null = null;
  hoverComponent: SceneComponent | null = null;
  hoverWire: Wire | null = null;
  hoverLoose: LooseEndHit | null = null;
  /** Wire the scissors are aimed at (shown red). */
  cutWire: Wire | null = null;

  private mode: Mode = { kind: 'idle' };
  private wasDown = false;
  private offset = new THREE.Vector3();
  private grabRotation = new THREE.Euler();
  /** Ring around the pin / wire end a pinch would act on. */
  private marker: THREE.Mesh;

  constructor(
    private sm: SceneManager,
    private world: World,
    /** True when the screen point is over the trash drop zone. */
    private isOverTrash: (px: number, py: number) => boolean,
  ) {
    const r = config.components.breadboardPitch;
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.3, r * 0.48, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.marker.renderOrder = 20;
    this.marker.visible = false;
    sm.workspace.add(this.marker);
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

  /** 0..1 while a held wire counts down to unplugging its nearest end, else null. */
  get detachProgress(): number | null {
    const m = this.mode;
    if (m.kind !== 'holdWire' || m.moved) return null;
    return Math.min(1, (performance.now() - m.since) / config.interaction.wireDetachMs);
  }

  update(p: PointerState | null): void {
    if (!p) {
      this.finish(null);
      this.hoverPin = null;
      this.hoverComponent = null;
      this.hoverLoose = null;
      this.setHoverWire(null);
      this.wasDown = false;
      this.world.updateWires();
      this.updateMarker();
      return;
    }

    // A wire held by this action vanishes if the part it is plugged into is deleted.
    if ((this.mode.kind === 'wire' || this.mode.kind === 'holdWire') && !this.world.wires.includes(this.mode.wire)) {
      this.mode = { kind: 'idle' };
    }

    const pressed = p.down && !this.wasDown;
    const released = !p.down && this.wasDown;
    this.wasDown = p.down;

    if (pressed) this.begin(p);
    else if (released) this.finish(p);

    if (this.mode.kind !== 'idle') this.hoverLoose = null;
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
        // The dragged end follows the hand, snapping onto the highlighted pin (it plugs in on release).
        this.hoverPin = this.world.pinAtSticky(p.px, p.py, this.hoverPin);
        const point = this.hoverPin
          ? this.world.pinLocal(toRef(this.hoverPin))
          : this.sm.screenToWorkspace(p.px, p.py, WIRE_LOOSE_Y);
        if (point) this.world.setWireEnd(this.mode.wire, this.mode.end, { point });
        break;
      }
      case 'holdWire': {
        this.hoverPin = null;
        const m = this.mode;
        const { wireDetachMs, wireDetachMovePx } = config.interaction;
        if (Math.hypot(p.px - m.px, p.py - m.py) > wireDetachMovePx) m.moved = true;
        if (!m.moved && performance.now() - m.since >= wireDetachMs) {
          // Unplug the nearest end into the hand; the next frames drag it like a new wire end.
          this.world.setWireEnd(m.wire, m.end, { point: this.world.endLocal(m.wire[m.end]) });
          this.mode = { kind: 'wire', wire: m.wire, end: m.end, fresh: false };
          this.setHoverWire(null);
        }
        break;
      }
      case 'idle':
        this.hoverLoose = this.world.looseEndAt(p.px, p.py);
        this.hoverPin = this.hoverLoose ? null : this.world.pinAtSticky(p.px, p.py, this.hoverPin);
        this.hoverComponent = this.world.componentAt(p.px, p.py)?.component ?? null;
        // Loose ends win over pins; wires lying over the breadboard win over the holes beneath them.
        this.setHoverWire(
          this.hoverLoose?.wire ??
            (this.hoverPin && this.hoverPin.component.type !== 'breadboard' ? null : this.world.wireAt(p.px, p.py)),
        );
        if (this.hoverWire) this.hoverPin = null;
        break;
    }
    this.world.updateWires();
    this.updateMarker();
  }

  private updateMarker(): void {
    this.marker.visible = this.markerAt(this.marker.position);
    this.marker.position.y += 0.01;
  }

  /** Where the target ring goes: the end about to unplug, a hovered loose end, or the hovered pin. */
  private markerAt(target: THREE.Vector3): boolean {
    const m = this.mode;
    if (m.kind === 'holdWire') {
      if (!m.moved) this.world.endLocal(m.wire[m.end], target);
      return !m.moved;
    }
    if (this.hoverLoose) {
      this.world.endLocal(this.hoverLoose.wire[this.hoverLoose.end], target);
      return true;
    }
    if (this.hoverPin) {
      this.world.pinLocal(toRef(this.hoverPin), target);
      return true;
    }
    return false;
  }

  /**
   * Scissors at a screen point (null = not in the scissor pose): the nearest wire turns red,
   * and a snip deletes it. Call after update() so it overrides the normal hover highlight.
   */
  scissors(cut: { px: number; py: number; snip: boolean } | null): void {
    const w = cut && !this.busy ? this.world.wireNear(cut.px, cut.py, config.interaction.cutRadiusPx) : null;
    if (cut) {
      this.setHoverWire(null);
      this.hoverPin = null;
      this.hoverLoose = null;
      this.marker.visible = false;
    }
    if (w !== this.cutWire) this.cutWire?.setHighlight(false);
    // Re-applied every frame: clearing the hover glow above may have reset it.
    w?.setHighlight('cut');
    this.cutWire = w;
    if (w && cut?.snip) {
      this.world.removeWire(w);
      this.cutWire = null;
    }
  }

  /** Abort the current action without dropping on the trash or connecting a wire (a dragged end stays loose). */
  cancel(): void {
    if (this.mode.kind !== 'idle') this.finish(null);
    this.wasDown = false;
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
    // Start from the highlighted pin (what the user saw), falling back to a fresh pick.
    const pin = this.hoverPin ?? this.world.pinAt(p.px, p.py);
    const loose = this.hoverLoose;

    if (p.grip === 'fist') {
      // Fist: grab whatever part is under the palm (the breadboard anywhere on its body).
      if (hit) this.startGrab(hit.component, p);
      return;
    }
    // A loose wire end (pinch or click) is picked straight back up, to carry on wiring from there.
    if (loose) {
      this.mode = { kind: 'wire', wire: loose.wire, end: loose.end, fresh: false };
      return;
    }
    if (p.grip === 'pinch') {
      // Pinch: wires only. A pin starts a new wire; a highlighted wire is held (trash it, or unplug an end).
      if (pin) this.startWire(pin);
      else if (this.hoverWire) this.startHold(this.hoverWire, p);
      return;
    }

    if (hit && hit.component.type !== 'breadboard') {
      // On a part: its own pin starts a wire, anywhere else grabs it.
      if (pin && pin.component === hit.component) this.startWire(pin);
      else this.startGrab(hit.component, p);
    } else if (hit?.object.userData.handle) {
      this.startGrab(hit.component, p);
    } else if (this.hoverWire) {
      this.startHold(this.hoverWire, p);
    } else if (pin) {
      this.startWire(pin);
    } else if (hit) {
      this.startGrab(hit.component, p);
    }
  }

  private startWire(pin: PinHit): void {
    const ref = toRef(pin);
    const wire = this.world.addWire(ref, { point: this.world.pinLocal(ref) });
    if (wire) this.mode = { kind: 'wire', wire, end: 'b', fresh: true };
  }

  private startHold(wire: Wire, p: PointerState): void {
    const d = (end: EndName) => {
      const s = this.world.endScreen(wire, end);
      return Math.hypot(s.px - p.px, s.py - p.py);
    };
    const end = d('a') <= d('b') ? 'a' : 'b';
    this.mode = { kind: 'holdWire', wire, end, since: performance.now(), px: p.px, py: p.py, moved: false };
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
    } else if (mode.kind === 'wire') {
      const { wire, end } = mode;
      if (overTrash) {
        this.world.removeWire(wire);
        this.setHoverWire(null);
        return;
      }
      // Plug only into the pin highlighted while dragging, never a fresh pick at the release point.
      // Without a valid pin (or when the hand was lost) the end stays loose where it is.
      const ref = p && this.hoverPin ? toRef(this.hoverPin) : null;
      const other = wire[end === 'a' ? 'b' : 'a'];
      const invalid = !ref || (isPinEnd(other) && (sameRef(other, ref) || this.world.isDuplicate(other, ref, wire)));
      if (ref && !invalid) {
        this.world.setWireEnd(wire, end, ref);
      } else if (mode.fresh && this.endsTouch(wire)) {
        // A new wire dropped back on its own start pin was an accidental pinch: leave no stub.
        this.world.removeWire(wire);
      }
    } else if (mode.kind === 'holdWire' && overTrash) {
      this.world.removeWire(mode.wire);
      this.setHoverWire(null);
    }
  }

  /** Both ends of the wire within a pick radius of each other on screen. */
  private endsTouch(w: Wire): boolean {
    const a = this.world.endScreen(w, 'a');
    const b = this.world.endScreen(w, 'b');
    return Math.hypot(a.px - b.px, a.py - b.py) <= config.interaction.pinStickRadiusPx;
  }

  private setHoverWire(w: Wire | null): void {
    if (w === this.hoverWire) return;
    this.hoverWire?.setHighlight(false);
    w?.setHighlight(true);
    this.hoverWire = w;
  }
}

import {
  FistDetector,
  PinchDetector,
  RotationTracker,
  TwoHandTwistTracker,
  palmCenter,
  pinchPoint,
} from '../tracking/gestures';
import type { TrackedHand } from '../tracking/types';
import type { Grip, PointerState } from './interaction';

export interface HandFrame {
  /** Pointer for the primary hand in screen px (palm centre while a fist, else pinch point), or null. */
  pointer: PointerState | null;
  /** Primary-hand grip this frame, and whether it began this frame. */
  grip: Grip | null;
  gripStarted: boolean;
  /** True when the grip switched directly between pinch and fist (the current action must be cancelled). */
  gripSwitched: boolean;
  /** Grip of every tracked hand, slot order (for the skeleton overlay). */
  grips: Array<Grip | null>;
  /** Rotation delta since the grab started (radians), or null when not rotating. */
  rotation: { yaw: number; pitch: number } | null;
}

/**
 * Turns smoothed hands into a pointer plus rotation for `Interaction`.
 * A fist grabs, moves and (by rolling the wrist) rotates components; a pinch draws wires.
 * Hand slot 0 is primary. If the second hand also grips while holding, a two-hand twist takes over yaw.
 */
export class HandControl {
  private pinches = [new PinchDetector(), new PinchDetector()];
  private fists = [new FistDetector(), new FistDetector()];
  private rotation = new RotationTracker();
  private twist = new TwoHandTwistTracker();
  private twistBaseYaw = 0;
  private yawOffset = 0;
  private lastYaw = 0;
  private lastGrip: Grip | null = null;

  constructor(private toScreen: (x: number, y: number) => { px: number; py: number }) {}

  update(hands: TrackedHand[], holding: boolean): HandFrame {
    const grips = this.pinches.map((pinch, i): Grip | null => {
      const h = hands[i];
      const fist = this.fists[i].update(h ? (h.world ?? h.landmarks) : null);
      // A fist overrides (and ends) any pinch.
      const pinching = pinch.update(h && !fist ? h.landmarks : null, h?.world).pinching;
      return fist ? 'fist' : pinching ? 'pinch' : null;
    });
    const grip = grips[0];
    const gripStarted = grip !== null && this.lastGrip === null;
    const gripSwitched = grip !== null && this.lastGrip !== null && grip !== this.lastGrip;
    this.lastGrip = grip;

    const primary = hands[0];
    if (!primary) {
      this.rotation.end();
      this.twist.end();
      return { pointer: null, grip: null, gripStarted: false, gripSwitched: false, grips, rotation: null };
    }

    const anchor = grip === 'fist' ? palmCenter(primary.landmarks) : pinchPoint(primary.landmarks);
    const { px, py } = this.toScreen(anchor.x, anchor.y);
    const pointer: PointerState = { px, py, down: grip !== null, grip: grip ?? undefined };

    let rotation: HandFrame['rotation'] = null;
    if (holding && grip === 'fist') {
      if (!this.rotation.isActive) this.rotation.begin(primary.landmarks);
      // Screen-clockwise wrist roll should spin the part clockwise seen from above: negative Three.js yaw.
      const r = this.rotation.update(primary.landmarks);
      rotation = { yaw: -r.yaw + this.yawOffset, pitch: r.pitch };

      const second = hands[1];
      if (second && grips[1] !== null) {
        if (!this.twist.isActive) {
          this.twist.begin(primary.landmarks, second.landmarks);
          this.twistBaseYaw = this.lastYaw;
        }
        rotation.yaw = this.twistBaseYaw - this.twist.update(primary.landmarks, second.landmarks);
      } else if (this.twist.isActive) {
        // Keep the yaw the twist left behind instead of snapping back to the wrist roll.
        this.twist.end();
        this.yawOffset = this.lastYaw + r.yaw;
        rotation.yaw = this.lastYaw;
      }
      this.lastYaw = rotation.yaw;
    } else {
      this.rotation.end();
      this.twist.end();
      this.yawOffset = 0;
      this.lastYaw = 0;
    }

    return { pointer, grip, gripStarted, gripSwitched, grips, rotation };
  }
}

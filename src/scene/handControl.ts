import { PinchDetector, RotationTracker, TwoHandTwistTracker, pinchPoint, type PinchEvent } from '../tracking/gestures';
import type { TrackedHand } from '../tracking/types';
import type { PointerState } from './interaction';

export interface HandFrame {
  /** Pointer for the primary hand (pinch point in screen px), or null when no hand. */
  pointer: PointerState | null;
  /** Primary-hand pinch edge events. */
  pinch: PinchEvent;
  /** Rotation delta since the grab started (radians), or null when not rotating. */
  rotation: { yaw: number; pitch: number } | null;
}

/**
 * Turns smoothed hands into a pointer plus rotation for `Interaction`.
 * Hand slot 0 is primary. While it holds a pinch, wrist roll rotates the grabbed component;
 * if the second hand also pinches, the two-hand twist takes over yaw.
 */
export class HandControl {
  private pinches = [new PinchDetector(), new PinchDetector()];
  private rotation = new RotationTracker();
  private twist = new TwoHandTwistTracker();
  private twistBaseYaw = 0;
  private yawOffset = 0;
  private lastYaw = 0;

  constructor(private toScreen: (x: number, y: number) => { px: number; py: number }) {}

  update(hands: TrackedHand[], holding: boolean): HandFrame {
    const events = this.pinches.map((d, i) => d.update(hands[i]?.landmarks ?? null, hands[i]?.world));
    const primary = hands[0];
    if (!primary) {
      this.rotation.end();
      this.twist.end();
      return { pointer: null, pinch: events[0], rotation: null };
    }

    const pp = pinchPoint(primary.landmarks);
    const { px, py } = this.toScreen(pp.x, pp.y);
    const pointer = { px, py, down: events[0].pinching };

    let rotation: HandFrame['rotation'] = null;
    if (holding && events[0].pinching) {
      if (!this.rotation.isActive) this.rotation.begin(primary.landmarks);
      // Screen-clockwise wrist roll should spin the part clockwise seen from above: negative Three.js yaw.
      const r = this.rotation.update(primary.landmarks);
      rotation = { yaw: -r.yaw + this.yawOffset, pitch: r.pitch };

      const second = hands[1];
      if (second && events[1].pinching) {
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

    return { pointer, pinch: events[0], rotation };
  }
}

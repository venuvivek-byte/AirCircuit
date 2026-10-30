import { config } from '../config';
import {
  DepthTracker,
  FistDetector,
  PoseHold,
  menuPose,
  type MenuPose,
  PinchDetector,
  RotationTracker,
  ScissorDetector,
  TwoHandTwistTracker,
  palmCenter,
  pinchPoint,
  scissorPoint,
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
  /** While holding with a fist: hand distance relative to grab start (> 1 = closer to camera), else null. */
  depth: number | null;
  /** Primary hand in the scissor (V-sign) pose: cut point in screen px, spread state, snip this frame. */
  scissors: { px: number; py: number; open: boolean; snip: boolean } | null;
  /** Menu pose (finger count): `fired` on the frame it opens a menu, `holding` + progress before that. */
  menu: { fired: MenuPose | null; holding: MenuPose | null; progress: number };
}

/**
 * Turns smoothed hands into a pointer plus rotation for `Interaction`.
 * A fist grabs, moves and (by rolling the wrist) rotates components; a pinch draws wires.
 * Hand slot 0 is primary. If the second hand also grips while holding, a two-hand twist takes over yaw.
 * While holding, moving the fist toward / away from the camera reports `depth` (sizes the held part).
 * A V sign (index + middle out) is scissors: spreading then closing the two fingers on a wire cuts it.
 */
export class HandControl {
  private pinches = [new PinchDetector(), new PinchDetector()];
  private fists = [new FistDetector(), new FistDetector()];
  private rotation = new RotationTracker();
  private twist = new TwoHandTwistTracker();
  private depthTracker = new DepthTracker();
  private scissorDetector = new ScissorDetector();
  private poseHold = new PoseHold<MenuPose>();
  private twistBaseYaw = 0;
  private yawOffset = 0;
  private lastYaw = 0;
  private lastGrip: Grip | null = null;
  /** Pinch point while the fingers were still closed; held while they open so a release doesn't drift. */
  private heldPinch: { px: number; py: number } | null = null;
  private openingFrames = 0;

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
    const prevGrip = this.lastGrip;
    const gripStarted = grip !== null && this.lastGrip === null;
    const gripSwitched = grip !== null && this.lastGrip !== null && grip !== this.lastGrip;
    this.lastGrip = grip;

    const primary = hands[0];
    if (!primary) {
      this.heldPinch = null;
      this.rotation.end();
      this.twist.end();
      this.depthTracker.end();
      this.scissorDetector.update(null);
      const menu = this.poseHold.update(null, performance.now());
      return { pointer: null, grip: null, gripStarted: false, gripSwitched: false, grips, rotation: null, depth: null, scissors: null, menu };
    }

    const anchor = grip === 'fist' ? palmCenter(primary.landmarks) : pinchPoint(primary.landmarks);
    let { px, py } = this.toScreen(anchor.x, anchor.y);
    // Opening the fingers moves their midpoint: freeze the pointer from the moment they start to
    // separate through the release frame, so a wire lands on the pin that was highlighted.
    // A loose pinch held in the hysteresis band for long is a drag, not a release: stop freezing.
    const opening = grip === 'pinch' && this.pinches[0].opening;
    this.openingFrames = opening ? this.openingFrames + 1 : 0;
    const releasingPinch =
      (opening && this.openingFrames <= config.gestures.pinchFreezeMaxFrames) || (grip === null && prevGrip === 'pinch');
    if (releasingPinch && this.heldPinch) ({ px, py } = this.heldPinch);
    else this.heldPinch = grip === 'pinch' ? { px, py } : null;
    const pointer: PointerState = { px, py, down: grip !== null, grip: grip ?? undefined };

    let rotation: HandFrame['rotation'] = null;
    let depth: number | null = null;
    if (holding && grip === 'fist') {
      if (!this.rotation.isActive) this.rotation.begin(primary.landmarks);
      if (!this.depthTracker.isActive) this.depthTracker.begin(primary.landmarks);
      depth = this.depthTracker.update(primary.landmarks);
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
      this.depthTracker.end();
      this.yawOffset = 0;
      this.lastYaw = 0;
    }

    // Scissors only while no fist / pinch is held.
    const sc = this.scissorDetector.update(grip === null ? primary.landmarks : null, primary.world);
    let scissors: HandFrame['scissors'] = null;
    if (sc.active) {
      const cut = scissorPoint(primary.landmarks);
      scissors = { ...this.toScreen(cut.x, cut.y), open: sc.open, snip: sc.snip };
    }

    // Finger-count menu poses only with an empty, relaxed hand (no grip, not scissors).
    const pose = grip === null && !sc.active ? menuPose(primary.world ?? primary.landmarks) : null;
    const menu = this.poseHold.update(pose, performance.now());

    return { pointer, grip, gripStarted, gripSwitched, grips, rotation, depth, scissors, menu };
  }
}

// Pure gesture recognition from hand landmarks (MVP_SPEC §3.4, §6). No Three.js / DOM.
//
// All 2D measurements use normalized image coordinates (x right, y down, already mirrored).
// Note: x and y are normalized by image width and height respectively, so with a non-square
// camera (e.g. 16:9) angles and distances are slightly anisotropic. Ratios (pinchRatio) and
// deltas (roll since pinch start) are largely insensitive to this.

import { config } from '../config';
import { LM, type HandLandmarks, type Landmark } from './types';

// ---------------------------------------------------------------------------
// Basic geometry
// ---------------------------------------------------------------------------

function dist2(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dist3(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 2D distance wrist -> middle MCP: a robust per-frame hand-size normalizer. */
export function handSize(lm: HandLandmarks): number {
  return dist2(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
}

/** 2D thumb tip <-> index tip distance divided by handSize (scale invariant). */
export function pinchRatio(lm: HandLandmarks): number {
  const size = handSize(lm);
  if (size <= 1e-9) return Infinity;
  return dist2(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / size;
}

/**
 * 3D thumb tip <-> index tip distance divided by 3D palm size. Fed MediaPipe world landmarks it
 * is unaffected by foreshortening, so pinches register even with the hand edge-on to the camera.
 */
export function pinchRatio3D(lm: HandLandmarks): number {
  const size = dist3(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
  if (size <= 1e-9) return Infinity;
  return dist3(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / size;
}

/** Best available pinch ratio for a hand: 3D world landmarks when present, else 2D image ones. */
export function handPinchRatio(lm: HandLandmarks, world?: HandLandmarks): number {
  return world ? pinchRatio3D(world) : pinchRatio(lm);
}

/** Midpoint of thumb tip and index tip: where grabbed objects attach. */
export function pinchPoint(lm: HandLandmarks): Landmark {
  const t = lm[LM.THUMB_TIP];
  const i = lm[LM.INDEX_TIP];
  return { x: (t.x + i.x) / 2, y: (t.y + i.y) / 2, z: (t.z + i.z) / 2 };
}

/** Wrap an angle to (-π, π]. */
function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  else if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** Signed shortest angular difference b - a, wrapped to (-π, π]. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/**
 * In-image-plane roll (radians) of the vector index MCP -> pinky MCP, atan2 in image coords
 * (y down), so a hand rotating clockwise on screen increases the angle.
 */
export function wristRoll(lm: HandLandmarks): number {
  const a = lm[LM.INDEX_MCP];
  const b = lm[LM.PINKY_MCP];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Palm pitch (radians) from the depth difference wrist -> middle MCP relative to their 2D
 * distance. Positive when the top of the palm (middle MCP) is closer to the camera than the wrist.
 */
export function palmTilt(lm: HandLandmarks): number {
  const w = lm[LM.WRIST];
  const m = lm[LM.MIDDLE_MCP];
  return Math.atan2(w.z - m.z, dist2(w, m));
}

/** Angle (radians) of the vector from hand A's pinch point to hand B's pinch point. */
export function twoHandTwist(lmA: HandLandmarks, lmB: HandLandmarks): number {
  const a = pinchPoint(lmA);
  const b = pinchPoint(lmB);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Soft deadzone: zero inside ±dz, then continues linearly (no jump at the edge). */
function deadzone(v: number, dz: number): number {
  const m = Math.abs(v) - dz;
  return m > 0 ? Math.sign(v) * m : 0;
}

// ---------------------------------------------------------------------------
// Pinch
// ---------------------------------------------------------------------------

export type PinchEvent = { pinching: boolean; started: boolean; ended: boolean };

/**
 * Pinch state machine with hysteresis: closes below `close`, opens above `open`, and only after
 * `releaseFrames` consecutive open frames so one noisy frame can't drop a drag.
 */
export class PinchDetector {
  private pinching = false;
  private openFrames = 0;
  private closedFrames = 0;
  private lastRatio = Infinity;

  constructor(
    private readonly close: number = config.gestures.pinchClose,
    private readonly open: number = config.gestures.pinchOpen,
    private readonly releaseFrames: number = config.gestures.pinchReleaseFrames,
    private readonly startFrames: number = config.gestures.pinchStartFrames,
    private readonly minIndexCurl: number = config.gestures.pinchMinIndexCurl,
  ) {}

  /**
   * Feed one frame of landmarks (null = hand lost, which ends an active pinch).
   * Pass the hand's world landmarks too when available for an orientation-independent ratio.
   */
  update(lm: HandLandmarks | null, world?: HandLandmarks): PinchEvent {
    const was = this.pinching;
    if (lm === null) {
      this.pinching = false;
      this.lastRatio = Infinity;
    } else {
      const r = handPinchRatio(lm, world);
      this.lastRatio = r;
      if (!was) {
        const closed = r < this.close && fingerCurl(world ?? lm, 0) > this.minIndexCurl;
        this.closedFrames = closed ? this.closedFrames + 1 : 0;
        if (this.closedFrames >= this.startFrames) this.pinching = true;
      } else if (r > this.open) {
        if (++this.openFrames >= this.releaseFrames) this.pinching = false;
      } else this.openFrames = 0;
    }
    if (!this.pinching) this.openFrames = 0;
    else this.closedFrames = 0;
    return { pinching: this.pinching, started: !was && this.pinching, ended: was && !this.pinching };
  }

  get isPinching(): boolean {
    return this.pinching;
  }

  /** Pinch ratio of the last frame (Infinity without a hand). */
  get ratio(): number {
    return this.lastRatio;
  }

  /** Still pinching, but the fingers have started to separate (ratio above the close threshold). */
  get opening(): boolean {
    return this.pinching && this.lastRatio > this.close;
  }

  reset(): void {
    this.pinching = false;
    this.openFrames = 0;
    this.closedFrames = 0;
    this.lastRatio = Infinity;
  }
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/**
 * Tracks wrist roll / palm tilt relative to a reference taken at begin() (typically pinch start).
 * update() returns the delta with soft deadzones: roll -> yaw (about Y), tilt -> pitch (about X).
 * Sign: positive yaw = hand rolled clockwise on screen; positive pitch = fingers tipped toward camera.
 * The consumer may negate these to match its scene handedness.
 */
export class RotationTracker {
  private refRoll = 0;
  private refTilt = 0;
  private active = false;

  constructor(
    private readonly rollDeadzone: number = config.gestures.rollDeadzoneRad,
    private readonly tiltDeadzone: number = config.gestures.tiltDeadzoneRad,
  ) {}

  begin(lm: HandLandmarks): void {
    this.refRoll = wristRoll(lm);
    this.refTilt = palmTilt(lm);
    this.active = true;
  }

  update(lm: HandLandmarks): { yaw: number; pitch: number } {
    if (!this.active) this.begin(lm);
    return {
      yaw: deadzone(angleDelta(this.refRoll, wristRoll(lm)), this.rollDeadzone),
      pitch: deadzone(angleDelta(this.refTilt, palmTilt(lm)), this.tiltDeadzone),
    };
  }

  end(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }
}

/**
 * Two-hand twist: yaw delta of the vector between both hands' pinch points since begin().
 * Keep the (A, B) argument order consistent (e.g. sorted by handedness), otherwise the
 * vector flips by π.
 */
export class TwoHandTwistTracker {
  private ref = 0;
  private active = false;

  constructor(private readonly dz: number = config.gestures.rollDeadzoneRad) {}

  begin(lmA: HandLandmarks, lmB: HandLandmarks): void {
    this.ref = twoHandTwist(lmA, lmB);
    this.active = true;
  }

  update(lmA: HandLandmarks, lmB: HandLandmarks): number {
    if (!this.active) this.begin(lmA, lmB);
    return deadzone(angleDelta(this.ref, twoHandTwist(lmA, lmB)), this.dz);
  }

  end(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }
}

/**
 * Hand distance from the camera relative to begin(), from apparent palm size: > 1 = hand moved
 * closer, < 1 = moved back. Uses whichever of palm length (wrist -> middle MCP) and width (index ->
 * pinky MCP) shrank least, so tilting or turning the hand (which foreshortens one) isn't read as
 * moving it. Soft deadzone in log space so ordinary carrying doesn't register.
 */
export class DepthTracker {
  private refLength = 0;
  private refWidth = 0;
  private active = false;

  constructor(private readonly dz: number = config.gestures.depthDeadzone) {}

  begin(lm: HandLandmarks): void {
    this.refLength = handSize(lm);
    this.refWidth = dist2(lm[LM.INDEX_MCP], lm[LM.PINKY_MCP]);
    this.active = true;
  }

  update(lm: HandLandmarks): number {
    if (!this.active) this.begin(lm);
    if (this.refLength <= 1e-9 || this.refWidth <= 1e-9) return 1;
    const r = Math.max(handSize(lm) / this.refLength, dist2(lm[LM.INDEX_MCP], lm[LM.PINKY_MCP]) / this.refWidth);
    return Math.exp(deadzone(Math.log(r), this.dz));
  }

  end(): void {
    this.active = false;
  }

  get isActive(): boolean {
    return this.active;
  }
}

// ---------------------------------------------------------------------------
// Press
// ---------------------------------------------------------------------------

/**
 * Button press hysteresis. `penetration` = how far (scene units, positive = pushed in) the
 * fingertip is past the button's front face; null = fingertip not over the button (re-arms).
 * Returns true exactly once when penetration crosses `depth`; re-arms below `release`.
 */
export class PressDetector {
  private armed = true;

  constructor(
    private readonly depth: number = config.gestures.pressDepth,
    private readonly release: number = config.gestures.pressReleaseDepth,
  ) {}

  update(penetration: number | null): boolean {
    if (penetration === null || penetration < this.release) {
      this.armed = true;
      return false;
    }
    if (this.armed && penetration >= this.depth) {
      this.armed = false;
      return true;
    }
    return false;
  }

  reset(): void {
    this.armed = true;
  }
}

// ---------------------------------------------------------------------------
// Fist
// ---------------------------------------------------------------------------

/**
 * How extended a finger is (0 = index .. 3 = pinky): 3D distance wrist->tip over wrist->PIP.
 * About 1.5-2 when straight, below 1 when curled into the palm. Scale and orientation invariant.
 */
export function fingerCurl(lm: HandLandmarks, finger: 0 | 1 | 2 | 3): number {
  const f = FINGERS[finger];
  const w = lm[LM.WRIST];
  const pip = dist3(w, lm[f.pip]);
  return pip <= 1e-9 ? Infinity : dist3(w, lm[f.tip]) / pip;
}

/** Palm centre (wrist + four knuckles): stable whether the hand is open or a fist. */
export function palmCenter(lm: HandLandmarks): Landmark {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  const c = { x: 0, y: 0, z: 0 };
  for (const i of ids) {
    c.x += lm[i].x / ids.length;
    c.y += lm[i].y / ids.length;
    c.z += lm[i].z / ids.length;
  }
  return c;
}

/**
 * Fist state machine: closes once every finger's curl is below `close` for `startFrames`
 * frames, opens once the mean curl is above `open` for `releaseFrames` frames.
 */
export class FistDetector {
  private active = false;
  private count = 0;

  constructor(
    private readonly close: number = config.gestures.fistClose,
    private readonly open: number = config.gestures.fistOpen,
    private readonly startFrames: number = config.gestures.fistStartFrames,
    private readonly releaseFrames: number = config.gestures.fistReleaseFrames,
  ) {}

  /** Feed one frame (null = hand lost, which ends the fist). Prefer world landmarks when available. */
  update(lm: HandLandmarks | null): boolean {
    if (lm === null) {
      this.active = false;
      this.count = 0;
      return false;
    }
    const curls = [0, 1, 2, 3].map((i) => fingerCurl(lm, i as 0 | 1 | 2 | 3));
    const flip = this.active
      ? curls.reduce((a, b) => a + b, 0) / 4 > this.open
      : curls.every((c) => c < this.close);
    this.count = flip ? this.count + 1 : 0;
    if (this.count >= (this.active ? this.releaseFrames : this.startFrames)) {
      this.active = !this.active;
      this.count = 0;
    }
    return this.active;
  }

  get isFist(): boolean {
    return this.active;
  }
}

// ---------------------------------------------------------------------------
// Scissors
// ---------------------------------------------------------------------------

/** Index tip <-> middle tip distance over palm size; 3D from world landmarks when given. */
export function fingerGap(lm: HandLandmarks, world?: HandLandmarks): number {
  const h = world ?? lm;
  const d = world ? dist3 : dist2;
  const size = d(h[LM.WRIST], h[LM.MIDDLE_MCP]);
  return size <= 1e-9 ? Infinity : d(h[LM.INDEX_TIP], h[LM.MIDDLE_TIP]) / size;
}

/** V sign: index and middle extended, ring and pinky curled. */
export function isScissorPose(
  lm: HandLandmarks,
  extended: number = config.gestures.scissorExtended,
  curled: number = config.gestures.scissorCurled,
): boolean {
  return (
    fingerCurl(lm, 0) > extended && fingerCurl(lm, 1) > extended && fingerCurl(lm, 2) < curled && fingerCurl(lm, 3) < curled
  );
}

/** Cut point: midpoint of the index and middle fingertips. */
export function scissorPoint(lm: HandLandmarks): Landmark {
  const a = lm[LM.INDEX_TIP];
  const b = lm[LM.MIDDLE_TIP];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export type ScissorEvent = { active: boolean; open: boolean; snip: boolean };

/**
 * Scissor gesture: `active` while the V-sign pose is held; `snip` fires once when the fingers,
 * having been spread open, close together. Just holding them together never snips, so a resting
 * two-finger pose can't cut by accident.
 */
export class ScissorDetector {
  private poseFrames = 0;
  private opened = false;

  constructor(
    private readonly open: number = config.gestures.scissorOpen,
    private readonly close: number = config.gestures.scissorClose,
    private readonly startFrames: number = config.gestures.scissorStartFrames,
  ) {}

  /** Feed one frame (null = hand lost or busy with another grip). Pass world landmarks when available. */
  update(lm: HandLandmarks | null, world?: HandLandmarks): ScissorEvent {
    const pose = lm !== null && isScissorPose(world ?? lm);
    this.poseFrames = pose ? this.poseFrames + 1 : 0;
    if (!lm || this.poseFrames < this.startFrames) {
      this.opened = false;
      return { active: false, open: false, snip: false };
    }
    const gap = fingerGap(lm, world);
    let snip = false;
    if (gap > this.open) this.opened = true;
    else if (this.opened && gap < this.close) {
      this.opened = false;
      snip = true;
    }
    return { active: true, open: this.opened, snip };
  }
}

// ---------------------------------------------------------------------------
// Menu poses (finger counts)
// ---------------------------------------------------------------------------

/** Thumb folded across the palm: its tip near the ring-finger knuckle (hand-size units). */
export function thumbTucked(lm: HandLandmarks, max: number = config.gestures.thumbTuckMax): boolean {
  const size = dist3(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);
  return size > 1e-9 && dist3(lm[LM.THUMB_TIP], lm[LM.RING_MCP]) / size < max;
}

export type MenuPose = 'three' | 'four';

/**
 * Finger-count poses that open menus. The thumb must be folded so that a relaxed open hand
 * (five fingers) never counts as four. three = index + middle + ring up, pinky down.
 */
export function menuPose(
  lm: HandLandmarks,
  extended: number = config.gestures.scissorExtended,
  curled: number = config.gestures.scissorCurled,
): MenuPose | null {
  if (!thumbTucked(lm)) return null;
  const up = [0, 1, 2, 3].map((f) => fingerCurl(lm, f as 0 | 1 | 2 | 3) > extended);
  const down = fingerCurl(lm, 3) < curled;
  if (up[0] && up[1] && up[2] && up[3]) return 'four';
  if (up[0] && up[1] && up[2] && down) return 'three';
  return null;
}

/**
 * Fires a pose once it has been held for `holdMs`; it can't fire again until the pose is released,
 * so holding it doesn't flicker a menu open and shut.
 */
export class PoseHold<P extends string> {
  private pose: P | null = null;
  private since = 0;
  private fired = false;

  constructor(private readonly holdMs: number = config.gestures.menuPoseHoldMs) {}

  /** Returns the pose on the frame it fires, else null. `progress` is 0..1 while holding. */
  update(pose: P | null, now: number): { fired: P | null; holding: P | null; progress: number } {
    if (pose !== this.pose) {
      this.pose = pose;
      this.since = now;
      this.fired = false;
    }
    if (!pose) return { fired: null, holding: null, progress: 0 };
    const progress = Math.min(1, (now - this.since) / this.holdMs);
    if (progress >= 1 && !this.fired) {
      this.fired = true;
      return { fired: pose, holding: pose, progress };
    }
    return { fired: null, holding: this.fired ? null : pose, progress };
  }
}

// ---------------------------------------------------------------------------
// Static gesture classification
// ---------------------------------------------------------------------------

export type GestureLabel = 'pinch' | 'point' | 'fist' | 'open' | 'none';

/**
 * Per-frame static hand-pose classifier.
 * This is the AI seam (MVP_SPEC §6): the MVP uses RuleBasedClassifier; in Phase 2 a small MLP
 * trained on collected landmark data implements this same interface and is swapped in.
 */
export interface GestureClassifier {
  classify(lm: HandLandmarks): GestureLabel;
}

const FINGERS = [
  { mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, tip: LM.INDEX_TIP },
  { mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, tip: LM.MIDDLE_TIP },
  { mcp: LM.RING_MCP, pip: LM.RING_PIP, tip: LM.RING_TIP },
  { mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, tip: LM.PINKY_TIP },
] as const;

/** Finger is extended when its tip is farther (2D) from the wrist than its PIP joint. */
export function fingerExtended(lm: HandLandmarks, finger: 0 | 1 | 2 | 3): boolean {
  const f = FINGERS[finger];
  const w = lm[LM.WRIST];
  return dist2(w, lm[f.tip]) > dist2(w, lm[f.pip]);
}

/** Rule-based classifier using pinchRatio and finger-extended heuristics. */
export class RuleBasedClassifier implements GestureClassifier {
  constructor(private readonly pinchThreshold: number = config.gestures.pinchClose) {}

  classify(lm: HandLandmarks): GestureLabel {
    if (lm.length < 21 || handSize(lm) <= 1e-9) return 'none';
    const w = lm[LM.WRIST];
    // Pinch needs the index tip reaching out past its MCP; in a fist the thumb may rest
    // near a curled index tip, which must not count as a pinch.
    const indexReaching = dist2(w, lm[LM.INDEX_TIP]) > dist2(w, lm[LM.INDEX_MCP]);
    if (pinchRatio(lm) < this.pinchThreshold && indexReaching) return 'pinch';

    const ext = [0, 1, 2, 3].map((i) => fingerExtended(lm, i as 0 | 1 | 2 | 3));
    const count = ext.filter(Boolean).length;
    if (count === 4) return 'open';
    if (count === 0) return 'fist';
    if (ext[0] && count === 1) return 'point';
    return 'none';
  }
}

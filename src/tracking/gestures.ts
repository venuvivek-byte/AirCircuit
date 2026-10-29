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

/** Pinch state machine with hysteresis: closes below `close`, opens above `open`. */
export class PinchDetector {
  private pinching = false;

  constructor(
    private readonly close: number = config.gestures.pinchClose,
    private readonly open: number = config.gestures.pinchOpen,
  ) {}

  /** Feed one frame of landmarks (null = hand lost, which ends an active pinch). */
  update(lm: HandLandmarks | null): PinchEvent {
    const was = this.pinching;
    if (lm === null) {
      this.pinching = false;
    } else {
      const r = pinchRatio(lm);
      if (!was && r < this.close) this.pinching = true;
      else if (was && r > this.open) this.pinching = false;
    }
    return { pinching: this.pinching, started: !was && this.pinching, ended: was && !this.pinching };
  }

  get isPinching(): boolean {
    return this.pinching;
  }

  reset(): void {
    this.pinching = false;
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

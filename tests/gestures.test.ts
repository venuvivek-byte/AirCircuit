import { describe, expect, it } from 'vitest';
import {
  DepthTracker,
  FistDetector,
  PinchDetector,
  fingerCurl,
  palmCenter,
  PressDetector,
  RotationTracker,
  RuleBasedClassifier,
  ScissorDetector,
  isScissorPose,
  PoseHold,
  menuPose,
  thumbTucked,
  TwoHandTwistTracker,
  angleDelta,
  handSize,
  palmTilt,
  pinchPoint,
  pinchRatio,
  pinchRatio3D,
  twoHandTwist,
  wristRoll,
} from '../src/tracking/gestures';
import { LM, type HandLandmarks, type Landmark } from '../src/tracking/types';
import { HandControl } from '../src/scene/handControl';

// ---------------------------------------------------------------------------
// Synthetic hand builder
// ---------------------------------------------------------------------------

interface HandOpts {
  /** Hand size (wrist -> middle MCP) in normalized image units. */
  scale?: number;
  /** Wrist position in image coords. */
  tx?: number;
  ty?: number;
  /** In-image-plane rotation (radians, image coords y-down: positive = clockwise on screen). */
  rotation?: number;
  /** Palm tilt about local X (radians, positive = fingers toward camera). */
  tilt?: number;
  /** Thumb tip <-> index tip gap in hand-size units (= pinchRatio). Omit for a natural open thumb. */
  gap?: number;
  /** Curl for all four fingers, 0 = straight, 1 = fully curled. */
  curl?: number;
  /** Per-finger curl overrides [index, middle, ring, pinky]. */
  curls?: [number, number, number, number];
}

type V3 = [number, number, number]; // local hand frame: x right, y up (toward fingers), z neg = toward camera

const MCPS: V3[] = [
  [-0.3, 0.95, 0],
  [0, 1, 0],
  [0.25, 0.92, 0],
  [0.48, 0.82, 0],
];
const SEG_LEN = [
  [0.45, 0.28, 0.22],
  [0.5, 0.3, 0.24],
  [0.46, 0.28, 0.22],
  [0.36, 0.22, 0.2],
];
const JOINT_BEND = [(80 * Math.PI) / 180, (90 * Math.PI) / 180, (60 * Math.PI) / 180];

function makeHand(o: HandOpts = {}): HandLandmarks {
  const scale = o.scale ?? 0.2;
  const tx = o.tx ?? 0.5;
  const ty = o.ty ?? 0.8;
  const r = o.rotation ?? 0;
  const t = o.tilt ?? 0;
  const curls = o.curls ?? [o.curl ?? 0, o.curl ?? 0, o.curl ?? 0, o.curl ?? 0];

  const local: V3[] = new Array(21);
  local[LM.WRIST] = [0, 0, 0];

  const fingerBase = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  for (let f = 0; f < 4; f++) {
    let [x, y, z] = MCPS[f];
    local[fingerBase[f]] = [x, y, z];
    let phi = 0;
    for (let s = 0; s < 3; s++) {
      phi += curls[f] * JOINT_BEND[s];
      y += SEG_LEN[f][s] * Math.cos(phi);
      z -= SEG_LEN[f][s] * Math.sin(phi);
      local[fingerBase[f] + 1 + s] = [x, y, z];
    }
  }

  local[LM.THUMB_CMC] = [-0.25, 0.2, 0];
  local[LM.THUMB_MCP] = [-0.45, 0.4, 0];
  if (o.gap === undefined) {
    local[LM.THUMB_IP] = [-0.58, 0.58, 0];
    local[LM.THUMB_TIP] = [-0.68, 0.75, 0];
  } else {
    const it = local[LM.INDEX_TIP];
    const tip: V3 = [it[0] - o.gap, it[1], it[2]];
    local[LM.THUMB_TIP] = tip;
    const m = local[LM.THUMB_MCP];
    local[LM.THUMB_IP] = [(m[0] + tip[0]) / 2 - 0.05, (m[1] + tip[1]) / 2, (m[2] + tip[2]) / 2];
  }

  const cr = Math.cos(r), sr = Math.sin(r), ct = Math.cos(t), st = Math.sin(t);
  return local.map(([lx, ly, lz]): Landmark => {
    // tilt about local X
    const y1 = ly * ct + lz * st;
    const z1 = -ly * st + lz * ct;
    // to image coords (y down) and rotate in image plane
    const yd = -y1;
    return {
      x: tx + scale * (lx * cr - yd * sr),
      y: ty + scale * (lx * sr + yd * cr),
      z: scale * z1,
    };
  });
}

// ---------------------------------------------------------------------------

describe('geometry', () => {
  it('handSize matches the builder scale', () => {
    expect(handSize(makeHand({ scale: 0.15 }))).toBeCloseTo(0.15, 9);
  });

  it('pinchRatio is invariant to scale, translation and rotation', () => {
    const base = pinchRatio(makeHand({ gap: 0.4 }));
    expect(base).toBeCloseTo(0.4, 9);
    for (const o of [
      { scale: 0.08 }, { scale: 0.35 }, { tx: 0.2, ty: 0.3 }, { rotation: 1.2 }, { scale: 0.1, rotation: -2.5, tx: 0.7 },
    ]) {
      expect(pinchRatio(makeHand({ gap: 0.4, ...o }))).toBeCloseTo(base, 9);
    }
  });

  it('pinchRatio3D counts depth separation that 2D misses', () => {
    const lm = makeHand({ gap: 0.1 });
    const deep = lm.map((p, i) => (i === LM.THUMB_TIP ? { ...p, z: p.z + 0.15 } : p));
    expect(pinchRatio(deep)).toBeCloseTo(pinchRatio(lm), 9);
    expect(pinchRatio3D(deep)).toBeGreaterThan(pinchRatio3D(lm) + 0.5);
  });

  it('pinchPoint is the thumb/index tip midpoint', () => {
    const lm = makeHand({ gap: 0.2 });
    const p = pinchPoint(lm);
    expect(p.x).toBeCloseTo((lm[LM.THUMB_TIP].x + lm[LM.INDEX_TIP].x) / 2);
    expect(p.y).toBeCloseTo((lm[LM.THUMB_TIP].y + lm[LM.INDEX_TIP].y) / 2);
  });
});

describe('PinchDetector', () => {
  it('opens/closes with hysteresis and fires start/end once', () => {
    const d = new PinchDetector(0.35, 0.5, 1, 1);
    expect(d.update(makeHand({ gap: 0.8 }))).toEqual({ pinching: false, started: false, ended: false });
    // between thresholds while open: stays open
    expect(d.update(makeHand({ gap: 0.42 })).pinching).toBe(false);
    const s = d.update(makeHand({ gap: 0.3 }));
    expect(s).toEqual({ pinching: true, started: true, ended: false });

    // oscillate between thresholds: no flicker, no extra events
    let events = 0;
    for (let i = 0; i < 50; i++) {
      const e = d.update(makeHand({ gap: i % 2 ? 0.36 : 0.49, rotation: i * 0.01 }));
      expect(e.pinching).toBe(true);
      if (e.started || e.ended) events++;
    }
    expect(events).toBe(0);

    const e = d.update(makeHand({ gap: 0.6 }));
    expect(e).toEqual({ pinching: false, started: false, ended: true });
    expect(d.update(makeHand({ gap: 0.6 })).ended).toBe(false);
    // oscillate again while open: stays open
    for (let i = 0; i < 20; i++) expect(d.update(makeHand({ gap: i % 2 ? 0.36 : 0.49 })).pinching).toBe(false);
  });

  it('needs several consecutive open frames to release (no flicker drops)', () => {
    const d = new PinchDetector(0.35, 0.5, 3, 1);
    d.update(makeHand({ gap: 0.2 }));
    // single noisy open frames between closed ones never release
    for (let i = 0; i < 10; i++) {
      expect(d.update(makeHand({ gap: 0.7 })).pinching).toBe(true);
      expect(d.update(makeHand({ gap: 0.3 })).pinching).toBe(true);
    }
    expect(d.update(makeHand({ gap: 0.7 })).pinching).toBe(true);
    expect(d.update(makeHand({ gap: 0.7 })).pinching).toBe(true);
    expect(d.update(makeHand({ gap: 0.7 }))).toEqual({ pinching: false, started: false, ended: true });
  });

  it('uses world landmarks when given', () => {
    const d = new PinchDetector(0.35, 0.5, 1, 1);
    // image landmarks look open, world (true 3D) says closed: world wins
    expect(d.update(makeHand({ gap: 0.8 }), makeHand({ gap: 0.2 })).started).toBe(true);
  });

  it('reports opening while still pinching in the hysteresis band', () => {
    const d = new PinchDetector(0.35, 0.5, 3, 1);
    d.update(makeHand({ gap: 0.2 }));
    expect(d.opening).toBe(false);
    expect(d.update(makeHand({ gap: 0.45 })).pinching).toBe(true);
    expect(d.opening).toBe(true);
    expect(d.ratio).toBeCloseTo(0.45, 6);
  });

  it('accepts a pinch with the index bent toward the thumb (default thresholds)', () => {
    const d = new PinchDetector();
    const bent = makeHand({ curls: [0.6, 1, 1, 1], gap: 0.1 });
    expect(fingerCurl(bent, 0)).toBeLessThan(1);
    d.update(bent);
    expect(d.update(bent).started).toBe(true);
  });

  it('losing the hand ends an active pinch', () => {
    const d = new PinchDetector();
    d.update(makeHand({ gap: 0.1 }));
    expect(d.update(makeHand({ gap: 0.1 })).started).toBe(true);
    expect(d.update(null)).toEqual({ pinching: false, started: false, ended: true });
    expect(d.update(null)).toEqual({ pinching: false, started: false, ended: false });
  });
});

describe('angles and rotation', () => {
  it('angleDelta wraps to (-π, π]', () => {
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(2 * Math.PI - 6, 9);
    expect(angleDelta(-3.0, 3.0)).toBeCloseTo(6 - 2 * Math.PI, 9);
    expect(angleDelta(0, Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(angleDelta(0, -Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(angleDelta(0.1, 0.1 + 4 * Math.PI)).toBeCloseTo(0, 9);
    expect(angleDelta(0, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('wristRoll delta equals the applied in-plane rotation', () => {
    const r0 = wristRoll(makeHand());
    for (const r of [0.3, -0.7, 1.5, -2.9]) {
      expect(angleDelta(r0, wristRoll(makeHand({ rotation: r, scale: 0.1, tx: 0.3 })))).toBeCloseTo(r, 9);
    }
  });

  it('palmTilt recovers the applied tilt', () => {
    expect(palmTilt(makeHand())).toBeCloseTo(0, 9);
    expect(palmTilt(makeHand({ tilt: 0.4 }))).toBeCloseTo(0.4, 9);
    expect(palmTilt(makeHand({ tilt: -0.3 }))).toBeCloseTo(-0.3, 9);
  });

  it('RotationTracker reports deltas with deadzone, across the ±π seam', () => {
    const tr = new RotationTracker(0.05, 0.05);
    // base hand whose roll sits near +π (rotation shifts roll by the same amount)
    const r0 = wristRoll(makeHand());
    const near = Math.PI - r0 - 0.1;
    tr.begin(makeHand({ rotation: near }));
    expect(tr.update(makeHand({ rotation: near }))).toEqual({ yaw: 0, pitch: 0 });
    // inside deadzone
    expect(tr.update(makeHand({ rotation: near + 0.04, tilt: -0.03 }))).toEqual({ yaw: 0, pitch: 0 });
    // crosses π: delta 0.3 -> 0.25 after soft deadzone
    expect(tr.update(makeHand({ rotation: near + 0.3 })).yaw).toBeCloseTo(0.25, 9);
    // tilt only (tilt also foreshortens the MCP vector slightly, so yaw is not asserted here)
    expect(tr.update(makeHand({ rotation: near, tilt: 0.25 })).pitch).toBeCloseTo(0.2, 9);
    const neg = tr.update(makeHand({ rotation: near - 0.5 }));
    expect(neg.yaw).toBeCloseTo(-0.45, 9);
  });

  it('two-hand twist tracks the angle between pinch points', () => {
    const a = makeHand({ tx: 0.3, ty: 0.7, gap: 0.1 });
    const b = makeHand({ tx: 0.7, ty: 0.7, gap: 0.1 });
    expect(twoHandTwist(a, b)).toBeCloseTo(0, 9);
    const tw = new TwoHandTwistTracker(0.05);
    tw.begin(a, b);
    // move hand B down so the A->B vector rotates by +atan2(0.4, 0.4) = π/4
    const b2 = makeHand({ tx: 0.7, ty: 1.1, gap: 0.1 });
    expect(tw.update(a, b2)).toBeCloseTo(Math.PI / 4 - 0.05, 9);
    expect(tw.update(a, makeHand({ tx: 0.7, ty: 0.71, gap: 0.1 }))).toBe(0);
  });
});

describe('PressDetector', () => {
  it('fires once on crossing depth and re-arms only below release', () => {
    const p = new PressDetector(0.15, 0.05);
    const seq: (number | null)[] = [null, -0.1, 0, 0.1, 0.16, 0.2, 0.3, 0.14, 0.16, 0.08, 0.2, 0.04, 0.1, 0.15, 0.2];
    const fired = seq.map((v) => p.update(v));
    expect(fired.filter(Boolean).length).toBe(2);
    expect(fired[4]).toBe(true); // first crossing
    expect(fired[13]).toBe(true); // after re-arm at 0.04
  });

  it('null (finger off the button) re-arms', () => {
    const p = new PressDetector(0.15, 0.05);
    expect(p.update(0.2)).toBe(true);
    expect(p.update(0.2)).toBe(false);
    p.update(null);
    expect(p.update(0.2)).toBe(true);
  });
});

describe('RuleBasedClassifier', () => {
  const c = new RuleBasedClassifier();
  it('labels open, fist, point, pinch under various poses', () => {
    for (const o of [{}, { rotation: 0.8, scale: 0.1 }, { rotation: -1.2, scale: 0.3, tx: 0.2 }]) {
      expect(c.classify(makeHand({ ...o, curl: 0 }))).toBe('open');
      expect(c.classify(makeHand({ ...o, curl: 1 }))).toBe('fist');
      expect(c.classify(makeHand({ ...o, curls: [0, 1, 1, 1] }))).toBe('point');
      expect(c.classify(makeHand({ ...o, curls: [0.3, 0.6, 0.6, 0.6], gap: 0.1 }))).toBe('pinch');
      expect(c.classify(makeHand({ ...o, curls: [0, 0, 1, 1] }))).toBe('none');
    }
  });

  it('fist with thumb near curled index is not a pinch', () => {
    const lm = makeHand({ curl: 1 });
    // move thumb tip onto the curled index tip
    lm[LM.THUMB_TIP] = { ...lm[LM.INDEX_TIP], x: lm[LM.INDEX_TIP].x - 0.01 };
    expect(pinchRatio(lm)).toBeLessThan(0.35);
    expect(c.classify(lm)).toBe('fist');
  });
});

describe('fist', () => {
  it('fingerCurl is high for straight fingers and low when curled', () => {
    expect(fingerCurl(makeHand({ curl: 0 }), 1)).toBeGreaterThan(1.3);
    expect(fingerCurl(makeHand({ curl: 1 }), 1)).toBeLessThan(1);
  });

  it('palmCenter barely moves between open hand and fist', () => {
    const a = palmCenter(makeHand({ curl: 0 }));
    const b = palmCenter(makeHand({ curl: 1 }));
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-9);
  });

  it('FistDetector closes after startFrames curled frames and opens after releaseFrames', () => {
    const d = new FistDetector(1.0, 1.2, 2, 3);
    expect(d.update(makeHand({ curl: 1 }))).toBe(false);
    expect(d.update(makeHand({ curl: 1 }))).toBe(true);
    // one noisy open frame does not release
    expect(d.update(makeHand({ curl: 0 }))).toBe(true);
    expect(d.update(makeHand({ curl: 1 }))).toBe(true);
    d.update(makeHand({ curl: 0 }));
    d.update(makeHand({ curl: 0 }));
    expect(d.update(makeHand({ curl: 0 }))).toBe(false);
  });

  it('a pinch with other fingers curled is not a fist (index reaching)', () => {
    const d = new FistDetector(1.0, 1.2, 1, 1);
    expect(d.update(makeHand({ curls: [0.3, 1, 1, 1], gap: 0.1 }))).toBe(false);
  });

  it('closing into a fist never starts a pinch', () => {
    const d = new PinchDetector(0.35, 0.5, 1, 1);
    for (let i = 0; i < 5; i++) expect(d.update(makeHand({ curl: 1, gap: 0.1 })).pinching).toBe(false);
  });
});

describe('HandControl', () => {
  const toScreen = (x: number, y: number) => ({ px: x * 1000, py: y * 1000 });
  const hand = (o: HandOpts) => ({ landmarks: makeHand(o), handedness: 'Right' as const });

  it('freezes the pointer while a pinch opens, so the release lands where the pinch was', () => {
    const hc = new HandControl(toScreen);
    let f = hc.update([hand({ gap: 0.1 })], false);
    f = hc.update([hand({ gap: 0.1 })], false);
    expect(f.grip).toBe('pinch');
    const at = { px: f.pointer!.px, py: f.pointer!.py };

    // Fingers separate and the hand drifts: pointer stays put through the release frame.
    let ended = false;
    for (let i = 1; i <= 8 && !ended; i++) {
      f = hc.update([hand({ gap: i < 3 ? 0.45 : 0.8, tx: 0.5 + i * 0.01 })], false);
      expect(f.pointer!.px).toBeCloseTo(at.px, 6);
      expect(f.pointer!.py).toBeCloseTo(at.py, 6);
      ended = !f.pointer!.down;
    }
    expect(ended).toBe(true);

    // Afterwards the pointer follows the hand again.
    f = hc.update([hand({ gap: 0.8, tx: 0.7 })], false);
    expect(f.pointer!.px).toBeGreaterThan(at.px + 100);
  });

  it('a loose pinch held in the hysteresis band stops freezing (it is a drag)', () => {
    const hc = new HandControl(toScreen);
    hc.update([hand({ gap: 0.1 })], false);
    const frozen = hc.update([hand({ gap: 0.1 })], false).pointer!.px;
    let f = hc.update([hand({ gap: 0.45, tx: 0.6 })], false);
    expect(f.pointer!.px).toBeCloseTo(frozen, 6);
    for (let i = 0; i < 20; i++) f = hc.update([hand({ gap: 0.45, tx: 0.6 })], false);
    expect(f.grip).toBe('pinch');
    expect(f.pointer!.px).toBeGreaterThan(frozen + 50);
  });
});

describe('DepthTracker', () => {
  it('reports > 1 when the hand comes closer, < 1 when it moves back', () => {
    const d = new DepthTracker(0.1);
    d.begin(makeHand({ scale: 0.2, curl: 1 }));
    expect(d.update(makeHand({ scale: 0.3, curl: 1 }))).toBeGreaterThan(1.3);
    expect(d.update(makeHand({ scale: 0.13, curl: 1 }))).toBeLessThan(0.75);
  });

  it('ignores small size changes and tilting the hand', () => {
    const d = new DepthTracker(0.1);
    d.begin(makeHand({ scale: 0.2, curl: 1 }));
    expect(d.update(makeHand({ scale: 0.21, curl: 1 }))).toBe(1);
    expect(d.update(makeHand({ scale: 0.2, curl: 1, tilt: 0.6 }))).toBe(1);
    expect(d.update(makeHand({ scale: 0.2, curl: 1, rotation: 0.8 }))).toBe(1);
  });
});

describe('ScissorDetector', () => {
  /** V sign (index + middle straight, ring + pinky curled) with the two fingertips `gap` hand-sizes apart. */
  function vSign(gap: number): HandLandmarks {
    const lm = makeHand({ curls: [0, 0, 1, 1] });
    const m = lm[LM.MIDDLE_TIP];
    lm[LM.INDEX_TIP] = { x: m.x - gap * 0.2, y: m.y, z: m.z };
    return lm;
  }

  it('recognises the V-sign pose but not an open hand, a fist or a point', () => {
    expect(isScissorPose(vSign(0.5))).toBe(true);
    expect(isScissorPose(makeHand({ curl: 0 }))).toBe(false);
    expect(isScissorPose(makeHand({ curl: 1 }))).toBe(false);
    expect(isScissorPose(makeHand({ curls: [0, 1, 1, 1] }))).toBe(false);
  });

  it('snips once on open -> close, never from fingers merely held together', () => {
    const d = new ScissorDetector(0.4, 0.25, 1);
    for (let i = 0; i < 5; i++) expect(d.update(vSign(0.15)).snip).toBe(false);
    expect(d.update(vSign(0.6))).toEqual({ active: true, open: true, snip: false });
    expect(d.update(vSign(0.3)).snip).toBe(false);
    expect(d.update(vSign(0.15))).toEqual({ active: true, open: false, snip: true });
    expect(d.update(vSign(0.15)).snip).toBe(false);
  });

  it('dropping the pose disarms a half-done snip', () => {
    const d = new ScissorDetector(0.4, 0.25, 1);
    d.update(vSign(0.6));
    expect(d.update(makeHand({ curl: 0 })).active).toBe(false);
    expect(d.update(vSign(0.15)).snip).toBe(false);
  });
});

describe('menu poses (finger counts)', () => {
  /** Fingers per `curls`, thumb folded across the palm (tip near the ring knuckle). */
  function counted(curls: [number, number, number, number], tucked = true): HandLandmarks {
    const lm = makeHand({ curls });
    if (tucked) {
      const r = lm[LM.RING_MCP];
      const w = lm[LM.WRIST];
      lm[LM.THUMB_TIP] = { x: r.x + (w.x - r.x) * 0.2 - 0.03, y: r.y + (w.y - r.y) * 0.2, z: r.z - 0.02 };
    }
    return lm;
  }

  it('four fingers and three fingers need the thumb folded', () => {
    expect(thumbTucked(counted([0, 0, 0, 0]))).toBe(true);
    expect(thumbTucked(makeHand({ curl: 0 }))).toBe(false);
    expect(menuPose(counted([0, 0, 0, 0]))).toBe('four');
    expect(menuPose(counted([0, 0, 0, 1]))).toBe('three');
    // A relaxed open hand (thumb out) is not "four".
    expect(menuPose(makeHand({ curl: 0 }))).toBe(null);
    expect(menuPose(counted([0, 0, 0, 0], false))).toBe(null);
  });

  it('other finger counts and fists are not menu poses', () => {
    expect(menuPose(counted([0, 0, 1, 1]))).toBe(null);
    expect(menuPose(counted([0, 1, 1, 1]))).toBe(null);
    expect(menuPose(counted([1, 1, 1, 1]))).toBe(null);
    expect(menuPose(counted([1, 0, 0, 0]))).toBe(null);
  });

  it('fires once after the hold time, again only after releasing the pose', () => {
    const h = new PoseHold<'three' | 'four'>(700);
    expect(h.update('four', 0).fired).toBe(null);
    expect(h.update('four', 400)).toMatchObject({ fired: null, holding: 'four' });
    expect(h.update('four', 400).progress).toBeCloseTo(400 / 700);
    expect(h.update('four', 720).fired).toBe('four');
    expect(h.update('four', 2000)).toMatchObject({ fired: null, holding: null });
    // Switching pose restarts the hold.
    expect(h.update('three', 2100).fired).toBe(null);
    expect(h.update('three', 2900).fired).toBe('three');
    h.update(null, 3000);
    h.update('three', 3100);
    expect(h.update('three', 3850).fired).toBe('three');
  });
});

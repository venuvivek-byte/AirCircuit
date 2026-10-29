// Pure landmark smoothing, interpolation and tracking-rate control (no MediaPipe / DOM).

import { config } from '../config';
import { LM, type HandLandmarks, type TrackedHand } from './types';

export function emaLandmarks(prev: HandLandmarks, next: HandLandmarks, alpha: number): HandLandmarks {
  return next.map((p, i) => ({
    x: prev[i].x + alpha * (p.x - prev[i].x),
    y: prev[i].y + alpha * (p.y - prev[i].y),
    z: prev[i].z + alpha * (p.z - prev[i].z),
  }));
}

export function lerpLandmarks(a: HandLandmarks, b: HandLandmarks, t: number): HandLandmarks {
  return b.map((p, i) => ({
    x: a[i].x + t * (p.x - a[i].x),
    y: a[i].y + t * (p.y - a[i].y),
    z: a[i].z + t * (p.z - a[i].z),
  }));
}

function wristDist(a: HandLandmarks, b: HandLandmarks): number {
  const p = a[LM.WRIST];
  const q = b[LM.WRIST];
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** For each new hand, the index of the closest previous hand by wrist position (greedy), or -1. */
export function matchHands(prev: TrackedHand[], next: TrackedHand[]): number[] {
  const used = new Set<number>();
  return next.map((h) => {
    let best = -1;
    let bestD = Infinity;
    prev.forEach((p, i) => {
      if (used.has(i)) return;
      const d = wristDist(p.landmarks, h.landmarks);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) used.add(best);
    return best;
  });
}

/**
 * EMA-smooths each tracking sample and, when tracking runs every N frames,
 * linearly interpolates between the last two samples on the skipped frames.
 * Hands are kept in a stable order across samples via wrist matching.
 */
export class HandSmoother {
  private prev: TrackedHand[] = [];
  private curr: TrackedHand[] = [];
  private framesSinceSample = 0;

  constructor(private alpha = config.tracking.smoothingAlpha) {}

  /** Feed a fresh detection result. */
  addSample(hands: TrackedHand[]): void {
    const matches = matchHands(this.curr, hands);
    const smoothed = hands.map((h, i) => {
      const m = matches[i];
      return m >= 0
        ? { handedness: h.handedness, landmarks: emaLandmarks(this.curr[m].landmarks, h.landmarks, this.alpha) }
        : h;
    });
    // Previous sample re-ordered to line up with the new hands, for interpolation.
    this.prev = smoothed.map((h, i) => (matches[i] >= 0 ? this.curr[matches[i]] : h));
    this.curr = smoothed;
    this.framesSinceSample = 0;
  }

  /** Hands to display this frame. Call once per rendered frame, after addSample on tracked frames. */
  frame(everyNFrames: number): TrackedHand[] {
    const n = Math.max(1, everyNFrames);
    // On the sample frame t = 1/n, reaching the latest sample on the frame before the next one.
    const t = Math.min(1, (this.framesSinceSample + 1) / n);
    this.framesSinceSample++;
    if (n === 1 || t >= 1) return this.curr;
    return this.curr.map((h, i) => ({
      handedness: h.handedness,
      landmarks: lerpLandmarks(this.prev[i].landmarks, h.landmarks, t),
    }));
  }
}

/** Switches tracking to every 2nd frame once FPS has stayed below the threshold long enough. */
export class TrackingRateController {
  everyNFrames: number;
  private lowSince: number | null = null;

  constructor(
    initial = config.tracking.trackingEveryNFrames,
    private threshold = config.tracking.lowFpsThreshold,
    private durationMs = config.tracking.lowFpsDurationMs,
  ) {
    this.everyNFrames = initial;
  }

  update(fps: number, now: number): number {
    if (this.everyNFrames >= 2 || fps <= 0) return this.everyNFrames;
    if (fps < this.threshold) {
      this.lowSince ??= now;
      if (now - this.lowSince >= this.durationMs) this.everyNFrames = 2;
    } else {
      this.lowSince = null;
    }
    return this.everyNFrames;
  }
}

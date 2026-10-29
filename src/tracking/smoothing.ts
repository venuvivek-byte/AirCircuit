// Pure landmark smoothing, interpolation and tracking-rate control (no MediaPipe / DOM).

import { config } from '../config';
import { LM, type HandLandmarks, type TrackedHand } from './types';

export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

function smoothingFactor(dtSec: number, cutoffHz: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

/** Scalar One Euro filter (Casiez, Roussel, Vogel 2012): speed-adaptive low-pass. */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(private p: OneEuroParams) {}

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max((tMs - this.t) / 1000, 1e-3);
    this.t = tMs;
    this.dx += smoothingFactor(dt, this.p.dCutoff) * ((value - this.x) / dt - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += smoothingFactor(dt, cutoff) * (value - this.x);
    return this.x;
  }
}

/** One Euro filters for every coordinate of a landmark set. */
export class LandmarkFilter {
  private filters: OneEuroFilter[] = [];

  constructor(private p: OneEuroParams) {}

  filter(lms: HandLandmarks, tMs: number): HandLandmarks {
    return lms.map((pt, i) => {
      const k = i * 3;
      while (this.filters.length < k + 3) this.filters.push(new OneEuroFilter(this.p));
      return {
        x: this.filters[k].filter(pt.x, tMs),
        y: this.filters[k + 1].filter(pt.y, tMs),
        z: this.filters[k + 2].filter(pt.z, tMs),
      };
    });
  }
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

interface HandSlot {
  hand: TrackedHand;
  prev: TrackedHand;
  filter: LandmarkFilter;
  worldFilter: LandmarkFilter;
  lastSeen: number;
}

/**
 * One-Euro-filters each tracking sample and, when tracking runs every N frames,
 * linearly interpolates between the last two samples on the skipped frames.
 * Hands keep a stable slot order across samples via wrist matching (slot 0 stays primary),
 * and a hand MediaPipe briefly loses is held for `graceMs` so drags survive dropouts.
 */
export class HandSmoother {
  private slots: HandSlot[] = [];
  private framesSinceSample = 0;

  constructor(
    private params: OneEuroParams = config.tracking.oneEuro,
    private graceMs = config.tracking.handLostGraceMs,
  ) {}

  /** Feed a fresh detection result taken at time `now` (ms). */
  addSample(hands: TrackedHand[], now: number): void {
    const matches = matchHands(
      this.slots.map((s) => s.hand),
      hands,
    );
    const next: HandSlot[] = [];
    this.slots.forEach((slot, i) => {
      const j = matches.indexOf(i);
      if (j >= 0) {
        const h = hands[j];
        next.push({
          ...slot,
          prev: slot.hand,
          hand: {
            handedness: h.handedness,
            landmarks: slot.filter.filter(h.landmarks, now),
            world: h.world && slot.worldFilter.filter(h.world, now),
          },
          lastSeen: now,
        });
      } else if (now - slot.lastSeen < this.graceMs) {
        next.push({ ...slot, prev: slot.hand });
      }
    });
    hands.forEach((h, j) => {
      if (matches[j] >= 0) return;
      const slot: HandSlot = {
        hand: h,
        prev: h,
        filter: new LandmarkFilter(this.params),
        worldFilter: new LandmarkFilter(this.params),
        lastSeen: now,
      };
      slot.filter.filter(h.landmarks, now);
      if (h.world) slot.worldFilter.filter(h.world, now);
      next.push(slot);
    });
    this.slots = next;
    this.framesSinceSample = 0;
  }

  /** Hands to display this frame. Call once per rendered frame, after addSample on tracked frames. */
  frame(everyNFrames: number): TrackedHand[] {
    const n = Math.max(1, everyNFrames);
    // On the sample frame t = 1/n, reaching the latest sample on the frame before the next one.
    const t = Math.min(1, (this.framesSinceSample + 1) / n);
    this.framesSinceSample++;
    if (n === 1 || t >= 1) return this.slots.map((s) => s.hand);
    return this.slots.map(({ hand, prev }) => ({
      ...hand,
      landmarks: lerpLandmarks(prev.landmarks, hand.landmarks, t),
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

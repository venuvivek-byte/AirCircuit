import { describe, expect, it } from 'vitest';
import { HandSmoother, OneEuroFilter, TrackingRateController, matchHands } from '../src/tracking/smoothing';
import type { TrackedHand } from '../src/tracking/types';

function hand(x: number, y = 0.5): TrackedHand {
  return { handedness: 'Right', landmarks: Array.from({ length: 21 }, () => ({ x, y, z: 0 })) };
}

// Filter params that pass samples straight through (cutoff so high there is no smoothing).
const RAW = { minCutoff: 1e9, beta: 0, dCutoff: 1 };

describe('OneEuroFilter', () => {
  it('passes the first value through', () => {
    expect(new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 }).filter(0.4, 0)).toBe(0.4);
  });

  it('smooths jitter heavily when still, but follows fast motion closely', () => {
    const p = { minCutoff: 1, beta: 20, dCutoff: 1 };
    const still = new OneEuroFilter(p);
    still.filter(0.5, 0);
    // 30 fps jitter of ±0.01 around 0.5
    let maxDev = 0;
    for (let i = 1; i <= 60; i++) maxDev = Math.max(maxDev, Math.abs(still.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 33) - 0.5));
    expect(maxDev).toBeLessThan(0.004);

    const moving = new OneEuroFilter(p);
    let out = 0;
    // hand sweeping 1 screen-width per second
    for (let i = 0; i <= 30; i++) out = moving.filter(i / 30, i * 33);
    expect(1 - out).toBeLessThan(0.08);
  });
});

describe('matchHands', () => {
  it('matches hands by nearest wrist regardless of order', () => {
    expect(matchHands([hand(0.2), hand(0.8)], [hand(0.79), hand(0.21)])).toEqual([1, 0]);
  });
  it('returns -1 for new hands', () => {
    expect(matchHands([hand(0.2)], [hand(0.2), hand(0.8)])).toEqual([0, -1]);
  });
});

describe('HandSmoother', () => {
  it('passes the first sample through unsmoothed', () => {
    const s = new HandSmoother({ minCutoff: 1, beta: 0, dCutoff: 1 });
    s.addSample([hand(0.4)], 0);
    expect(s.frame(1)[0].landmarks[0].x).toBeCloseTo(0.4);
  });

  it('smooths subsequent samples', () => {
    const s = new HandSmoother({ minCutoff: 1, beta: 0, dCutoff: 1 });
    s.addSample([hand(0)], 0);
    s.addSample([hand(1)], 33);
    const x = s.frame(1)[0].landmarks[0].x;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.5);
  });

  it('keeps hand slots stable when detection order swaps', () => {
    const s = new HandSmoother(RAW);
    s.addSample([hand(0.2), hand(0.8)], 0);
    s.addSample([hand(0.81), hand(0.21)], 33);
    const xs = s.frame(1).map((h) => h.landmarks[0].x);
    expect(xs[0]).toBeCloseTo(0.21); // slot 0 (primary) stays the same physical hand
    expect(xs[1]).toBeCloseTo(0.81);
  });

  it('interpolates on skipped frames when tracking every 2 frames', () => {
    const s = new HandSmoother(RAW);
    s.addSample([hand(0)], 0);
    s.frame(2);
    s.frame(2);
    s.addSample([hand(1)], 33);
    expect(s.frame(2)[0].landmarks[0].x).toBeCloseTo(0.5); // tracked frame: halfway
    expect(s.frame(2)[0].landmarks[0].x).toBeCloseTo(1); // skipped frame: reaches the sample
  });

  it('holds a briefly lost hand, then drops it after the grace period', () => {
    const s = new HandSmoother(RAW, 250);
    s.addSample([hand(0.5)], 0);
    s.addSample([], 100);
    expect(s.frame(1)).toHaveLength(1);
    expect(s.frame(1)[0].landmarks[0].x).toBeCloseTo(0.5);
    s.addSample([], 300);
    expect(s.frame(1)).toHaveLength(0);
  });

  it('a held hand picks up again in the same slot', () => {
    const s = new HandSmoother(RAW, 250);
    s.addSample([hand(0.5)], 0);
    s.addSample([], 50);
    s.addSample([hand(0.52)], 100);
    expect(s.frame(1)).toHaveLength(1);
    expect(s.frame(1)[0].landmarks[0].x).toBeCloseTo(0.52);
  });
});

describe('TrackingRateController', () => {
  it('switches to every 2 frames after sustained low FPS', () => {
    const c = new TrackingRateController(1, 24, 2000);
    expect(c.update(20, 0)).toBe(1);
    expect(c.update(20, 1999)).toBe(1);
    expect(c.update(20, 2000)).toBe(2);
  });

  it('resets the timer when FPS recovers', () => {
    const c = new TrackingRateController(1, 24, 2000);
    c.update(20, 0);
    c.update(30, 1500);
    expect(c.update(20, 2500)).toBe(1);
    expect(c.update(20, 4500)).toBe(2);
  });
});

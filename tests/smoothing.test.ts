import { describe, expect, it } from 'vitest';
import { HandSmoother, TrackingRateController, emaLandmarks, matchHands } from '../src/tracking/smoothing';
import type { TrackedHand } from '../src/tracking/types';

function hand(x: number, y = 0.5): TrackedHand {
  return { handedness: 'Right', landmarks: Array.from({ length: 21 }, () => ({ x, y, z: 0 })) };
}

describe('emaLandmarks', () => {
  it('moves alpha of the way toward the new sample', () => {
    const out = emaLandmarks(hand(0).landmarks, hand(1).landmarks, 0.5);
    expect(out[0].x).toBeCloseTo(0.5);
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
    const s = new HandSmoother(0.5);
    s.addSample([hand(0.4)]);
    expect(s.frame(1)[0].landmarks[0].x).toBeCloseTo(0.4);
  });

  it('smooths subsequent samples with EMA', () => {
    const s = new HandSmoother(0.5);
    s.addSample([hand(0)]);
    s.addSample([hand(1)]);
    expect(s.frame(1)[0].landmarks[0].x).toBeCloseTo(0.5);
  });

  it('keeps hand order stable when detection order swaps', () => {
    const s = new HandSmoother(1);
    s.addSample([hand(0.2), hand(0.8)]);
    s.addSample([hand(0.8), hand(0.2)]);
    const xs = s.frame(1).map((h) => h.landmarks[0].x);
    expect(xs).toEqual([0.8, 0.2]); // matched to the previous hands, values follow the new sample order
  });

  it('interpolates on skipped frames when tracking every 2 frames', () => {
    const s = new HandSmoother(1);
    s.addSample([hand(0)]);
    s.frame(2);
    s.frame(2);
    s.addSample([hand(1)]);
    expect(s.frame(2)[0].landmarks[0].x).toBeCloseTo(0.5); // tracked frame: halfway
    expect(s.frame(2)[0].landmarks[0].x).toBeCloseTo(1); // skipped frame: reaches the sample
  });

  it('drops hands that disappear', () => {
    const s = new HandSmoother();
    s.addSample([hand(0.5)]);
    s.addSample([]);
    expect(s.frame(1)).toHaveLength(0);
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

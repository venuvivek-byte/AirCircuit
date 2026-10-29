import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../src/sim/netlist';
import { Simulator, computeLedStates, isBlinkHigh } from '../src/sim/simulator';
import type { BoardKind } from '../src/components/boards';
import type { Circuit, Connection, PinRef, SimComponent } from '../src/sim/types';

const p = (componentId: string, pin: string): PinRef => ({ componentId, pin });
const w = (a: PinRef, b: PinRef): Connection => ({ a, b });
const board = (id: string, boardKind: BoardKind): SimComponent => ({ id, type: 'board', boardKind });
const led = (id = 'led'): SimComponent => ({ id, type: 'led' });
const res = (id = 'r'): SimComponent => ({ id, type: 'resistor' });
const bb = (id = 'bb'): SimComponent => ({ id, type: 'breadboard' });

/** blinkPin -> resistor -> LED -> GND with direct wires. */
function golden(kind: BoardKind, blinkPin: string, boardId = 'b'): Circuit {
  return {
    components: [board(boardId, kind), res(), led()],
    connections: [
      w(p(boardId, blinkPin), p('r', 'a')),
      w(p('r', 'b'), p('led', 'anode')),
      w(p('led', 'cathode'), p(boardId, 'GND')),
    ],
  };
}

/** Same circuit on a breadboard: legs in holes, jumpers to the board and the - rail. */
function goldenOnBreadboard(kind: BoardKind, blinkPin: string): Circuit {
  return {
    components: [board('b', kind), bb(), res(), led()],
    connections: [
      w(p('b', blinkPin), p('bb', 'a1')),
      w(p('r', 'a'), p('bb', 'c1')),
      w(p('r', 'b'), p('bb', 'c5')),
      w(p('led', 'anode'), p('bb', 'e5')),
      w(p('led', 'cathode'), p('bb', 'e6')),
      w(p('bb', 'a6'), p('bb', '-3')),
      w(p('bb', '-20'), p('b', 'GND')),
    ],
  };
}

const states = (c: Circuit, high = true) => computeLedStates(c, buildNetlist(c), high);

const BOTH = [
  ['arduino-uno', 'D13'],
  ['esp32', 'GPIO2'],
] as const;

describe('isBlinkHigh', () => {
  it('is HIGH for the first interval and toggles every interval', () => {
    expect(isBlinkHigh(0, 500)).toBe(true);
    expect(isBlinkHigh(499, 500)).toBe(true);
    expect(isBlinkHigh(500, 500)).toBe(false);
    expect(isBlinkHigh(999, 500)).toBe(false);
    expect(isBlinkHigh(1000, 500)).toBe(true);
    expect(isBlinkHigh(1500, 500)).toBe(false);
  });
  it('uses the config interval by default (500 ms)', () => {
    expect(isBlinkHigh(250)).toBe(true);
    expect(isBlinkHigh(750)).toBe(false);
  });
});

describe('computeLedStates', () => {
  for (const [kind, pin] of BOTH) {
    describe(kind, () => {
      it('golden path lights when HIGH and is off when LOW', () => {
        expect(states(golden(kind, pin)).get('led')).toBe(true);
        expect(states(golden(kind, pin), false).get('led')).toBe(false);
      });
      it('golden path through a breadboard lights', () => {
        expect(states(goldenOnBreadboard(kind, pin)).get('led')).toBe(true);
      });
      it('resistor on the cathode side also works', () => {
        const c: Circuit = {
          components: [board('b', kind), res(), led()],
          connections: [
            w(p('b', pin), p('led', 'anode')),
            w(p('led', 'cathode'), p('r', 'a')),
            w(p('r', 'b'), p('b', 'GND')),
          ],
        };
        expect(states(c).get('led')).toBe(true);
      });
      it('reversed LED never lights', () => {
        const c: Circuit = {
          components: [board('b', kind), res(), led()],
          connections: [
            w(p('b', pin), p('r', 'a')),
            w(p('r', 'b'), p('led', 'cathode')),
            w(p('led', 'anode'), p('b', 'GND')),
          ],
        };
        expect(states(c).get('led')).toBe(false);
        expect(states(c, false).get('led')).toBe(false);
      });
      it('missing GND stays off', () => {
        const c = golden(kind, pin);
        c.connections.pop();
        expect(states(c).get('led')).toBe(false);
      });
      it('wrong GPIO pin stays off', () => {
        const c = golden(kind, pin);
        c.connections[0] = w(p('b', kind === 'esp32' ? 'GPIO4' : 'D12'), p('r', 'a'));
        expect(states(c).get('led')).toBe(false);
      });
    });
  }

  it('lights with no resistor (validator warns separately)', () => {
    const c: Circuit = {
      components: [board('b', 'arduino-uno'), led()],
      connections: [w(p('b', 'D13'), p('led', 'anode')), w(p('led', 'cathode'), p('b', 'GND'))],
    };
    expect(states(c).get('led')).toBe(true);
  });

  it('two series resistors still conduct', () => {
    const c: Circuit = {
      components: [board('b', 'esp32'), res('r1'), res('r2'), led()],
      connections: [
        w(p('b', 'GPIO2'), p('r1', 'a')),
        w(p('r1', 'b'), p('r2', 'a')),
        w(p('r2', 'b'), p('led', 'anode')),
        w(p('led', 'cathode'), p('b', 'GND')),
      ],
    };
    expect(states(c).get('led')).toBe(true);
  });

  it('with two boards, only the wired one drives the LED', () => {
    const c = golden('esp32', 'GPIO2', 'esp');
    c.components.push(board('uno', 'arduino-uno'));
    expect(states(c).get('led')).toBe(true);
    const c2 = golden('arduino-uno', 'D13', 'uno');
    c2.components.push(board('esp', 'esp32'));
    expect(states(c2).get('led')).toBe(true);
  });

  it('cathode must go to GND of the same board', () => {
    const c: Circuit = {
      components: [board('uno', 'arduino-uno'), board('esp', 'esp32'), res(), led()],
      connections: [
        w(p('uno', 'D13'), p('r', 'a')),
        w(p('r', 'b'), p('led', 'anode')),
        w(p('led', 'cathode'), p('esp', 'GND')),
      ],
    };
    expect(states(c).get('led')).toBe(false);
  });

  it('handles multiple LEDs independently', () => {
    const c = golden('arduino-uno', 'D13');
    c.components.push(led('led2'));
    const s = states(c);
    expect(s.get('led')).toBe(true);
    expect(s.get('led2')).toBe(false);
  });
});

describe('Simulator', () => {
  const c = golden('arduino-uno', 'D13');

  it('all LEDs off when not running', () => {
    const sim = new Simulator();
    expect(sim.running).toBe(false);
    expect(sim.step(0, c).get('led')).toBe(false);
  });

  it('blinks relative to start time', () => {
    const sim = new Simulator(500);
    sim.start(10_000);
    expect(sim.running).toBe(true);
    expect(sim.step(10_000, c).get('led')).toBe(true);
    expect(sim.step(10_400, c).get('led')).toBe(true);
    expect(sim.step(10_600, c).get('led')).toBe(false);
    expect(sim.step(11_100, c, buildNetlist(c)).get('led')).toBe(true);
  });

  it('start while running does not restart the phase', () => {
    const sim = new Simulator(500);
    sim.start(0);
    sim.start(600);
    expect(sim.step(600, c).get('led')).toBe(false);
  });

  it('stop turns LEDs off; reset clears state and the next start begins HIGH', () => {
    const sim = new Simulator(500);
    sim.start(0);
    sim.stop();
    expect(sim.running).toBe(false);
    expect(sim.step(100, c).get('led')).toBe(false);
    sim.start(700);
    expect(sim.step(700, c).get('led')).toBe(true);
    sim.reset();
    expect(sim.running).toBe(false);
    expect(sim.step(800, c).get('led')).toBe(false);
    sim.start(2000);
    expect(sim.step(2100, c).get('led')).toBe(true);
  });
});

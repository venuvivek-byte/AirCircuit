import { describe, expect, it } from 'vitest';
import { validate, type ValidationMessage } from '../src/sim/validator';
import type { BoardKind } from '../src/components/boards';
import type { Circuit, Connection, PinRef, SimComponent } from '../src/sim/types';

const p = (componentId: string, pin: string): PinRef => ({ componentId, pin });
const w = (a: PinRef, b: PinRef): Connection => ({ a, b });
const board = (id: string, boardKind: BoardKind): SimComponent => ({ id, type: 'board', boardKind });
const led = (id = 'led'): SimComponent => ({ id, type: 'led' });
const res = (id = 'r'): SimComponent => ({ id, type: 'resistor' });
const bb = (id = 'bb'): SimComponent => ({ id, type: 'breadboard' });

const codes = (msgs: ValidationMessage[]) => msgs.map((m) => m.code).sort();

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

const BOTH = [
  ['arduino-uno', 'D13'],
  ['esp32', 'GPIO2'],
] as const;

describe('validate', () => {
  it('returns [] for an empty or unwired scene', () => {
    expect(validate({ components: [], connections: [] })).toEqual([]);
    expect(validate({ components: [board('b', 'esp32'), led(), res()], connections: [] })).toEqual([]);
  });

  for (const [kind, pin] of BOTH) {
    describe(kind, () => {
      it('golden path -> Circuit OK', () => {
        expect(validate(golden(kind, pin))).toEqual([
          { level: 'ok', code: 'ok', text: 'Circuit OK.', componentIds: ['led'] },
        ]);
      });

      it('golden path on breadboard -> Circuit OK', () => {
        expect(codes(validate(goldenOnBreadboard(kind, pin)))).toEqual(['ok']);
      });

      it('reversed LED -> error', () => {
        const c: Circuit = {
          components: [board('b', kind), res(), led()],
          connections: [
            w(p('b', pin), p('r', 'a')),
            w(p('r', 'b'), p('led', 'cathode')),
            w(p('led', 'anode'), p('b', 'GND')),
          ],
        };
        const msgs = validate(c);
        expect(codes(msgs)).toEqual(['led-reversed']);
        expect(msgs[0]).toMatchObject({ level: 'error', text: 'LED is reversed (anode/cathode).' });
        expect(msgs[0].componentIds).toContain('led');
      });

      it('missing GND -> open circuit', () => {
        const c = golden(kind, pin);
        c.connections.pop();
        const msgs = validate(c);
        expect(codes(msgs)).toEqual(['open-circuit']);
        expect(msgs[0]).toMatchObject({ level: 'error', text: 'Circuit is open: cathode not connected to GND.' });
      });

      it('missing GND on breadboard (rail jumper removed) -> open circuit', () => {
        const c = goldenOnBreadboard(kind, pin);
        c.connections.pop();
        expect(codes(validate(c))).toEqual(['open-circuit']);
      });

      it('no resistor -> warning', () => {
        const c: Circuit = {
          components: [board('b', kind), led()],
          connections: [w(p('b', pin), p('led', 'anode')), w(p('led', 'cathode'), p('b', 'GND'))],
        };
        const msgs = validate(c);
        expect(codes(msgs)).toEqual(['no-resistor']);
        expect(msgs[0]).toMatchObject({ level: 'warning', text: 'LED may burn out; add a resistor.' });
      });

      it('resistor on the cathode side -> OK', () => {
        const c: Circuit = {
          components: [board('b', kind), res(), led()],
          connections: [
            w(p('b', pin), p('led', 'anode')),
            w(p('led', 'cathode'), p('r', 'a')),
            w(p('r', 'b'), p('b', 'GND')),
          ],
        };
        expect(codes(validate(c))).toEqual(['ok']);
      });
    });
  }

  it('no resistor on breadboard -> warning', () => {
    const c: Circuit = {
      components: [board('b', 'arduino-uno'), bb(), led()],
      connections: [
        w(p('b', 'D13'), p('bb', 'a5')),
        w(p('led', 'anode'), p('bb', 'e5')),
        w(p('led', 'cathode'), p('bb', '-4')),
        w(p('bb', '-1'), p('b', 'GND')),
      ],
    };
    expect(codes(validate(c))).toEqual(['no-resistor']);
  });

  it('Arduino 5V to GND -> short', () => {
    const c: Circuit = {
      components: [board('uno', 'arduino-uno')],
      connections: [w(p('uno', '5V'), p('uno', 'GND'))],
    };
    expect(validate(c)).toEqual([{ level: 'error', code: 'short', text: 'Short circuit.', componentIds: ['uno'] }]);
  });

  it('ESP32 3V3 to GND via breadboard rail -> short', () => {
    const c: Circuit = {
      components: [board('esp', 'esp32'), bb()],
      connections: [w(p('esp', '3V3'), p('bb', '+1')), w(p('esp', 'GND'), p('bb', '+9'))],
    };
    expect(codes(validate(c))).toEqual(['short']);
  });

  it('short is reported alongside an otherwise working LED (and no OK)', () => {
    const c = golden('arduino-uno', 'D13');
    c.connections.push(w(p('b', '5V'), p('b', 'GND')));
    expect(codes(validate(c))).toEqual(['short']);
  });

  it('power through a resistor to GND is not a short', () => {
    const c: Circuit = {
      components: [board('uno', 'arduino-uno'), res()],
      connections: [w(p('uno', '5V'), p('r', 'a')), w(p('r', 'b'), p('uno', 'GND'))],
    };
    expect(validate(c)).toEqual([]);
  });

  it('Arduino 5V into ESP32 GPIO -> esp32-5v error', () => {
    const c: Circuit = {
      components: [board('uno', 'arduino-uno'), board('esp', 'esp32')],
      connections: [w(p('uno', '5V'), p('esp', 'GPIO4'))],
    };
    const msgs = validate(c);
    expect(codes(msgs)).toEqual(['esp32-5v']);
    expect(msgs[0]).toMatchObject({
      level: 'error',
      text: 'ESP32 GPIO is 3.3V only; 5V can damage it.',
      componentIds: ['esp', 'uno'],
    });
  });

  it('ESP32 VIN into its own GPIO -> esp32-5v error', () => {
    const c: Circuit = { components: [board('esp', 'esp32')], connections: [w(p('esp', 'VIN'), p('esp', 'GPIO2'))] };
    expect(codes(validate(c))).toEqual(['esp32-5v']);
  });

  it('ESP32 3V3 into its GPIO is not an esp32-5v error', () => {
    const c: Circuit = { components: [board('esp', 'esp32')], connections: [w(p('esp', '3V3'), p('esp', 'GPIO2'))] };
    expect(validate(c)).toEqual([]);
  });

  it('Arduino 5V into an Arduino GPIO is not an esp32-5v error', () => {
    const c: Circuit = { components: [board('uno', 'arduino-uno')], connections: [w(p('uno', '5V'), p('uno', 'D2'))] };
    expect(validate(c)).toEqual([]);
  });

  it('Arduino D-pin to ESP32 GPIO -> level mismatch warning', () => {
    const c: Circuit = {
      components: [board('uno', 'arduino-uno'), board('esp', 'esp32'), bb()],
      connections: [w(p('uno', 'D7'), p('bb', 'a10')), w(p('esp', 'GPIO18'), p('bb', 'd10'))],
    };
    const msgs = validate(c);
    expect(codes(msgs)).toEqual(['level-mismatch']);
    expect(msgs[0]).toMatchObject({
      level: 'warning',
      text: 'Level mismatch: use a level shifter or voltage divider.',
      componentIds: ['esp', 'uno'],
    });
  });

  it('two boards present, only one wired -> OK', () => {
    const c = golden('esp32', 'GPIO2', 'esp');
    c.components.push(board('uno', 'arduino-uno'));
    expect(codes(validate(c))).toEqual(['ok']);
  });

  it('reports one message per LED and deduplicates repeated wiring', () => {
    const c: Circuit = {
      components: [board('b', 'arduino-uno'), led('l1'), led('l2')],
      connections: [
        w(p('b', 'D13'), p('l1', 'anode')),
        w(p('b', 'D13'), p('l2', 'anode')),
        w(p('b', 'D13'), p('l1', 'anode')),
      ],
    };
    const msgs = validate(c);
    expect(codes(msgs)).toEqual(['open-circuit', 'open-circuit']);
    expect(msgs.map((m) => m.componentIds?.find((id) => id.startsWith('l'))).sort()).toEqual(['l1', 'l2']);
  });

  it('reports a single short per net even with several power pins', () => {
    const c: Circuit = {
      components: [board('esp', 'esp32')],
      connections: [w(p('esp', '3V3'), p('esp', 'GND')), w(p('esp', 'VIN'), p('esp', 'GND'))],
    };
    expect(codes(validate(c))).toEqual(['short']);
  });
});

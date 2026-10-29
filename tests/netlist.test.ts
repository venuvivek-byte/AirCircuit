import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../src/sim/netlist';
import type { Circuit, Connection, PinRef, SimComponent } from '../src/sim/types';

const p = (componentId: string, pin: string): PinRef => ({ componentId, pin });
const w = (a: PinRef, b: PinRef): Connection => ({ a, b });
const circuit = (components: SimComponent[], connections: Connection[]): Circuit => ({ components, connections });

const uno: SimComponent = { id: 'uno', type: 'board', boardKind: 'arduino-uno' };
const esp: SimComponent = { id: 'esp', type: 'board', boardKind: 'esp32' };
const bb: SimComponent = { id: 'bb', type: 'breadboard' };
const led: SimComponent = { id: 'led', type: 'led' };
const res: SimComponent = { id: 'r', type: 'resistor' };

describe('buildNetlist', () => {
  it('merges the two pins of a connection', () => {
    const n = buildNetlist(circuit([uno, led], [w(p('uno', 'D13'), p('led', 'anode'))]));
    expect(n.sameNet(p('uno', 'D13'), p('led', 'anode'))).toBe(true);
    expect(n.sameNet(p('uno', 'GND'), p('led', 'anode'))).toBe(false);
  });

  it('is transitive across chains of wires', () => {
    const n = buildNetlist(
      circuit([uno, led, res], [w(p('uno', 'D13'), p('r', 'a')), w(p('r', 'a'), p('led', 'anode'))]),
    );
    expect(n.sameNet(p('uno', 'D13'), p('led', 'anode'))).toBe(true);
    const pins = n
      .pinsInNet(n.netOf(p('uno', 'D13')))
      .map((r) => `${r.componentId}:${r.pin}`)
      .sort();
    expect(pins).toEqual(['led:anode', 'r:a', 'uno:D13']);
  });

  it('does not conduct through resistors or LEDs', () => {
    const n = buildNetlist(circuit([led, res], []));
    expect(n.sameNet(p('r', 'a'), p('r', 'b'))).toBe(false);
    expect(n.sameNet(p('led', 'anode'), p('led', 'cathode'))).toBe(false);
  });

  it('treats unknown pins as singleton nets', () => {
    const n = buildNetlist(circuit([], []));
    expect(n.sameNet(p('x', 'a'), p('y', 'a'))).toBe(false);
    expect(n.netOf(p('x', 'a'))).toBe(n.netOf(p('x', 'a')));
    expect(n.pinsInNet(n.netOf(p('x', 'a')))).toEqual([]);
  });

  it('merges breadboard holes in the same column group', () => {
    const n = buildNetlist(
      circuit([bb, led, res], [w(p('led', 'anode'), p('bb', 'a5')), w(p('r', 'b'), p('bb', 'e5'))]),
    );
    expect(n.sameNet(p('led', 'anode'), p('r', 'b'))).toBe(true);
    // Unused holes still follow the grouping.
    expect(n.sameNet(p('bb', 'c5'), p('led', 'anode'))).toBe(true);
    expect(n.sameNet(p('bb', 'f5'), p('led', 'anode'))).toBe(false);
    expect(n.sameNet(p('bb', 'a6'), p('led', 'anode'))).toBe(false);
  });

  it('merges whole rails and keeps + and - separate', () => {
    const n = buildNetlist(circuit([bb, uno], [w(p('uno', 'GND'), p('bb', '-1'))]));
    expect(n.sameNet(p('bb', '-30'), p('uno', 'GND'))).toBe(true);
    expect(n.sameNet(p('bb', '+1'), p('uno', 'GND'))).toBe(false);
  });

  it('keeps two breadboards independent', () => {
    const bb2: SimComponent = { id: 'bb2', type: 'breadboard' };
    const n = buildNetlist(circuit([bb, bb2], []));
    expect(n.sameNet(p('bb', 'a1'), p('bb2', 'a1'))).toBe(false);
  });

  it('includes all board pins as known pins', () => {
    const n = buildNetlist(circuit([esp], []));
    expect(n.pinsInNet(n.netOf(p('esp', 'GPIO2')))).toEqual([p('esp', 'GPIO2')]);
    expect(n.nets().length).toBe(10);
  });
});

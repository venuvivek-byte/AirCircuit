// Netlist builder (MVP_SPEC §3.5): union-find over pins.
// - Every Connection merges its two pins.
// - Breadboard holes in the same holeGroup (column of 5, or a rail) are merged.
// - Pins that appear nowhere are their own singleton net.
// Pure: no Three.js, no DOM.

import { BOARDS } from '../components/boards';
import { holeGroup } from '../components/breadboardLayout';
import { SENSORS } from '../components/sensors';
import { LED_PINS, RESISTOR_PINS, pinKey, type Circuit, type PinRef, type SimComponent } from './types';

export interface Netlist {
  /** Canonical net id for a pin (also valid for pins not mentioned in the circuit). */
  netOf(ref: PinRef): string;
  /** All known pins (component pins + breadboard holes in use) in the given net. */
  pinsInNet(netId: string): PinRef[];
  sameNet(a: PinRef, b: PinRef): boolean;
  /** Ids of all nets that contain at least one known pin. */
  nets(): string[];
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = x;
    let p = this.parent.get(root);
    while (p !== undefined && p !== root) {
      root = p;
      p = this.parent.get(root);
    }
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Deterministic: smaller string becomes root.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

/** Builds a netlist from a circuit description. */
export function buildNetlist(circuit: Circuit): Netlist {
  const byId = new Map<string, SimComponent>();
  for (const c of circuit.components) byId.set(c.id, c);

  const uf = new UnionFind();
  const known = new Map<string, PinRef>();

  // Breadboard holes map onto a shared group node so grouping applies to any hole name.
  const nodeOf = (ref: PinRef): string => {
    const comp = byId.get(ref.componentId);
    if (comp?.type === 'breadboard') {
      try {
        return `${ref.componentId}#${holeGroup(ref.pin)}`;
      } catch {
        // Invalid hole name: treat as its own pin.
      }
    }
    return pinKey(ref);
  };

  const register = (ref: PinRef): void => {
    const key = pinKey(ref);
    if (!known.has(key)) known.set(key, { componentId: ref.componentId, pin: ref.pin });
    const node = nodeOf(ref);
    uf.add(node);
    if (node !== key) uf.union(key, node);
  };

  for (const c of circuit.components) {
    if (c.type === 'board' && c.boardKind) {
      for (const p of BOARDS[c.boardKind].pins) register({ componentId: c.id, pin: p.name });
    } else if (c.type === 'led') {
      for (const pin of LED_PINS) register({ componentId: c.id, pin });
    } else if (c.type === 'resistor') {
      for (const pin of RESISTOR_PINS) register({ componentId: c.id, pin });
    } else if (c.type === 'sensor' && c.sensorKind) {
      for (const p of SENSORS[c.sensorKind].pins) register({ componentId: c.id, pin: p.name });
    }
  }

  for (const { a, b } of circuit.connections) {
    register(a);
    register(b);
    uf.union(nodeOf(a), nodeOf(b));
  }

  // Index pins by net.
  const members = new Map<string, PinRef[]>();
  for (const [key, ref] of known) {
    const net = uf.find(key);
    let list = members.get(net);
    if (!list) members.set(net, (list = []));
    list.push(ref);
  }

  const netOf = (ref: PinRef): string => uf.find(nodeOf(ref));

  return {
    netOf,
    pinsInNet: (netId) => (members.get(netId) ?? []).slice(),
    sameNet: (a, b) => netOf(a) === netOf(b),
    nets: () => [...members.keys()],
  };
}

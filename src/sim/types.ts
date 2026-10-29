// Pure circuit description consumed by netlist / simulator / validator.
// The scene layer converts its components, snapped legs and wires into this shape.

import type { BoardKind } from '../components/boards';

export type ComponentType = 'board' | 'breadboard' | 'led' | 'resistor';

export interface SimComponent {
  id: string;
  type: ComponentType;
  /** Required when type === 'board'. */
  boardKind?: BoardKind;
}

/** Pin names per component type:
 *  board      -> names from BOARDS[boardKind].pins
 *  breadboard -> hole names from breadboardLayout ('a1', '+3', ...)
 *  led        -> 'anode' | 'cathode'
 *  resistor   -> 'a' | 'b'
 */
export interface PinRef {
  componentId: string;
  pin: string;
}

/** An electrical connection between two pins: a jumper wire, or a leg inserted into a breadboard hole. */
export interface Connection {
  a: PinRef;
  b: PinRef;
}

export interface Circuit {
  components: SimComponent[];
  connections: Connection[];
}

export const LED_PINS = ['anode', 'cathode'] as const;
export const RESISTOR_PINS = ['a', 'b'] as const;

export function pinKey(ref: PinRef): string {
  return `${ref.componentId}:${ref.pin}`;
}

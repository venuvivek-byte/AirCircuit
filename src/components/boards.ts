// Board definitions as data (MVP_SPEC §3.3). Adding a board = adding an entry here.
// Pure data: no Three.js, so the simulator and validator can import it.

export type BoardKind = 'arduino-uno' | 'esp32';
export type PinRole = 'gpio' | 'ground' | 'power';

export interface BoardPinDef {
  name: string;
  role: PinRole;
  /** Supply voltage for power pins. */
  voltage?: number;
  /** Local position on the board (scene units, board centered at origin, top face at y = size[1]/2). */
  pos: [number, number, number];
}

export interface BoardDef {
  kind: BoardKind;
  label: string;
  logicLevel: 5 | 3.3;
  blinkPin: string;
  groundPins: string[];
  powerPins: string[];
  /** Body width, thickness, depth. */
  size: [number, number, number];
  color: number;
  pins: BoardPinDef[];
}

const PIN_PITCH = 0.14;

/** Lays out a straight header row of pins along X at the given z on top of the board. */
function header(
  names: Array<[string, PinRole, number?]>,
  z: number,
  topY: number,
  startX: number,
): BoardPinDef[] {
  return names.map(([name, role, voltage], i) => ({
    name,
    role,
    ...(voltage !== undefined ? { voltage } : {}),
    pos: [startX + i * PIN_PITCH, topY, z],
  }));
}

const UNO_SIZE: [number, number, number] = [2.1, 0.08, 1.6];
const ESP_SIZE: [number, number, number] = [1.0, 0.08, 2.0];

export const BOARDS: Record<BoardKind, BoardDef> = {
  'arduino-uno': {
    kind: 'arduino-uno',
    label: 'Arduino Uno',
    logicLevel: 5,
    blinkPin: 'D13',
    groundPins: ['GND', 'GND2'],
    powerPins: ['5V'],
    size: UNO_SIZE,
    color: 0x00878f, // Arduino teal
    pins: [
      // Digital header along the back edge.
      ...header(
        [
          ['GND', 'ground'],
          ['D13', 'gpio'], ['D12', 'gpio'], ['D11', 'gpio'], ['D10', 'gpio'],
          ['D9', 'gpio'], ['D8', 'gpio'], ['D7', 'gpio'], ['D6', 'gpio'],
          ['D5', 'gpio'], ['D4', 'gpio'], ['D3', 'gpio'], ['D2', 'gpio'],
        ],
        -0.65,
        UNO_SIZE[1] / 2,
        -0.84,
      ),
      // Power header along the front edge, then the analog inputs.
      ...header([['5V', 'power', 5], ['GND2', 'ground']], 0.7, UNO_SIZE[1] / 2, -0.84),
      ...header(
        [['A0', 'gpio'], ['A1', 'gpio'], ['A2', 'gpio'], ['A3', 'gpio'], ['A4', 'gpio'], ['A5', 'gpio']],
        0.7,
        UNO_SIZE[1] / 2,
        0.0,
      ),
    ],
  },
  esp32: {
    kind: 'esp32',
    label: 'ESP32 DevKit',
    logicLevel: 3.3,
    blinkPin: 'GPIO2',
    groundPins: ['GND'],
    powerPins: ['3V3', 'VIN'],
    size: ESP_SIZE,
    color: 0x222222, // dark board, distinct from the Uno
    pins: [
      // Left row (runs along z).
      ...(
        [
          ['3V3', 'power', 3.3], ['GND', 'ground'], ['GPIO2', 'gpio'], ['GPIO4', 'gpio'], ['GPIO5', 'gpio'],
          ['GPIO34', 'gpio'],
        ] as Array<[string, PinRole, number?]>
      ).map(([name, role, voltage], i): BoardPinDef => ({
        name, role, ...(voltage !== undefined ? { voltage } : {}),
        pos: [-0.42, ESP_SIZE[1] / 2, -0.6 + i * 0.3],
      })),
      // Right row.
      ...(
        [
          ['VIN', 'power', 5], ['GPIO18', 'gpio'], ['GPIO19', 'gpio'], ['GPIO21', 'gpio'], ['GPIO23', 'gpio'],
          ['GPIO35', 'gpio'],
        ] as Array<[string, PinRole, number?]>
      ).map(([name, role, voltage], i): BoardPinDef => ({
        name, role, ...(voltage !== undefined ? { voltage } : {}),
        pos: [0.42, ESP_SIZE[1] / 2, -0.6 + i * 0.3],
      })),
    ],
  },
};

export function getPinDef(kind: BoardKind, pin: string): BoardPinDef | undefined {
  return BOARDS[kind].pins.find((p) => p.name === pin);
}

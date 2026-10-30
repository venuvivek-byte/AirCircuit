// Sensor module definitions as data (like boards.ts). Pure data: no Three.js, so the simulator can import it.
// Pins sit in one header row at breadboard pitch, so a module plugs into the breadboard like an LED.

export type SensorKind = 'ir' | 'ultrasonic' | 'sound' | 'gas';

/** vcc / gnd power the module; out / aout / echo are driven by it; trig is read by it. */
export type SensorPinRole = 'vcc' | 'gnd' | 'out' | 'aout' | 'trig' | 'echo';

export interface SensorDef {
  kind: SensorKind;
  label: string;
  /** Pin header, left to right. */
  pins: Array<{ name: string; role: SensorPinRole }>;
  /** Body width (x), thickness, depth (z). */
  size: [number, number, number];
  color: number;
  /** One line shown in the code panel: what the module outputs. */
  behaviour: string;
}

export const SENSORS: Record<SensorKind, SensorDef> = {
  ir: {
    kind: 'ir',
    label: 'IR obstacle (FC-51)',
    pins: [
      { name: 'VCC', role: 'vcc' },
      { name: 'GND', role: 'gnd' },
      { name: 'OUT', role: 'out' },
    ],
    size: [0.55, 0.05, 0.9],
    color: 0x1f4fa8,
    behaviour: 'OUT goes LOW when something (your hand) is close in front of it.',
  },
  ultrasonic: {
    kind: 'ultrasonic',
    label: 'Ultrasonic (HC-SR04)',
    pins: [
      { name: 'VCC', role: 'vcc' },
      { name: 'TRIG', role: 'trig' },
      { name: 'ECHO', role: 'echo' },
      { name: 'GND', role: 'gnd' },
    ],
    size: [1.0, 0.05, 0.5],
    color: 0x1f6fb0,
    behaviour: 'pulseIn(ECHO, HIGH) = distance to your hand × 58 µs (cm = µs / 58).',
  },
  sound: {
    kind: 'sound',
    label: 'Sound (KY-038)',
    pins: [
      { name: 'AO', role: 'aout' },
      { name: 'GND', role: 'gnd' },
      { name: 'VCC', role: 'vcc' },
      { name: 'DO', role: 'out' },
    ],
    size: [0.65, 0.05, 0.85],
    color: 0xb02a2a,
    behaviour: 'AO rises with loudness (microphone); DO goes HIGH on a loud sound.',
  },
  gas: {
    kind: 'gas',
    label: 'Gas (MQ-2)',
    pins: [
      { name: 'VCC', role: 'vcc' },
      { name: 'GND', role: 'gnd' },
      { name: 'DO', role: 'out' },
      { name: 'AO', role: 'aout' },
    ],
    size: [0.65, 0.05, 0.85],
    color: 0x2a7a3a,
    behaviour: 'AO rises with gas level (hold G); DO goes LOW when gas is detected.',
  },
};

/** What a module senses this frame (filled in by the scene from the hand / microphone / keyboard). */
export interface SensorEnv {
  /** IR: something is in front, within range. */
  obstacle: boolean;
  /** Ultrasonic: distance to the nearest thing in front (cm), or null when out of range. */
  distanceCm: number | null;
  /** Sound level 0..1. */
  sound: number;
  /** Gas concentration 0..1. */
  gas: number;
}

export const QUIET_ENV: SensorEnv = { obstacle: false, distanceCm: null, sound: 0, gas: 0 };

/** Module thresholds (the on-board trimpot in the real modules). */
export const SOUND_DO_THRESHOLD = 0.5;
export const GAS_DO_THRESHOLD = 0.4;

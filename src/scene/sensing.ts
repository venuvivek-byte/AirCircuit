import * as THREE from 'three';
import { config } from '../config';
import { Sensor } from '../components/sensor';
import type { SensorEnv } from '../components/sensors';
import type { SceneManager } from './sceneManager';
import type { World } from './world';

/** Height above the table at which the hand is projected when testing the sensors' beams. */
const PROBE_Y = 0.3;

/**
 * What each sensor module senses this frame. Probes are screen points of real things (hand palm /
 * fingertip, or the mouse) projected onto the table; a sensor looks along its local +z.
 */
export function senseEnvironment(
  sm: SceneManager,
  world: World,
  probes: Array<{ px: number; py: number }>,
  sound: number,
  gas: number,
): Map<string, SensorEnv> {
  const s = config.sensors;
  const points = probes.map((p) => sm.screenToWorkspace(p.px, p.py, PROBE_Y)).filter((p): p is THREE.Vector3 => !!p);
  const env = new Map<string, SensorEnv>();
  const inv = new THREE.Matrix4();
  const local = new THREE.Vector3();
  for (const c of world.components) {
    if (!(c instanceof Sensor)) continue;
    c.root.updateMatrix();
    inv.copy(c.root.matrix).invert();
    const halfDepth = c.def.size[2] / 2;
    const halfWidth = c.def.size[0] / 2;
    let distanceCm: number | null = null;
    let obstacle = false;
    for (const p of points) {
      local.copy(p).applyMatrix4(inv);
      const ahead = local.z - halfDepth;
      const side = Math.abs(local.x);
      if (ahead <= 0) continue;
      if (c.def.kind === 'ultrasonic' && side <= halfWidth + ahead * Math.tan(s.beamHalfAngleRad)) {
        const cm = 2 + ahead * s.cmPerUnit;
        if (cm <= s.ultrasonicMaxCm && (distanceCm === null || cm < distanceCm)) distanceCm = cm;
      }
      if (c.def.kind === 'ir' && ahead <= s.irRange && side <= s.irHalfWidth) obstacle = true;
    }
    env.set(c.id, { obstacle, distanceCm, sound, gas });
  }
  return env;
}

/** Microphone loudness (0..1) via Web Audio, started on demand (it asks for mic permission). */
export class Microphone {
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  state: 'off' | 'starting' | 'on' | 'denied' = 'off';

  async start(): Promise<void> {
    if (this.state === 'on' || this.state === 'starting') return;
    this.state = 'starting';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(this.analyser);
      this.state = 'on';
    } catch {
      this.state = 'denied';
    }
  }

  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * config.sensors.micGain);
  }
}

import * as THREE from 'three';
import { config } from '../config';
import { makeLabel } from '../components/component';
import { PressDetector } from '../tracking/gestures';
import type { SceneManager } from '../scene/sceneManager';

export type ControlAction = 'run' | 'stop' | 'reset';

interface Button {
  action: ControlAction;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseColor: number;
  press: PressDetector;
  /** Fingertip scene z when it entered the button; penetration is measured from here. */
  entryZ: number | null;
}

const DEFS: Array<[ControlAction, string, number]> = [
  ['run', '▶ Run', 0x22aa55],
  ['stop', '■ Stop', 0xd08a20],
  ['reset', '⟲ Reset', 0xc03030],
];

/**
 * 3D Run / Stop / Reset buttons floating above the workspace. A fingertip "press" fires when it pushes
 * `pressDepth` farther from the camera than where it entered the button (relative depth is far more
 * stable than absolute depth from hand size). Mouse clicks and pinches on a button also fire it.
 */
export class ControlButtons {
  private buttons: Button[] = [];
  private group = new THREE.Group();

  constructor(
    private sm: SceneManager,
    private onAction: (a: ControlAction) => void,
  ) {
    const { y, z, spacing, size } = config.controls;
    DEFS.forEach(([action, label, color], i) => {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
      mesh.position.set((i - 1) * spacing, y, z);
      const text = makeLabel(label, '#ffffff', 0.14);
      text.position.z = size[2] / 2 + 0.01;
      mesh.add(text);
      this.group.add(mesh);
      this.buttons.push({ action, mesh, material, baseColor: color, press: new PressDetector(), entryZ: null });
    });
    sm.scene.add(this.group);
  }

  private at(px: number, py: number): Button | undefined {
    const hit = this.sm.rayAt(px, py).intersectObjects(this.buttons.map((b) => b.mesh), false)[0];
    return hit && this.buttons.find((b) => b.mesh === hit.object);
  }

  /** True if a screen point is over a button (so other input should ignore it). */
  contains(px: number, py: number): boolean {
    return !!this.at(px, py);
  }

  /** Click / pinch: fire the button under the point, if any. */
  click(px: number, py: number): boolean {
    const b = this.at(px, py);
    if (b) this.fire(b);
    return !!b;
  }

  /**
   * Fingertip press. `tip` is the index fingertip (screen px + scene z) or null without a hand.
   * Also renders hover / push feedback.
   */
  updateFingertip(tip: { px: number; py: number; z: number } | null): void {
    const over = tip ? this.at(tip.px, tip.py) : undefined;
    for (const b of this.buttons) {
      if (b === over && tip) {
        b.entryZ ??= tip.z;
        // Track the closest-to-camera point seen while hovering, so a slow approach doesn't count as a push.
        b.entryZ = Math.max(b.entryZ, tip.z);
        const penetration = b.entryZ - tip.z;
        if (b.press.update(penetration)) this.fire(b);
        const push = Math.min(1, Math.max(0, penetration / config.gestures.pressDepth));
        b.mesh.scale.z = 1 - 0.6 * push;
        b.material.emissive.setHex(0x333333);
      } else {
        b.entryZ = null;
        b.press.update(null);
        b.mesh.scale.z = 1;
        b.material.emissive.setHex(0x000000);
      }
    }
  }

  setRunning(running: boolean): void {
    for (const b of this.buttons) {
      const dim = (b.action === 'run' && running) || (b.action === 'stop' && !running);
      b.material.color.setHex(dim ? 0x555555 : b.baseColor);
    }
  }

  private fire(b: Button): void {
    b.mesh.scale.z = 0.4;
    this.onAction(b.action);
  }
}

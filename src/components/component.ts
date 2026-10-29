import * as THREE from 'three';
import { config } from '../config';
import type { ComponentType, SimComponent } from '../sim/types';

export interface PinInfo {
  name: string;
  /** Position in the component's local frame. */
  local: THREE.Vector3;
}

/**
 * Base for every placeable component: a Three.js group (positioned on the workspace table, local y = 0)
 * plus named pins at local positions.
 */
export abstract class SceneComponent {
  readonly root = new THREE.Group();
  readonly pins: PinInfo[] = [];

  constructor(
    readonly id: string,
    readonly type: ComponentType,
  ) {
    this.root.userData.component = this;
    this.root.name = id;
  }

  pin(name: string): PinInfo | undefined {
    return this.pins.find((p) => p.name === name);
  }

  pinWorld(name: string, target = new THREE.Vector3()): THREE.Vector3 {
    const p = this.pin(name);
    if (!p) throw new Error(`${this.id} has no pin ${name}`);
    this.root.updateWorldMatrix(true, false);
    return target.copy(p.local).applyMatrix4(this.root.matrixWorld);
  }

  toSim(): SimComponent {
    return { id: this.id, type: this.type };
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        });
      }
    });
  }
}

/** Camera-facing text label from a canvas texture. */
export function makeLabel(text: string, color = '#ffffff', scale = config.components.labelScale): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontPx = 48;
  ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  canvas.width = w;
  canvas.height = fontPx + 16;
  ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((scale * canvas.width) / canvas.height, scale, 1);
  sprite.renderOrder = 10;
  // Labels are not grab targets.
  sprite.raycast = () => {};
  return sprite;
}

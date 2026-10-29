import * as THREE from 'three';
import { config } from '../config';

/** Owns the transparent Three.js renderer, camera and lights drawn over the webcam feed. */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    const { fov, near, far, cameraZ } = config.scene;
    this.camera = new THREE.PerspectiveCamera(fov, 1, near, far);
    this.camera.position.set(0, 0, cameraZ);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** World point on the plane z = worldZ under the given screen pixel. */
  screenToWorld(px: number, py: number, worldZ: number, target = new THREE.Vector3()): THREE.Vector3 {
    const ndc = new THREE.Vector3((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const t = (worldZ - this.camera.position.z) / dir.z;
    return target.copy(this.camera.position).addScaledVector(dir, t);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

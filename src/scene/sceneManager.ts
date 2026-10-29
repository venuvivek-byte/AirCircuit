import * as THREE from 'three';
import { config } from '../config';

/** Owns the transparent Three.js renderer, camera and lights drawn over the webcam feed. */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Virtual table tilted toward the camera; components live on its local y = 0 plane. */
  readonly workspace = new THREE.Group();
  private raycaster = new THREE.Raycaster();

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

    this.workspace.rotation.x = config.workspace.tiltRad;
    this.workspace.position.y = config.workspace.y;
    this.workspace.scale.setScalar(config.workspace.scale);
    this.scene.add(this.workspace);
    this.workspace.updateMatrixWorld();

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

  /** Ray from the camera through a screen pixel. */
  rayAt(px: number, py: number): THREE.Raycaster {
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  /** Point on the workspace plane at local height `localY`, in workspace-local coords, under a screen pixel. */
  screenToWorkspace(px: number, py: number, localY = 0): THREE.Vector3 | null {
    const ray = this.rayAt(px, py).ray;
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(this.workspace.matrixWorld);
    const point = new THREE.Vector3(0, localY, 0).applyMatrix4(this.workspace.matrixWorld);
    const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point), new THREE.Vector3());
    return hit ? this.workspace.worldToLocal(hit) : null;
  }

  /** Screen pixel of a world point. */
  worldToScreen(p: THREE.Vector3): { px: number; py: number; behind: boolean } {
    const v = p.clone().project(this.camera);
    return { px: ((v.x + 1) / 2) * window.innerWidth, py: ((1 - v.y) / 2) * window.innerHeight, behind: v.z > 1 };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

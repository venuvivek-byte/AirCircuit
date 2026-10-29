import * as THREE from 'three';
import { startWebcam } from './camera/webcam';
import { SceneManager } from './scene/sceneManager';
import { FpsCounter, StatusPanel, type StatusInfo } from './ui/panel';

const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusPanel = new StatusPanel(document.getElementById('status')!);

const sceneManager = new SceneManager(canvas);
const fpsCounter = new FpsCounter();
const status: StatusInfo = { fps: 0, camera: 'starting' };

// Milestone 1 test cube; replaced by real components in milestone 3.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x3fa7ff }),
);
sceneManager.scene.add(cube);

startWebcam(video)
  .then(() => (status.camera = 'ok'))
  .catch((err: unknown) => {
    status.camera = 'error';
    status.cameraError = err instanceof Error ? err.message : String(err);
    console.error('Webcam failed:', err);
  });

function loop(now: number): void {
  fpsCounter.tick(now);
  status.fps = fpsCounter.fps;

  cube.rotation.x += 0.01;
  cube.rotation.y += 0.015;

  sceneManager.render();
  statusPanel.update(status);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

import * as THREE from 'three';
import { startWebcam } from './camera/webcam';
import { HandTracker } from './tracking/handTracker';
import { HandSmoother, TrackingRateController } from './tracking/smoothing';
import { LM, type TrackedHand } from './tracking/types';
import { SceneManager } from './scene/sceneManager';
import { handDepthZ, videoToScreen } from './scene/mapping';
import { FpsCounter, StatusPanel, type StatusInfo } from './ui/panel';

const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusPanel = new StatusPanel(document.getElementById('status')!);

const sceneManager = new SceneManager(canvas);
const fpsCounter = new FpsCounter();
const tracker = new HandTracker();
const smoother = new HandSmoother();
const rateController = new TrackingRateController();
const status: StatusInfo = { fps: 0, camera: 'starting', tracker: 'loading', handCount: 0, trackingEveryNFrames: 1 };

// Milestone 1 test cube; replaced by real components in milestone 3.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x3fa7ff }),
);
sceneManager.scene.add(cube);

// One fingertip cursor per hand.
const cursors = [0xffd23f, 0xff5fa2].map((color) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color }));
  m.visible = false;
  sceneManager.scene.add(m);
  return m;
});

/** World position of a landmark, using the palm size for depth. */
function landmarkToWorld(hand: TrackedHand, index: number, target: THREE.Vector3): THREE.Vector3 {
  const lm = hand.landmarks;
  const p = lm[index];
  const palm = Math.hypot(lm[LM.WRIST].x - lm[LM.MIDDLE_MCP].x, lm[LM.WRIST].y - lm[LM.MIDDLE_MCP].y);
  const { px, py } = videoToScreen(p.x, p.y, video.videoWidth, video.videoHeight, window.innerWidth, window.innerHeight);
  return sceneManager.screenToWorld(px, py, handDepthZ(palm), target);
}

startWebcam(video)
  .then(() => (status.camera = 'ok'))
  .catch((err: unknown) => {
    status.camera = 'error';
    status.cameraError = err instanceof Error ? err.message : String(err);
    console.error('Webcam failed:', err);
  });

tracker
  .init()
  .then(() => {
    status.tracker = 'ok';
    status.trackerDelegate = tracker.delegate;
  })
  .catch((err: unknown) => {
    status.tracker = 'error';
    console.error('Hand tracker failed:', err);
  });

let frameIndex = 0;

function loop(now: number): void {
  fpsCounter.tick(now);
  status.fps = fpsCounter.fps;

  // Only judge FPS once tracking is running, so model loading doesn't trigger the fallback.
  const everyN = tracker.ready ? rateController.update(fpsCounter.fps, now) : rateController.everyNFrames;
  status.trackingEveryNFrames = everyN;
  if (tracker.ready && status.camera === 'ok' && frameIndex % everyN === 0) {
    smoother.addSample(tracker.detect(video, now));
  }
  const hands = smoother.frame(everyN);
  status.handCount = hands.length;

  cursors.forEach((cursor, i) => {
    const hand = hands[i];
    cursor.visible = !!hand;
    if (hand) landmarkToWorld(hand, LM.INDEX_TIP, cursor.position);
  });

  cube.rotation.x += 0.01;
  cube.rotation.y += 0.015;

  sceneManager.render();
  statusPanel.update(status);
  frameIndex++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

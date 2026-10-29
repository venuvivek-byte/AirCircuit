import * as THREE from 'three';
import { config } from './config';
import { startWebcam } from './camera/webcam';
import { Board } from './components/board';
import { Led } from './components/led';
import { buildNetlist, type Netlist } from './sim/netlist';
import { Simulator } from './sim/simulator';
import type { Circuit } from './sim/types';
import { HandTracker } from './tracking/handTracker';
import { handSize, pinchRatio } from './tracking/gestures';
import { HandControl } from './scene/handControl';
import { HandSmoother, TrackingRateController } from './tracking/smoothing';
import { LM, type TrackedHand } from './tracking/types';
import { SceneManager } from './scene/sceneManager';
import { Interaction, type PointerState } from './scene/interaction';
import { handDepthZ, videoToScreen } from './scene/mapping';
import { World, type PinHit } from './scene/world';
import { FpsCounter, HintBar, MessagesPanel, StatusPanel, Toolbar, Tooltip, type StatusInfo } from './ui/panel';
import { ControlButtons, type ControlAction } from './ui/controls';
import { validate, type ValidationMessage } from './sim/validator';

const video = document.getElementById('video') as HTMLVideoElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusPanel = new StatusPanel(document.getElementById('status')!);
const tooltip = new Tooltip(document.getElementById('tooltip')!);

const sceneManager = new SceneManager(canvas);
const world = new World(sceneManager);
const trashEl = document.getElementById('trash')!;
function isOverTrash(px: number, py: number): boolean {
  const r = trashEl.getBoundingClientRect();
  return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
}
const interaction = new Interaction(sceneManager, world, isOverTrash);
const fpsCounter = new FpsCounter();
const tracker = new HandTracker();
const smoother = new HandSmoother();
const rateController = new TrackingRateController();
const status: StatusInfo = {
  input: 'hand', fps: 0, camera: 'starting', tracker: 'loading', handCount: 0, trackingEveryNFrames: 1,
};

const messagesPanel = new MessagesPanel(document.getElementById('messages')!);
const hintBar = new HintBar(document.getElementById('hint')!);
const controls = new ControlButtons(sceneManager, (a) => onControl(a));

// Dev-only handle for automated browser checks.
if (import.meta.env.DEV) Object.assign(window, { __app: { world, sceneManager, interaction, controls } });

new Toolbar(document.getElementById('toolbar')!, (action) => world.spawn(action));

// ---- Mouse mode (key M) ----
const mouse: PointerState = { px: 0, py: 0, down: false };
let mouseInside = false;

function setInput(mode: 'hand' | 'mouse'): void {
  status.input = mode;
  document.body.classList.toggle('mouse-mode', mode === 'mouse');
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') setInput(status.input === 'mouse' ? 'hand' : 'mouse');
  if (status.input === 'mouse' && (e.key === 'r' || e.key === 'R')) {
    interaction.rotateStep(e.shiftKey ? -config.interaction.mouseRotateStepRad : config.interaction.mouseRotateStepRad);
  }
  if (status.input === 'mouse' && (e.key === 'Delete' || e.key === 'Backspace')) interaction.deleteHovered();
  if (e.key === 'Enter') onControl('run');
  if (e.key === ' ') {
    e.preventDefault();
    onControl('stop');
  }
  if (e.key === 'n' || e.key === 'N') onControl('reset');
});
// Track on window so dragging across the toolbar doesn't cancel an action.
window.addEventListener('pointermove', (e) => {
  mouse.px = e.clientX;
  mouse.py = e.clientY;
  mouseInside = true;
});
document.documentElement.addEventListener('pointerleave', () => (mouseInside = false));
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  // A click on a 3D control button is not a grab.
  if (controls.click(e.clientX, e.clientY)) return;
  mouse.down = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) mouse.down = false;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    if (status.input !== 'mouse') return;
    e.preventDefault();
    interaction.rotateStep(Math.sign(e.deltaY) * config.interaction.mouseRotateStepRad);
  },
  { passive: false },
);

// ---- Hand cursors ----
const CURSOR_COLORS = [0xffd23f, 0xff5fa2];
const cursors = CURSOR_COLORS.map((color) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color }));
  m.visible = false;
  sceneManager.scene.add(m);
  return m;
});

function landmarkToScreen(hand: TrackedHand, index: number): { px: number; py: number } {
  const p = hand.landmarks[index];
  return videoToScreen(p.x, p.y, video.videoWidth, video.videoHeight, window.innerWidth, window.innerHeight);
}

/** World position of a landmark, using the palm size for depth. */
function landmarkToWorld(hand: TrackedHand, index: number, target: THREE.Vector3): THREE.Vector3 {
  const { px, py } = landmarkToScreen(hand, index);
  return sceneManager.screenToWorld(px, py, handDepthZ(handSize(hand.landmarks)), target);
}

// ---- Hand input ----
const handControl = new HandControl((x, y) =>
  videoToScreen(x, y, video.videoWidth, video.videoHeight, window.innerWidth, window.innerHeight),
);
/** True while a pinch that started on a toolbar button is held, so it doesn't also grab. */
let pinchOnUi = false;
let handHoverButton: HTMLElement | null = null;
let lastHandPointer: PointerState | null = null;

function uiButtonAt(px: number, py: number): HTMLElement | null {
  const el = document.elementFromPoint(px, py);
  return el instanceof HTMLElement && el.closest('button') ? (el.closest('button') as HTMLElement) : null;
}

function updateHandInput(hands: TrackedHand[]): void {
  const frame = handControl.update(hands, !!interaction.grabbed);
  lastHandPointer = frame.pointer;
  const button = frame.pointer ? uiButtonAt(frame.pointer.px, frame.pointer.py) : null;

  if (button !== handHoverButton) {
    handHoverButton?.classList.remove('hand-hover');
    button?.classList.add('hand-hover');
    handHoverButton = button;
  }
  if (frame.pinch.started && frame.pointer && !interaction.busy) {
    if (button) {
      button.click();
      pinchOnUi = true;
    } else if (controls.click(frame.pointer.px, frame.pointer.py)) {
      pinchOnUi = true;
    }
  }

  // Fingertip press on the 3D buttons (index tip, depth from palm size).
  const primary = hands[0];
  if (primary && !interaction.busy) {
    const { px, py } = landmarkToScreen(primary, LM.INDEX_TIP);
    controls.updateFingertip({ px, py, z: handDepthZ(handSize(primary.landmarks)) });
  } else {
    controls.updateFingertip(null);
  }
  if (!frame.pinch.pinching) pinchOnUi = false;

  interaction.update(frame.pointer && (pinchOnUi ? { ...frame.pointer, down: false } : frame.pointer));
  if (frame.rotation) interaction.rotateGrabbed(frame.rotation.yaw, frame.rotation.pitch);
}

// ---- Simulation + validator ----
const simulator = new Simulator();
let circuit: Circuit = world.toCircuit();
let netlist: Netlist = buildNetlist(circuit);
let messages: ValidationMessage[] = [];
let circuitVersion = -1;

function onControl(action: ControlAction): void {
  if (action === 'run') simulator.start(performance.now());
  else if (action === 'stop') simulator.stop();
  else {
    simulator.reset();
    interaction.update(null);
    world.clear();
  }
}

function updateSimulation(now: number): void {
  // Re-validate live whenever wiring or placement changes.
  if (world.version !== circuitVersion) {
    circuitVersion = world.version;
    circuit = world.toCircuit();
    netlist = buildNetlist(circuit);
    messages = validate(circuit, netlist);
  }
  const states = simulator.step(now, circuit, netlist);
  for (const c of world.components) if (c instanceof Led) c.setLit(states.get(c.id) ?? false);
  controls.setRunning(simulator.running);
  messagesPanel.update(messages, simulator.running, world.components.some((c) => c.type === 'led'));
}

function pinLabel(hit: PinHit): string {
  const c = hit.component;
  if (c instanceof Board) return `${c.def.label} · ${hit.pin}`;
  if (c.type === 'led') return hit.pin === 'anode' ? 'LED anode (+)' : 'LED cathode (−)';
  if (c.type === 'resistor') return `Resistor 220Ω · leg ${hit.pin}`;
  return `Breadboard · ${hit.pin}`;
}

startWebcam(video)
  .then(() => (status.camera = 'ok'))
  .catch((err: unknown) => {
    status.camera = 'error';
    status.cameraError = err instanceof Error ? err.message : String(err);
    console.error('Webcam failed:', err);
    setInput('mouse');
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
    if (hand) {
      landmarkToWorld(hand, LM.INDEX_TIP, cursor.position);
      const pinching = pinchRatio(hand.landmarks) < config.gestures.pinchOpen;
      (cursor.material as THREE.MeshBasicMaterial).color.setHex(pinching ? 0x3dff7a : CURSOR_COLORS[i]);
    }
  });

  if (status.input === 'mouse') {
    interaction.update(mouseInside ? mouse : null);
    controls.updateFingertip(null);
  } else {
    updateHandInput(hands);
  }

  updateSimulation(now);

  const pointer = status.input === 'mouse' ? (mouseInside ? mouse : null) : lastHandPointer;
  trashEl.classList.toggle('active', interaction.busy && !!pointer && isOverTrash(pointer.px, pointer.py));

  if (interaction.hoverPin) {
    const p = interaction.hoverPin.component.pinWorld(interaction.hoverPin.pin);
    const s = sceneManager.worldToScreen(p);
    tooltip.show(pinLabel(interaction.hoverPin), s.px, s.py);
  } else {
    tooltip.hide();
  }

  hintBar.update({
    input: status.input,
    camera: status.camera,
    tracker: status.tracker,
    handCount: hands.length,
    componentCount: world.components.length,
    action: interaction.action,
  });

  sceneManager.render();
  statusPanel.update(status);
  frameIndex++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

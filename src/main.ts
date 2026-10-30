import * as THREE from 'three';
import { config } from './config';
import { startWebcam } from './camera/webcam';
import { Board } from './components/board';
import { Led } from './components/led';
import { Sensor } from './components/sensor';
import { SENSORS, type SensorEnv } from './components/sensors';
import { buildNetlist, type Netlist } from './sim/netlist';
import { Machine } from './sim/machine';
import type { Circuit } from './sim/types';
import { HandTracker } from './tracking/handTracker';
import { handSize } from './tracking/gestures';
import { HandControl, type HandFrame } from './scene/handControl';
import { HandSmoother, TrackingRateController } from './tracking/smoothing';
import { LM, type TrackedHand } from './tracking/types';
import { SceneManager, type ZoomView } from './scene/sceneManager';
import { Interaction, type Grip, type PointerState } from './scene/interaction';
import { handDepthZ, videoToScreen } from './scene/mapping';
import { World, type PinHit } from './scene/world';
import { FpsCounter, HintBar, MessagesPanel, StatusPanel, Toolbar, Tooltip, type StatusInfo } from './ui/panel';
import { ControlButtons, type ControlAction } from './ui/controls';
import { SkeletonOverlay } from './ui/skeleton';
import { CodePanel } from './ui/codePanel';
import { SensorPanel } from './ui/sensorPanel';
import { Microphone, senseEnvironment } from './scene/sensing';
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
if (import.meta.env.DEV) Object.assign(window, { __app: { world, sceneManager, interaction, controls, get machine() { return machine; } } });

new Toolbar(document.getElementById('toolbar')!, (action) => {
  if (action === 'zoom') toggleZoom();
  else if (action === 'code') codePanel.toggle();
  else world.spawn(action);
});

/** Zoom onto the part under the pointer, else the breadboard, else the workspace centre; or zoom back out. */
function toggleZoom(): void {
  if (sceneManager.zoomed) {
    sceneManager.zoomTo(null);
    return;
  }
  const c = interaction.grabbed ?? interaction.hoverComponent ?? world.components.find((x) => x.type === 'breadboard');
  sceneManager.zoomTo(c ? c.root.getWorldPosition(new THREE.Vector3()) : sceneManager.workspace.getWorldPosition(new THREE.Vector3()));
}

// ---- Mouse mode (key M) ----
const mouse: PointerState = { px: 0, py: 0, down: false };
let mouseInside = false;

function setInput(mode: 'hand' | 'mouse'): void {
  status.input = mode;
  document.body.classList.toggle('mouse-mode', mode === 'mouse');
}

/** Keys held for the environment: V = loud noise, G = gas leak. */
const held = new Set<string>();
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

window.addEventListener('keydown', (e) => {
  // Typing in the code editor must not trigger shortcuts.
  const t = e.target;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement) return;
  if (!e.repeat) held.add(e.key.toLowerCase());
  if (e.key === 'c' || e.key === 'C') codePanel.toggle();
  if (e.key === 'm' || e.key === 'M') {
    autoMouse = false;
    setInput(status.input === 'mouse' ? 'hand' : 'mouse');
  }
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
  if (e.key === 'z' || e.key === 'Z') toggleZoom();
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

// ---- Hand input ----
const handToScreen = (x: number, y: number) =>
  videoToScreen(x, y, video.videoWidth, video.videoHeight, window.innerWidth, window.innerHeight);
const handControl = new HandControl(handToScreen);
const skeleton = new SkeletonOverlay(document.getElementById('skeleton') as HTMLCanvasElement, handToScreen);
let lastHandPointer: PointerState | null = null;
let lastGrips: Array<Grip | null> = [];
let lastScissors: HandFrame['scissors'] = null;

function landmarkToScreen(hand: TrackedHand, index: number): { px: number; py: number } {
  const p = hand.landmarks[index];
  return handToScreen(p.x, p.y);
}

function uiButtonAt(px: number, py: number): HTMLElement | null {
  const el = document.elementFromPoint(px, py);
  return el instanceof HTMLElement && el.closest('button') ? (el.closest('button') as HTMLElement) : null;
}

/** Hold the index fingertip on a toolbar button for `dwellSpawnMs` to press it (once per visit). */
const dwell = { button: null as HTMLElement | null, since: 0, fired: false };

function setDwell(button: HTMLElement | null, now: number): void {
  if (button !== dwell.button) {
    if (dwell.button) {
      dwell.button.classList.remove('hand-hover');
      dwell.button.style.removeProperty('--dwell');
      delete dwell.button.dataset.dwell;
    }
    button?.classList.add('hand-hover');
    Object.assign(dwell, { button, since: now, fired: false });
  }
  if (!button || dwell.fired) return;
  const ms = Number(button.dataset.dwellMs) || config.interaction.dwellSpawnMs;
  const progress = Math.min(1, (now - dwell.since) / ms);
  button.style.setProperty('--dwell', progress.toFixed(3));
  button.dataset.dwell = `${Math.ceil((ms - (now - dwell.since)) / 1000)}s`;
  if (progress >= 1) {
    dwell.fired = true;
    button.click();
    button.style.removeProperty('--dwell');
    button.dataset.dwell = '✓';
  }
}

function updateHandInput(hands: TrackedHand[], now: number): void {
  const frame = handControl.update(hands, !!interaction.grabbed);
  lastHandPointer = frame.pointer;
  lastGrips = frame.grips;
  const primary = hands[0];

  // Toolbar: point with the index fingertip (open hand) and hold still.
  const tip =
    primary && frame.grip === null && !frame.scissors && !interaction.busy ? landmarkToScreen(primary, LM.INDEX_TIP) : null;
  const button = tip ? uiButtonAt(tip.px, tip.py) : null;
  setDwell(button?.closest('#toolbar, #code, #sensors') ? button : null, now);

  // 3D Run / Stop / Reset: pinch on them, or push with the index fingertip (depth from palm size).
  let onControl = false;
  if (frame.gripStarted && frame.grip === 'pinch' && frame.pointer && !interaction.busy) {
    onControl = controls.click(frame.pointer.px, frame.pointer.py);
  }
  if (primary && !interaction.busy) {
    const { px, py } = landmarkToScreen(primary, LM.INDEX_TIP);
    controls.updateFingertip({ px, py, z: handDepthZ(handSize(primary.landmarks)) });
  } else {
    controls.updateFingertip(null);
  }

  // Closing a pinch into a fist (or back) switches tools: drop the half-done action.
  if (frame.gripSwitched) interaction.cancel();
  interaction.update(frame.pointer && (onControl ? { ...frame.pointer, down: false } : frame.pointer));
  interaction.scissors(frame.scissors);
  lastScissors = frame.scissors;
  if (frame.rotation) interaction.rotateGrabbed(frame.rotation.yaw, frame.rotation.pitch);
  updateDepthZoom(frame.depth);
}

/** View when the current fist grab started: the base the depth zoom scales from. */
let preGrabView: ZoomView | null = null;
const heldPos = new THREE.Vector3();

/**
 * Fist push toward the camera zooms in on the held part, pulling back zooms out.
 * Opening the fist keeps whatever zoom was reached (Z / 🔍 zooms back out).
 */
function updateDepthZoom(depth: number | null): void {
  const held = interaction.grabbed;
  if (depth === null || !held) {
    preGrabView = null;
    return;
  }
  preGrabView ??= sceneManager.view;
  const { gain, min, max } = config.zoom.depth;
  const zoom = Math.min(max, Math.max(min, preGrabView.zoom * depth ** gain));
  // Zoom about the part so it stays under the fist instead of the view jumping.
  sceneManager.zoomAbout(held.root.getWorldPosition(heldPos), zoom);
}

// ---- Simulation + validator ----
const machine = new Machine();
let circuit: Circuit = world.toCircuit();
let netlist: Netlist = buildNetlist(circuit);
let messages: ValidationMessage[] = [];
let circuitVersion = -1;

const codePanel = new CodePanel(document.getElementById('code')!, {
  boards: () => world.components.filter((c): c is Board => c instanceof Board).map((b) => ({ id: b.id, kind: b.def.kind })),
  runningSource: (b) => machine.sourceFor(b.id, b.kind),
  upload: (id, program) => machine.upload(id, program),
  serialLog: (id) => machine.serialLog(id),
  clearSerial: (id) => machine.clearLog(id),
  runtimeError: (id) => machine.runtimeError(id),
});

// ---- Sensor environment: hand / mouse position, microphone, keys ----
const mic = new Microphone();
const sensorPanel = new SensorPanel(document.getElementById('sensors')!, () => void mic.start());
let gasLevel = 0;
let lastSimTime = 0;
let sensorEnv = new Map<string, SensorEnv>();

/** Screen points of real things the IR / ultrasonic sensors can see. */
function sensorProbes(hands: TrackedHand[]): Array<{ px: number; py: number }> {
  if (status.input === 'mouse') return mouseInside ? [{ px: mouse.px, py: mouse.py }] : [];
  return hands.flatMap((h) => [landmarkToScreen(h, LM.MIDDLE_MCP), landmarkToScreen(h, LM.INDEX_TIP)]);
}

function updateEnvironment(hands: TrackedHand[], now: number): void {
  const dt = Math.min(0.1, (now - lastSimTime) / 1000);
  lastSimTime = now;
  const s = config.sensors;
  if (held.has('g')) gasLevel = Math.min(1, gasLevel + s.gasRisePerSec * dt);
  else if (gasLevel > sensorPanel.gas) gasLevel = Math.max(sensorPanel.gas, gasLevel - s.gasFallPerSec * dt);
  else gasLevel = sensorPanel.gas;
  if (held.has('g') || gasLevel !== sensorPanel.gas) sensorPanel.setGas(gasLevel);
  const sound = held.has('v') ? 1 : Math.max(sensorPanel.sound, mic.level());
  sensorEnv = senseEnvironment(sceneManager, world, sensorProbes(hands), sound, gasLevel);
}

function onControl(action: ControlAction): void {
  if (action === 'run') machine.start();
  else if (action === 'stop') machine.stop();
  else {
    machine.reset();
    interaction.update(null);
    world.clear();
    sceneManager.zoomTo(null);
  }
}

function updateSimulation(now: number): void {
  // Re-validate live whenever wiring or placement changes.
  if (world.version !== circuitVersion) {
    circuitVersion = world.version;
    circuit = world.toCircuit();
    netlist = buildNetlist(circuit);
    messages = validate(circuit, netlist);
    const loose = world.wires.filter((w) => !w.connected).length;
    if (loose > 0) {
      const text = loose === 1 ? 'A wire has a loose end (not connected).' : `${loose} wires have loose ends (not connected).`;
      messages = [{ level: 'warning', code: 'loose-wire', text }, ...messages];
    }
  }
  const out = machine.step(now, circuit, netlist, sensorEnv);
  const rows = [];
  for (const c of world.components) {
    if (c instanceof Led) c.setBrightness(out.leds.get(c.id) ?? 0);
    else if (c instanceof Board) c.setLeds(machine.running, out.builtin.get(c.id) ?? false);
    else if (c instanceof Sensor) {
      const st = out.sensors.get(c.id) ?? { powered: false, active: false };
      c.setState(st.powered, st.active);
      rows.push({ id: c.id, kind: c.def.kind, env: sensorEnv.get(c.id)!, powered: st.powered });
    }
  }
  sensorPanel.update(rows.filter((r) => r.env), mic.state);
  controls.setRunning(machine.running);

  // A wired-up sensor that isn't powered while running is the most common beginner mistake.
  const unpowered: ValidationMessage[] = machine.running
    ? rows
        .filter((r) => !r.powered && circuit.connections.some((k) => k.a.componentId === r.id || k.b.componentId === r.id))
        .map((r) => ({
          level: 'warning',
          code: 'sensor-power',
          text: `${SENSORS[r.kind].label} is not powered: connect VCC to 5V / 3V3 and GND to GND.`,
        }))
    : [];
  messagesPanel.update([...unpowered, ...messages], machine.running, world.components.some((c) => c.type === 'led'));
  codePanel.update(now);
}

function pinLabel(hit: PinHit): string {
  const c = hit.component;
  if (c instanceof Board) return `${c.def.label} · ${hit.pin}`;
  if (c.type === 'led') return hit.pin === 'anode' ? 'LED anode (+)' : 'LED cathode (−)';
  if (c.type === 'resistor') return `Resistor 220Ω · leg ${hit.pin}`;
  if (c instanceof Sensor) return `${c.def.label} · ${hit.pin}`;
  return `Breadboard · ${hit.pin}`;
}

/** True when we switched to mouse mode because of a camera failure (not by the user's M key). */
let autoMouse = false;

function cameraErrorText(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotReadableError' || name === 'AbortError') return 'in use by another app or tab (retrying…)';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no webcam found (retrying…)';
  if (name === 'NotAllowedError') return 'permission denied';
  return err instanceof Error ? err.message : String(err);
}

function startCamera(): void {
  startWebcam(video)
    .then(() => {
      status.camera = 'ok';
      status.cameraError = undefined;
      if (autoMouse) {
        autoMouse = false;
        setInput('hand');
      }
    })
    .catch((err: unknown) => {
      status.camera = 'error';
      status.cameraError = cameraErrorText(err);
      console.error('Webcam failed:', err);
      if (status.input !== 'mouse') {
        autoMouse = true;
        setInput('mouse');
      }
      // A busy or missing camera can come back; a denied permission needs the user, so don't re-prompt.
      const name = err instanceof DOMException ? err.name : '';
      if (name !== 'NotAllowedError' && name !== 'SecurityError') setTimeout(startCamera, config.camera.retryMs);
    });
}
startCamera();

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
  sceneManager.stepZoom();
  status.fps = fpsCounter.fps;

  // Only judge FPS once tracking is running, so model loading doesn't trigger the fallback.
  const everyN = tracker.ready ? rateController.update(fpsCounter.fps, now) : rateController.everyNFrames;
  status.trackingEveryNFrames = everyN;
  if (tracker.ready && status.camera === 'ok' && frameIndex % everyN === 0) {
    const detected = tracker.detect(video, now);
    if (detected) smoother.addSample(detected, now);
  }
  const hands = smoother.frame(everyN);
  status.handCount = hands.length;

  if (status.input === 'mouse') {
    interaction.update(mouseInside ? mouse : null);
    controls.updateFingertip(null);
    setDwell(null, now);
    lastGrips = [];
    lastScissors = null;
    interaction.scissors(null);
  } else {
    updateHandInput(hands, now);
  }

  updateEnvironment(hands, now);
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
    detachProgress: interaction.detachProgress,
    scissors: lastScissors && { open: lastScissors.open, aimed: !!interaction.cutWire },
  });

  skeleton.draw(status.input === 'hand' ? hands : [], lastGrips, lastScissors);
  sceneManager.render();
  statusPanel.update(status);
  frameIndex++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

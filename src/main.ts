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
import { SceneManager } from './scene/sceneManager';
import { Interaction, type Grip, type PointerState } from './scene/interaction';
import { handDepthZ, videoToScreen } from './scene/mapping';
import { World, type PinHit } from './scene/world';
import { Dock, FpsCounter, HintBar, MessagesPanel, StatusPanel, Tooltip, type StatusInfo } from './ui/panel';
import { CatalogSheet, SaveDialog, SavedSheet, partIcon } from './ui/menus';
import {
  AUTOSAVE_NAME, TEMPLATES, buildTemplate, deleteSave, listSaves, restore, serialize, storeSave,
} from './scene/circuits';
import { compile } from './sim/arduino/compiler';
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
if (import.meta.env.DEV) Object.assign(window, { __app: { world, sceneManager, interaction, controls, get machine() { return machine; }, get menus() { return { catalog, saved, saveDialog }; } } });

new Dock(document.getElementById('toolbar')!, partIcon, (action) => {
  if (action === 'zoom') toggleZoom();
  else if (action === 'code') codePanel.toggle();
  else if (action === 'save') void saveAs();
  else if (action === 'focus') setFocus(!document.body.classList.contains('focus-mode'));
  else openMenu(action);
});

// ---- Focus mode: black backdrop instead of the camera image (tracking keeps running) ----
const FOCUS_KEY = 'aircircuit.focus';
function setFocus(on: boolean): void {
  document.body.classList.toggle('focus-mode', on);
  skeleton.glow = on;
  try {
    localStorage.setItem(FOCUS_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: just not remembered */
  }
}

// ---- Menus (4 fingers = parts catalog, 3 fingers = saved circuits) and saving ----
const catalog = new CatalogSheet(document.getElementById('catalog')!, (kind) => {
  world.spawn(kind);
  toast('Added · make a fist over it to move it');
});
const saved = new SavedSheet(document.getElementById('saved')!, {
  templates: TEMPLATES,
  list: listSaves,
  loadTemplate: (t) => void replaceScene(() => [buildTemplate(world, t)], t.title, `Loaded "${t.title}" · ${t.tryIt}`),
  loadSave: (s) => void replaceScene(() => restore(world, s), s.name === AUTOSAVE_NAME ? '' : s.name, `Opened "${s.name}"`),
  deleteSave: (name) => deleteSave(name),
  saveNow: () => void saveAs(),
});
const saveDialog = new SaveDialog(document.getElementById('dialog')!);

function openMenu(which: 'catalog' | 'circuits' | null): void {
  if (saveDialog.open) return;
  const wantCatalog = which === 'catalog' && !catalog.open;
  const wantSaved = which === 'circuits' && !saved.open;
  catalog.toggle(wantCatalog);
  saved.toggle(wantSaved);
}

const overlayOpen = () => catalog.open || saved.open || saveDialog.open;

const toastEl = document.getElementById('toast')!;
let toastTimer = 0;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 4000);
}

/** Name of the circuit on screen (from the last save / load), and the world version at that point. */
let circuitName = '';
let savedVersion = 0;
const unsaved = () => world.components.length > 0 && world.version !== savedVersion;

function defaultName(): string {
  if (circuitName) return circuitName;
  const d = new Date();
  return `Circuit ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function saveCurrent(name: string): void {
  const ok = storeSave(serialize(world, name, (b) => machine.uploadedSource(b.id)));
  if (ok) {
    circuitName = name;
    savedVersion = world.version;
  }
  toast(ok ? `Saved "${name}" · open it from Saved circuits (3 fingers)` : 'Could not save: browser storage is full or blocked.');
}

async function saveAs(): Promise<void> {
  if (!world.components.length) {
    toast('Nothing to save yet: add parts from the catalog first.');
    return;
  }
  const c = await saveDialog.ask('Save circuit', defaultName(), false);
  if (c?.save) saveCurrent(c.name);
}

/** Before the scene is replaced: offer to save unsaved work. False when the user cancels. */
async function confirmLeave(title: string): Promise<boolean> {
  if (!unsaved()) return true;
  const c = await saveDialog.ask(title, defaultName());
  if (!c) return false;
  if (c.save) saveCurrent(c.name);
  return true;
}

function clearScene(): void {
  machine.reset();
  interaction.update(null);
  world.clear();
  sceneManager.zoomTo(null);
}

/** Load a template / save: clears the scene, builds it, stores (doesn't run) the boards' sketches. */
async function replaceScene(build: () => Array<{ boardId: string; source: string }>, name: string, message: string): Promise<void> {
  if (!(await confirmLeave('Save the current circuit before opening another?'))) return;
  clearScene();
  for (const s of build()) {
    const b = world.get(s.boardId);
    const r = b instanceof Board ? compile(s.source, b.def.kind) : null;
    if (r?.ok) machine.upload(s.boardId, r.program, false);
  }
  circuitName = name;
  savedVersion = world.version;
  toast(message);
}

// Closing the tab can't show a dialog with a name box, so the work is autosaved instead.
window.addEventListener('beforeunload', () => {
  if (unsaved()) storeSave(serialize(world, AUTOSAVE_NAME, (b) => machine.uploadedSource(b.id)));
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
  if (saveDialog.open) return;
  if (e.key === 'Escape') openMenu(null);
  if (e.key === 'p' || e.key === 'P') openMenu('catalog');
  if (e.key === 'l' || e.key === 'L') openMenu('circuits');
  if (e.key === 's' || e.key === 'S') void saveAs();
  if (e.key === 'b' || e.key === 'B') setFocus(!document.body.classList.contains('focus-mode'));
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
try {
  setFocus(localStorage.getItem(FOCUS_KEY) === '1');
} catch {
  /* storage unavailable */
}
let lastGrips: Array<Grip | null> = [];
let lastScissors: HandFrame['scissors'] = null;
let lastMenu: { pose: 'three' | 'four'; progress: number } | null = null;

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
  // With a menu open only its cards can be pressed; the scene underneath is paused.
  const overlay = overlayOpen();
  setDwell(button?.closest(overlay ? '#catalog, #saved, #dialog' : '#toolbar, #code, #sensors') ? button : null, now);
  if (frame.menu.fired && !interaction.busy) openMenu(frame.menu.fired === 'four' ? 'catalog' : 'circuits');
  lastMenu = frame.menu.holding && !interaction.busy ? { pose: frame.menu.holding, progress: frame.menu.progress } : null;
  if (overlay) {
    interaction.update(null);
    controls.updateFingertip(null);
    interaction.scissors(null);
    lastScissors = null;
    return;
  }

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
  updateHeldScale(frame.depth);
}

/** Fist push toward the camera enlarges the held part, pulling back shrinks it (only that part). */
function updateHeldScale(depth: number | null): void {
  if (depth === null || !interaction.grabbed) return;
  const { gain, min, max } = config.interaction.heldScale;
  interaction.scaleGrabbed(Math.min(max, Math.max(min, depth ** gain)));
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
  else void resetScene();
}

async function resetScene(): Promise<void> {
  if (!(await confirmLeave('Save the circuit before resetting?'))) return;
  clearScene();
  circuitName = '';
  savedVersion = world.version;
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
    interaction.update(mouseInside && !overlayOpen() ? mouse : null);
    lastMenu = null;
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
    menu: lastMenu,
    overlay: overlayOpen(),
  });

  skeleton.draw(status.input === 'hand' ? hands : [], lastGrips, lastScissors);
  sceneManager.render();
  statusPanel.update(status);
  frameIndex++;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

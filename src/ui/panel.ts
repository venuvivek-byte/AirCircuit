import { config } from '../config';
import type { ValidationMessage } from '../sim/validator';

/** Rolling-average FPS counter. */
export class FpsCounter {
  private frames = 0;
  private windowStart = performance.now();
  fps = 0;

  tick(now: number): void {
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed >= config.fps.sampleWindowMs) {
      this.fps = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.windowStart = now;
    }
  }
}

export type DockAction = 'catalog' | 'circuits' | 'save' | 'code' | 'zoom' | 'focus';

const DOCK: Array<[DockAction, string, string]> = [
  ['catalog', 'Parts', '✋ 4 · P'],
  ['circuits', 'Circuits', '🤟 3 · L'],
  ['save', 'Save', 'S'],
  ['code', 'Code', 'C'],
  ['zoom', 'Zoom', 'Z'],
  ['focus', 'Focus', 'B'],
];

/** Left dock: menus and tools. Buttons carry `data-action` so hand "clicks" can find them by hit-testing. */
export class Dock {
  constructor(el: HTMLElement, icon: (a: DockAction) => string, onAction: (a: DockAction) => void) {
    el.innerHTML = '<div class="brand"><span class="brand-dot"></span>AirCircuit</div>';
    for (const [action, label, key] of DOCK) {
      const b = document.createElement('button');
      b.innerHTML = `${icon(action)}<span class="dock-label">${label}</span><kbd>${key}</kbd>`;
      b.dataset.action = action;
      b.dataset.dwellMs = String(config.interaction.dwellZoomMs);
      b.addEventListener('click', () => onAction(action));
      el.appendChild(b);
    }
  }
}

/** Small floating label that follows the hovered pin. */
export class Tooltip {
  constructor(private el: HTMLElement) {}

  show(text: string, px: number, py: number): void {
    this.el.textContent = text;
    this.el.style.transform = `translate(${px + 14}px, ${py - 28}px)`;
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}

/** Validator messages, shown under the status panel. */
export class MessagesPanel {
  private lastHtml = '';

  constructor(private el: HTMLElement) {}

  update(messages: ValidationMessage[], running: boolean, hasLed: boolean): void {
    const items = messages.map((m) => `<div class="msg ${m.level}">${escapeHtml(m.text)}</div>`);
    if (items.length === 0) {
      items.push(
        `<div class="hint">${
          hasLed
            ? 'Wire: blink pin (D13 / GPIO2) → resistor → LED anode (+), cathode → GND.'
            : 'Open the Parts catalog (✋ 4 fingers) or load a working template from Saved circuits (🤟 3 fingers).'
        }</div>`,
      );
    }
    const html = `<h3>Circuit check <span class="pill ${running ? 'on' : ''}">${running ? '● RUNNING' : 'stopped'}</span></h3>${items.join('')}`;
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export interface HintState {
  input: 'hand' | 'mouse';
  camera: StatusInfo['camera'];
  tracker: StatusInfo['tracker'];
  handCount: number;
  componentCount: number;
  action: 'idle' | 'grab' | 'wire' | 'holdWire';
  /** 0..1 while a held wire counts down to unplugging an end, else null. */
  detachProgress: number | null;
  /** Hand in the scissor pose: fingers spread, and whether a wire is targeted. */
  scissors: { open: boolean; aimed: boolean } | null;
  /** A menu pose being held: which, and 0..1 until it opens. */
  menu: { pose: 'three' | 'four'; progress: number } | null;
  /** A menu or dialog covers the scene. */
  overlay: boolean;
}

/** One-line contextual onboarding hint at the bottom of the screen. */
export class HintBar {
  private last = '';

  constructor(private el: HTMLElement) {}

  update(s: HintState): void {
    const [text, warn] = hintFor(s);
    const key = `${warn}|${text}`;
    if (key === this.last) return;
    this.last = key;
    this.el.textContent = text;
    this.el.classList.toggle('warn', warn);
  }
}

function hintFor(s: HintState): [string, boolean] {
  if (s.input === 'mouse') {
    if (s.camera === 'error') {
      return ['Camera unavailable (close other apps/tabs using it; retrying). Mouse mode: drag parts, drag pin→pin to wire, Enter runs.', true];
    }
    if (s.action === 'wire') return ['Release on a pin to plug in · release elsewhere to leave the end loose · trash deletes.', false];
    if (s.action === 'holdWire') return [detachHint(s.detachProgress, 'drag to the trash to delete'), false];
    if (s.action === 'grab') return ['Drop near the breadboard to plug in · wheel / R rotates · drop on the trash to delete.', false];
    if (s.componentCount === 0) return ['Mouse mode: P opens the Parts catalog, L the Saved circuits (working templates).', false];
    return ['Drag parts · drag pin→pin to wire · R / wheel rotate · Delete removes · P parts · L circuits · S save · C code · B focus · Enter run · M hands', false];
  }
  if (s.camera === 'starting') return ['Waiting for camera permission…', false];
  if (s.camera === 'error') return ['Camera blocked or missing. Allow camera access and reload, or press M for mouse mode.', true];
  if (s.tracker === 'loading') return ['Loading hand tracking model…', false];
  if (s.tracker === 'error') return ['Hand tracking failed to load. Press M to use mouse mode.', true];
  if (s.handCount === 0) return ['Show your hand to the camera (about 50 cm away, good light).', false];
  if (s.menu) {
    const name = s.menu.pose === 'four' ? 'Parts catalog' : 'Saved circuits';
    return [`${s.menu.pose === 'four' ? '✋' : '🤟'} Hold the pose… opening ${name} ${'●'.repeat(Math.round(s.menu.progress * 5))}${'○'.repeat(5 - Math.round(s.menu.progress * 5))}`, false];
  }
  if (s.overlay) return ['Hold your index fingertip on a card to choose it · ✕ or the same pose again closes.', false];
  if (s.scissors) {
    if (!s.scissors.aimed) return ['✌ Scissors: move the point between your two fingertips onto a wire (it turns red).', false];
    return [s.scissors.open ? '✂ Close your two fingers to cut the red wire.' : '✌ Spread your two fingers, then close them to cut the red wire.', false];
  }
  if (s.action === 'wire') return ['Move until the yellow ring sits on the target pin and open your fingers to plug in · open in the air to leave the end loose · trash deletes.', false];
  if (s.action === 'grab') return ['Move your fist to carry · roll wrist to rotate · push toward / pull back from the camera to enlarge / shrink it · open hand to drop (snaps into breadboard) · trash deletes.', false];
  if (s.action === 'holdWire') return [detachHint(s.detachProgress, 'drop it on the trash to delete'), false];
  if (s.componentCount === 0) return ['✋ 4 fingers (thumb folded) = Parts catalog · 🤟 3 fingers = Saved circuits & templates.', false];
  return ['FIST over a part to grab · PINCH a pin to wire · ✌ snip a wire to cut · ✋ 4 fingers = parts · 🤟 3 = circuits · push a 3D button to Run.', false];
}

function detachHint(progress: number | null, trash: string): string {
  if (progress === null) return `Holding the wire: ${trash}, or let go to keep it.`;
  const left = (config.interaction.wireDetachMs * (1 - progress)) / 1000;
  return `Hold still ${left.toFixed(1)} s to unplug the nearest end (yellow ring) · or ${trash}.`;
}

export interface StatusInfo {
  input: 'hand' | 'mouse';
  fps: number;
  camera: 'starting' | 'ok' | 'error';
  cameraError?: string;
  tracker: 'loading' | 'ok' | 'error';
  trackerDelegate?: string;
  handCount: number;
  trackingEveryNFrames: number;
}

/** Status chips (input, camera, tracking, FPS). */
export class StatusPanel {
  private lastHtml = '';

  constructor(private el: HTMLElement) {}

  update(info: StatusInfo): void {
    const chip = (text: string, cls = '') => `<span class="chip ${cls}">${text}</span>`;
    const cam =
      info.camera === 'error' ? chip(`Camera: ${info.cameraError ?? 'unavailable'}`, 'err')
      : chip(info.camera === 'ok' ? 'Camera' : 'Camera…', info.camera === 'ok' ? 'ok' : '');
    const tracker =
      info.tracker === 'error' ? chip('Tracking failed', 'err')
      : chip(info.tracker === 'ok' ? `Tracking${info.trackerDelegate ? ` · ${info.trackerDelegate}` : ''}` : 'Loading model…', info.tracker === 'ok' ? 'ok' : '');
    const input = chip(info.input === 'mouse' ? '🖱 Mouse · M' : `✋ Hands ${info.handCount} · M`, 'input');
    const rate = info.trackingEveryNFrames === 1 ? '' : ` · 1/${info.trackingEveryNFrames}`;
    const html = [input, cam, tracker, chip(`${info.fps.toFixed(0)} fps${rate}`)].join('');
    // Avoid touching the DOM every frame when nothing changed.
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}

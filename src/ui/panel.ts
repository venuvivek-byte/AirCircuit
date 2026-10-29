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

export type ToolAction = 'arduino-uno' | 'esp32' | 'breadboard' | 'led' | 'resistor';

const TOOLS: Array<[ToolAction, string]> = [
  ['arduino-uno', 'Arduino Uno'],
  ['esp32', 'ESP32'],
  ['breadboard', 'Breadboard'],
  ['led', 'LED'],
  ['resistor', 'Resistor 220Ω'],
];

/** Left toolbar of spawn buttons. Buttons carry `data-action` so hand "clicks" can find them by hit-testing. */
export class Toolbar {
  constructor(el: HTMLElement, onAction: (a: ToolAction) => void) {
    for (const [action, label] of TOOLS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.action = action;
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
            : 'Spawn a board, breadboard, resistor and LED from the left toolbar.'
        }</div>`,
      );
    }
    const html = `<h3>Circuit check · ${running ? 'RUNNING' : 'stopped'}</h3>${items.join('')}`;
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
    if (s.action === 'wire') return ['Release on another pin to connect the wire.', false];
    if (s.action === 'grab') return ['Drop near the breadboard to plug in · wheel / R rotates · drop on the trash to delete.', false];
    if (s.componentCount === 0) return ['Mouse mode: click a part on the left to spawn it.', false];
    return ['Drag parts · drag pin→pin to wire · R / wheel rotate · Delete removes · Enter run · Space stop · M hands', false];
  }
  if (s.camera === 'starting') return ['Waiting for camera permission…', false];
  if (s.camera === 'error') return ['Camera blocked or missing. Allow camera access and reload, or press M for mouse mode.', true];
  if (s.tracker === 'loading') return ['Loading hand tracking model…', false];
  if (s.tracker === 'error') return ['Hand tracking failed to load. Press M to use mouse mode.', true];
  if (s.handCount === 0) return ['Show your hand to the camera (about 50 cm away, good light).', false];
  if (s.action === 'wire') return ['Keep pinching and move to another pin, then open your fingers to connect.', false];
  if (s.action === 'grab') return ['Move your fist to carry · roll your wrist to rotate · open your hand to drop (snaps into breadboard) · drop on the trash to delete.', false];
  if (s.action === 'holdWire') return ['Drop the wire on the trash to delete it, or open fingers to keep it.', false];
  if (s.componentCount === 0) return ['Hold your index fingertip on a part in the left toolbar for 5 s to spawn it.', false];
  return ['Palm over a part + make a FIST to grab · roll wrist to rotate · PINCH a pin to wire · fingertip on toolbar 5 s spawns · push a 3D button to Run.', false];
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

/** Right-hand status panel (tracking state, FPS). Validator messages are added in milestone 7. */
export class StatusPanel {
  private lastHtml = '';

  constructor(private el: HTMLElement) {}

  update(info: StatusInfo): void {
    const cam =
      info.camera === 'error'
        ? `<span class="err">Camera: ${info.cameraError ?? 'unavailable'}</span>`
        : `Camera: ${info.camera}`;
    const tracker =
      info.tracker === 'error'
        ? `<span class="err">Hand tracking: failed</span>`
        : `Hand tracking: ${info.tracker}${info.trackerDelegate ? ` (${info.trackerDelegate})` : ''}`;
    const mode =
      info.trackingEveryNFrames === 1 ? 'every frame' : `every ${info.trackingEveryNFrames} frames (interpolated)`;
    const input = info.input === 'mouse' ? 'Input: mouse (press M for hands)' : 'Input: hands (press M for mouse)';
    const html = [input, cam, tracker, `Hands: ${info.handCount}`, `Tracking: ${mode}`, `FPS: ${info.fps.toFixed(0)}`].join('<br>');
    // Avoid touching the DOM every frame when nothing changed.
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}

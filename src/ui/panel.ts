import { config } from '../config';

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

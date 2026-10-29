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

export interface StatusInfo {
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
    const html = [cam, tracker, `Hands: ${info.handCount}`, `Tracking: ${mode}`, `FPS: ${info.fps.toFixed(0)}`].join('<br>');
    // Avoid touching the DOM every frame when nothing changed.
    if (html !== this.lastHtml) {
      this.el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}

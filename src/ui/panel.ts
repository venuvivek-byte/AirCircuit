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
}

/** Right-hand status panel (tracking state, FPS). Validator messages are added in milestone 7. */
export class StatusPanel {
  constructor(private el: HTMLElement) {}

  update(info: StatusInfo): void {
    const cam =
      info.camera === 'error'
        ? `<span class="err">Camera: ${info.cameraError ?? 'unavailable'}</span>`
        : `Camera: ${info.camera}`;
    this.el.innerHTML = `${cam}<br>FPS: ${info.fps.toFixed(0)}`;
  }
}

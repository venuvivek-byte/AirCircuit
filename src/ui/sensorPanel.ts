import type { SensorEnv, SensorKind } from '../components/sensors';
import { SENSORS } from '../components/sensors';

export interface SensorRow {
  id: string;
  kind: SensorKind;
  env: SensorEnv;
  powered: boolean;
}

/**
 * Live sensor readings plus the environment controls the hand can't provide: microphone toggle,
 * sound / gas sliders (keys: hold V = loud noise, hold G = gas leak).
 */
export class SensorPanel {
  private list: HTMLElement;
  private micBtn: HTMLButtonElement;
  private soundIn: HTMLInputElement;
  private gasIn: HTMLInputElement;
  private lastHtml = '';
  /** Slider values 0..1. */
  sound = 0;
  gas = 0;

  constructor(
    private el: HTMLElement,
    onMic: () => void,
  ) {
    el.innerHTML = `
      <h3>Sensors</h3>
      <div class="sens-list"></div>
      <div class="sens-ctl"><button class="sens-mic">🎤 Use microphone</button></div>
      <label class="sens-ctl">Sound <input class="sens-sound" type="range" min="0" max="100" value="0"></label>
      <label class="sens-ctl">Gas <input class="sens-gas" type="range" min="0" max="100" value="0"></label>
      <div class="hint">Hand in front of IR / ultrasonic · hold <b>V</b> = noise · hold <b>G</b> = gas leak</div>`;
    this.list = el.querySelector('.sens-list')!;
    this.micBtn = el.querySelector('.sens-mic')!;
    this.soundIn = el.querySelector('.sens-sound')!;
    this.gasIn = el.querySelector('.sens-gas')!;
    this.micBtn.addEventListener('click', onMic);
    this.soundIn.addEventListener('input', () => (this.sound = Number(this.soundIn.value) / 100));
    this.gasIn.addEventListener('input', () => (this.gas = Number(this.gasIn.value) / 100));
  }

  /** Reflect a key-driven gas level on the slider. */
  setGas(g: number): void {
    this.gas = g;
    this.gasIn.value = String(Math.round(g * 100));
  }

  update(rows: SensorRow[], mic: 'off' | 'starting' | 'on' | 'denied'): void {
    this.el.style.display = rows.length ? '' : 'none';
    if (!rows.length) return;
    const lines = rows.map((r) => {
      const name = `${SENSORS[r.kind].label.split(' (')[0]} #${r.id.split('-').pop()}`;
      if (!r.powered) return `<div class="sens-row off">${name}: <i>not powered</i></div>`;
      const e = r.env;
      const value =
        r.kind === 'ir' ? (e.obstacle ? '✋ obstacle' : 'clear')
        : r.kind === 'ultrasonic' ? (e.distanceCm === null ? 'out of range' : `${e.distanceCm.toFixed(0)} cm`)
        : r.kind === 'sound' ? bar(e.sound)
        : bar(e.gas);
      return `<div class="sens-row">${name}: ${value}</div>`;
    });
    const html = lines.join('');
    if (html !== this.lastHtml) {
      this.list.innerHTML = html;
      this.lastHtml = html;
    }
    const label = mic === 'on' ? '🎤 Microphone on' : mic === 'starting' ? '🎤 Starting…' : mic === 'denied' ? '🎤 Mic blocked' : '🎤 Use microphone';
    if (this.micBtn.textContent !== label) this.micBtn.textContent = label;
  }
}

function bar(v: number): string {
  const n = Math.round(v * 10);
  return `<span class="sens-bar">${'▮'.repeat(n)}${'▯'.repeat(10 - n)}</span> ${Math.round(v * 100)}%`;
}

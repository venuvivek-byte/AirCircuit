import { config } from '../config';
import type { SavedCircuit, Template } from '../scene/circuits';
import type { SpawnKind } from '../scene/world';

// Full-screen menus opened by finger-count poses (4 = parts catalog, 3 = saved circuits) and the
// save prompt. Every control is a <button>, so hand mode presses them by fingertip dwell.

/** Small drawings of each part for the catalog cards. */
export function partIcon(kind: SpawnKind | 'code' | 'zoom' | 'save' | 'catalog' | 'circuits' | 'focus'): string {
  const svg = (body: string) => `<svg viewBox="0 0 64 44" aria-hidden="true">${body}</svg>`;
  const pins = (x0: number, y: number, n: number, dx = 5) =>
    Array.from({ length: n }, (_, i) => `<rect x="${x0 + i * dx}" y="${y}" width="3" height="4" fill="#d9c27a"/>`).join('');
  switch (kind) {
    case 'arduino-uno':
      return svg(`<rect x="6" y="6" width="52" height="32" rx="3" fill="#00878f"/>${pins(10, 8, 9)}${pins(26, 32, 6)}
        <rect x="24" y="17" width="18" height="9" rx="1" fill="#1d2a2c"/><rect x="2" y="13" width="9" height="10" fill="#b8bcc2"/>`);
    case 'esp32':
      return svg(`<rect x="18" y="3" width="28" height="38" rx="3" fill="#24272c"/>${Array.from({ length: 6 }, (_, i) =>
        `<rect x="19" y="${7 + i * 5.5}" width="4" height="3" fill="#d9c27a"/><rect x="41" y="${7 + i * 5.5}" width="4" height="3" fill="#d9c27a"/>`).join('')}
        <rect x="25" y="8" width="14" height="12" rx="1" fill="#8b9097"/><rect x="27" y="10" width="10" height="8" fill="#5c6168"/>`);
    case 'breadboard':
      return svg(`<rect x="3" y="6" width="58" height="32" rx="3" fill="#f2f2ee"/><rect x="3" y="21" width="58" height="2" fill="#d5d5cc"/>
        ${Array.from({ length: 4 }, (_, r) => Array.from({ length: 10 }, (_, c) =>
          `<rect x="${8 + c * 5}" y="${[10, 15, 26, 31][r]}" width="2.2" height="2.2" fill="#555"/>`).join('')).join('')}
        <rect x="5" y="7.5" width="54" height="0.8" fill="#e04848"/><rect x="5" y="36" width="54" height="0.8" fill="#4870e0"/>`);
    case 'led':
      return svg(`<rect x="28" y="24" width="1.6" height="16" fill="#bbb"/><rect x="34" y="24" width="1.6" height="13" fill="#bbb"/>
        <path d="M24 26 V14 a8 8 0 0 1 16 0 V26 Z" fill="#e23b3b"/><rect x="22" y="24" width="20" height="3" rx="1" fill="#c22d2d"/>
        <circle cx="29" cy="12" r="2.5" fill="#ff9d9d"/>`);
    case 'resistor':
      return svg(`<rect x="4" y="21" width="56" height="2" fill="#bbb"/><rect x="18" y="15" width="28" height="14" rx="6" fill="#d8c08a"/>
        <rect x="23" y="15" width="3" height="14" fill="#c0392b"/><rect x="29" y="15" width="3" height="14" fill="#c0392b"/>
        <rect x="35" y="15" width="3" height="14" fill="#6b3b1f"/><rect x="40" y="15" width="2" height="14" fill="#d4af37"/>`);
    case 'ir':
      return svg(`<rect x="14" y="6" width="36" height="34" rx="2" fill="#1f4fa8"/><circle cx="26" cy="13" r="4" fill="#eef"/>
        <circle cx="38" cy="13" r="4" fill="#222"/><rect x="28" y="24" width="8" height="8" rx="4" fill="#3b6ad0" stroke="#9db8ff"/>${pins(24, 36, 3, 7)}`);
    case 'ultrasonic':
      return svg(`<rect x="3" y="10" width="58" height="26" rx="2" fill="#1f6fb0"/><circle cx="18" cy="22" r="9" fill="#c8c8c8"/>
        <circle cx="18" cy="22" r="6.5" fill="#333"/><circle cx="46" cy="22" r="9" fill="#c8c8c8"/><circle cx="46" cy="22" r="6.5" fill="#333"/>${pins(23, 34, 4, 5)}`);
    case 'sound':
      return svg(`<rect x="14" y="6" width="36" height="34" rx="2" fill="#b02a2a"/><circle cx="32" cy="16" r="7" fill="#c8c8c8"/>
        <circle cx="32" cy="16" r="4.5" fill="#333"/><rect x="24" y="26" width="16" height="6" fill="#2f5fd0"/>${pins(23, 36, 4, 5)}`);
    case 'gas':
      return svg(`<rect x="14" y="6" width="36" height="34" rx="2" fill="#2a7a3a"/><circle cx="32" cy="19" r="10" fill="#b0b0b0"/>
        <circle cx="32" cy="19" r="7" fill="#d08030"/><path d="M27 19h10M32 14v10" stroke="#8a5420" stroke-width="1"/>${pins(23, 36, 4, 5)}`);
    case 'code':
      return svg(`<path d="M24 12 L12 22 L24 32 M40 12 L52 22 L40 32" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    case 'zoom':
      return svg(`<circle cx="28" cy="20" r="11" stroke="currentColor" stroke-width="4" fill="none"/><path d="M36 28 L46 38" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`);
    case 'save':
      return svg(`<path d="M16 6 H42 L50 14 V38 H16 Z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><rect x="22" y="8" width="16" height="9" fill="currentColor"/><rect x="22" y="25" width="22" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="3"/>`);
    case 'focus':
      return svg(`<circle cx="32" cy="22" r="14" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M32 8 A14 14 0 0 1 32 36 Z" fill="currentColor"/>`);
    case 'catalog':
      return svg(`${[0, 1].map((r) => [0, 1].map((c) => `<rect x="${17 + c * 16}" y="${6 + r * 16}" width="13" height="13" rx="3" fill="currentColor"/>`).join('')).join('')}`);
    case 'circuits':
      return svg(`<path d="M12 22 H24 M40 22 H52 M32 8 V14 M32 30 V36" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><rect x="24" y="14" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="12" cy="22" r="3" fill="currentColor"/><circle cx="52" cy="22" r="3" fill="currentColor"/>`);
  }
}

export interface CatalogItem {
  kind: SpawnKind;
  title: string;
  sub: string;
  group: 'Boards' | 'Prototyping' | 'Sensors';
}

export const CATALOG: CatalogItem[] = [
  { kind: 'arduino-uno', title: 'Arduino Uno', sub: 'ATmega328P · 5 V · D2–D13, A0–A5', group: 'Boards' },
  { kind: 'esp32', title: 'ESP32 DevKit', sub: 'Dual core · 3.3 V · 12-bit ADC', group: 'Boards' },
  { kind: 'breadboard', title: 'Breadboard', sub: '20 columns · power rails', group: 'Prototyping' },
  { kind: 'led', title: 'LED (red)', sub: 'Long leg = anode (+)', group: 'Prototyping' },
  { kind: 'resistor', title: 'Resistor 220 Ω', sub: 'Current limit for LEDs', group: 'Prototyping' },
  { kind: 'ir', title: 'IR obstacle', sub: 'FC-51 · OUT LOW when near', group: 'Sensors' },
  { kind: 'ultrasonic', title: 'Ultrasonic', sub: 'HC-SR04 · 2–200 cm', group: 'Sensors' },
  { kind: 'sound', title: 'Sound', sub: 'KY-038 · analog + digital', group: 'Sensors' },
  { kind: 'gas', title: 'Gas', sub: 'MQ-2 · smoke / LPG', group: 'Sensors' },
];

const MENU_DWELL_MS = () => String(config.interaction.dwellZoomMs);

/** Base for the centred menu sheets: open/close, Esc, close button. */
abstract class Sheet {
  protected body: HTMLElement;

  constructor(
    protected el: HTMLElement,
    title: string,
    gesture: string,
  ) {
    el.innerHTML = `
      <div class="sheet">
        <header><div><h2>${title}</h2><p class="sheet-gesture">${gesture}</p></div><button class="sheet-close" title="Close (Esc)">✕</button></header>
        <div class="sheet-body"></div>
      </div>`;
    this.body = el.querySelector('.sheet-body')!;
    const close = el.querySelector('.sheet-close') as HTMLElement;
    close.dataset.dwellMs = MENU_DWELL_MS();
    close.addEventListener('click', () => this.toggle(false));
  }

  get open(): boolean {
    return this.el.classList.contains('open');
  }

  toggle(open = !this.open): void {
    if (open) this.render();
    this.el.classList.toggle('open', open);
  }

  protected abstract render(): void;

  protected card(cls: string, html: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = html;
    b.dataset.dwellMs = MENU_DWELL_MS();
    b.addEventListener('click', onClick);
    return b;
  }
}

/** Every board, part and sensor; picking one spawns it. */
export class CatalogSheet extends Sheet {
  constructor(
    el: HTMLElement,
    private onPick: (kind: SpawnKind) => void,
  ) {
    super(el, 'Parts catalog', '✋ Show 4 fingers (thumb folded) to open · fingertip on a card to add it');
  }

  protected render(): void {
    if (this.body.childElementCount) return;
    for (const group of ['Boards', 'Prototyping', 'Sensors'] as const) {
      const h = document.createElement('h3');
      h.textContent = group;
      const grid = document.createElement('div');
      grid.className = 'cards';
      for (const it of CATALOG.filter((c) => c.group === group)) {
        grid.appendChild(
          this.card('card', `<span class="card-art">${partIcon(it.kind)}</span><b>${it.title}</b><small>${it.sub}</small>`, () => {
            this.onPick(it.kind);
            this.toggle(false);
          }),
        );
      }
      this.body.append(h, grid);
    }
  }
}

interface SavedHooks {
  templates: Template[];
  list(): SavedCircuit[];
  loadTemplate(t: Template): void;
  loadSave(s: SavedCircuit): void;
  deleteSave(name: string): void;
  saveNow(): void;
}

/** Working templates plus the user's own saved circuits. */
export class SavedSheet extends Sheet {
  constructor(
    el: HTMLElement,
    private hooks: SavedHooks,
  ) {
    super(el, 'Saved circuits', '🤟 Show 3 fingers (index, middle, ring) to open · fingertip on a card to load it');
  }

  protected render(): void {
    this.body.innerHTML = '';
    const h1 = document.createElement('h3');
    h1.textContent = 'Working templates';
    const tgrid = document.createElement('div');
    tgrid.className = 'cards';
    for (const t of this.hooks.templates) {
      const icon = t.parts.find((p) => p.kind !== 'led' && p.kind !== 'resistor')?.kind ?? 'led';
      tgrid.appendChild(
        this.card('card template', `<span class="card-art">${partIcon(icon)}</span><b>${t.title}</b><small>${t.blurb}</small>`, () => {
          this.toggle(false);
          this.hooks.loadTemplate(t);
        }),
      );
    }

    const h2 = document.createElement('h3');
    h2.innerHTML = 'My circuits <span class="muted">· stored in this browser</span>';
    const sgrid = document.createElement('div');
    sgrid.className = 'cards saves';
    sgrid.appendChild(
      this.card('card new-save', `<span class="card-art">${partIcon('save')}</span><b>Save current circuit</b><small>Name it and keep it here</small>`, () => {
        this.toggle(false);
        this.hooks.saveNow();
      }),
    );
    for (const s of this.hooks.list()) {
      const wrap = document.createElement('div');
      wrap.className = 'save-item';
      const when = new Date(s.savedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      wrap.appendChild(
        this.card('card', `<span class="card-art">${partIcon('circuits')}</span><b>${escapeHtml(s.name)}</b><small>${s.parts.length} parts · ${s.wires.length} wires · ${when}</small>`, () => {
          this.toggle(false);
          this.hooks.loadSave(s);
        }),
      );
      const del = this.card('save-del', '🗑', () => {
        this.hooks.deleteSave(s.name);
        this.render();
      });
      del.title = 'Delete this save';
      wrap.appendChild(del);
      sgrid.appendChild(wrap);
    }
    this.body.append(h1, tgrid, h2, sgrid);
  }
}

export type SaveChoice = { save: true; name: string } | { save: false } | null;

/** Modal "save before …?" prompt with a file name; resolves null on cancel. */
export class SaveDialog {
  private resolve: ((c: SaveChoice) => void) | null = null;
  private input: HTMLInputElement;
  private titleEl: HTMLElement;
  private noBtn: HTMLButtonElement;

  constructor(private el: HTMLElement) {
    el.innerHTML = `
      <div class="dialog">
        <h2></h2>
        <label>File name<input type="text" maxlength="60" spellcheck="false"></label>
        <p class="muted">Saved in this browser. Open it later from <b>Saved circuits</b> (🤟 3 fingers).</p>
        <div class="dialog-actions">
          <button class="primary" data-act="save">💾 Save</button>
          <button data-act="no">Don't save</button>
          <button data-act="cancel">Cancel</button>
        </div>
      </div>`;
    this.input = el.querySelector('input')!;
    this.titleEl = el.querySelector('h2')!;
    this.noBtn = el.querySelector('[data-act=no]')!;
    for (const b of el.querySelectorAll<HTMLButtonElement>('button')) {
      b.dataset.dwellMs = MENU_DWELL_MS();
      b.addEventListener('click', () => this.finish(b.dataset.act!));
    }
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.finish('save');
      if (e.key === 'Escape') this.finish('cancel');
    });
  }

  get open(): boolean {
    return this.el.classList.contains('open');
  }

  /** `allowDiscard` false = plain "save as" (no "Don't save" button). */
  ask(title: string, defaultName: string, allowDiscard = true): Promise<SaveChoice> {
    this.finish('cancel');
    this.titleEl.textContent = title;
    this.input.value = defaultName;
    this.noBtn.style.display = allowDiscard ? '' : 'none';
    this.el.classList.add('open');
    // Select the name so typing replaces it; hand users can just dwell on Save.
    setTimeout(() => this.input.select(), 0);
    return new Promise((r) => (this.resolve = r));
  }

  private finish(act: string): void {
    const r = this.resolve;
    if (!r) return;
    if (act === 'save' && !this.input.value.trim()) {
      this.input.focus();
      return;
    }
    this.resolve = null;
    this.el.classList.remove('open');
    this.input.blur();
    r(act === 'save' ? { save: true, name: this.input.value.trim() } : act === 'no' ? { save: false } : null);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

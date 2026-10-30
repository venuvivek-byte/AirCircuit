import { BOARDS, type BoardKind } from '../components/boards';
import { compile, type CompileError, type CompiledProgram } from '../sim/arduino/compiler';
import { presets } from '../sim/arduino/presets';

export interface CodeBoard {
  id: string;
  kind: BoardKind;
}

interface Hooks {
  /** Boards currently in the scene. */
  boards(): CodeBoard[];
  /** Source the board is running now (its last upload, or Blink). */
  runningSource(board: CodeBoard): string;
  upload(boardId: string, program: CompiledProgram): void;
  serialLog(boardId: string): string;
  clearSerial(boardId: string): void;
  runtimeError(boardId: string): string | null;
}

/** Fake "burn" timing: compile, then a progress bar, then the board reboots with the new program. */
const COMPILE_MS = 500;
const UPLOAD_MS = 1300;

/**
 * Code drawer: per-board sketch editor, ready-made sketches, Upload (compile + virtual flash) and a
 * Serial Monitor. Every control is a <button>, so hand mode can press them by fingertip dwell.
 */
export class CodePanel {
  private boardsEl: HTMLElement;
  private presetsEl: HTMLElement;
  private editor: HTMLTextAreaElement;
  private gutter: HTMLElement;
  private uploadBtn: HTMLButtonElement;
  private bar: HTMLElement;
  private statusEl: HTMLElement;
  private errorsEl: HTMLElement;
  private serialEl: HTMLElement;
  private hint: HTMLElement;

  private selected: CodeBoard | null = null;
  /** Edited (not necessarily uploaded) source per board. */
  private drafts = new Map<string, string>();
  private boardKey = '';
  private lastLog = '';
  private upload: { boardId: string; program: CompiledProgram; start: number } | null = null;

  constructor(
    private el: HTMLElement,
    private hooks: Hooks,
  ) {
    el.innerHTML = `
      <div class="code-head"><b>Code</b><span class="code-boards"></span><button class="code-close" title="Close (C)">✕</button></div>
      <div class="code-presets"></div>
      <div class="code-edit"><pre class="code-gutter"></pre><textarea spellcheck="false" autocomplete="off" wrap="off"></textarea></div>
      <div class="code-actions">
        <button class="code-upload">⬆ Upload</button>
        <div class="code-progress"><div></div></div>
        <span class="code-status"></span>
      </div>
      <div class="code-errors"></div>
      <div class="code-serial-head"><span>Serial Monitor</span><button class="code-clear">Clear</button></div>
      <pre class="code-serial"></pre>
      <div class="code-hint"></div>`;
    const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
    this.boardsEl = q('.code-boards');
    this.presetsEl = q('.code-presets');
    this.editor = q('textarea');
    this.gutter = q('.code-gutter');
    this.uploadBtn = q('.code-upload');
    this.bar = q('.code-progress > div');
    this.statusEl = q('.code-status');
    this.errorsEl = q('.code-errors');
    this.serialEl = q('.code-serial');
    this.hint = q('.code-hint');

    q('.code-close').addEventListener('click', () => this.toggle(false));
    q('.code-clear').addEventListener('click', () => {
      if (this.selected) this.hooks.clearSerial(this.selected.id);
    });
    this.uploadBtn.addEventListener('click', () => this.startUpload());
    this.editor.addEventListener('input', () => {
      if (this.selected) this.drafts.set(this.selected.id, this.editor.value);
      this.renderGutter();
    });
    this.editor.addEventListener('scroll', () => (this.gutter.scrollTop = this.editor.scrollTop));
    this.editor.addEventListener('keydown', (e) => {
      // Tab indents instead of leaving the editor; Esc leaves it (so C / M shortcuts work again);
      // Ctrl+Enter / Ctrl+U uploads.
      if (e.key === 'Escape') this.editor.blur();
      else if (e.key === 'Tab') {
        e.preventDefault();
        this.editor.setRangeText('  ', this.editor.selectionStart, this.editor.selectionEnd, 'end');
        this.editor.dispatchEvent(new Event('input'));
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 'u')) {
        e.preventDefault();
        this.startUpload();
      }
    });
  }

  get open(): boolean {
    return this.el.classList.contains('open');
  }

  toggle(open = !this.open): void {
    this.el.classList.toggle('open', open);
  }

  /** Per frame: board list, upload progress, serial monitor. */
  update(now: number): void {
    if (!this.open) return;
    this.syncBoards();
    this.stepUpload(now);

    const id = this.selected?.id;
    const log = id ? this.hooks.serialLog(id) : '';
    if (log !== this.lastLog) {
      const atBottom = this.serialEl.scrollTop + this.serialEl.clientHeight >= this.serialEl.scrollHeight - 4;
      this.serialEl.textContent = log;
      if (atBottom) this.serialEl.scrollTop = this.serialEl.scrollHeight;
      this.lastLog = log;
    }
    const err = id ? this.hooks.runtimeError(id) : null;
    if (err && !this.upload) this.setStatus(`Runtime error: ${err}`, 'err');
  }

  private syncBoards(): void {
    const boards = this.hooks.boards();
    const key = boards.map((b) => b.id).join(',');
    if (key === this.boardKey) return;
    this.boardKey = key;
    if (this.selected && !boards.some((b) => b.id === this.selected!.id)) this.selected = null;
    this.boardsEl.innerHTML = '';
    for (const b of boards) {
      const btn = document.createElement('button');
      btn.textContent = `${BOARDS[b.kind].label.replace(' DevKit', '')} #${b.id.split('-').pop()}`;
      btn.addEventListener('click', () => this.select(b));
      btn.dataset.board = b.id;
      this.boardsEl.appendChild(btn);
    }
    if (!this.selected && boards[0]) this.select(boards[0]);
    if (!boards.length) {
      this.selected = null;
      this.editor.value = '';
      this.editor.disabled = true;
      this.presetsEl.innerHTML = '';
      this.renderGutter();
      this.setStatus('Spawn an Arduino Uno or ESP32 first.', '');
    }
    this.markSelected();
  }

  private select(b: CodeBoard): void {
    this.selected = b;
    this.editor.disabled = false;
    this.editor.value = this.drafts.get(b.id) ?? this.hooks.runningSource(b);
    this.renderGutter();
    this.errorsEl.innerHTML = '';
    this.setStatus('', '');
    this.lastLog = '\0';
    this.markSelected();

    this.presetsEl.innerHTML = '<span>Examples:</span>';
    for (const p of presets(b.kind)) {
      const btn = document.createElement('button');
      btn.textContent = p.title;
      btn.addEventListener('click', () => {
        this.editor.value = p.code;
        this.drafts.set(b.id, p.code);
        this.renderGutter();
        this.errorsEl.innerHTML = '';
        this.setStatus(`Loaded "${p.title}". Press Upload to burn it to the board.`, '');
      });
      this.presetsEl.appendChild(btn);
    }
    const isEsp = b.kind === 'esp32';
    this.hint.textContent = `${BOARDS[b.kind].label}: ${isEsp ? '3.3 V logic, 12-bit analogRead (0-4095), LED_BUILTIN = 2' : '5 V logic, analogRead 0-1023 on A0-A5, PWM on 3 5 6 9 10 11, LED_BUILTIN = 13'} · libraries: NewPing`;
  }

  private markSelected(): void {
    for (const btn of this.boardsEl.querySelectorAll('button')) {
      btn.classList.toggle('sel', (btn as HTMLElement).dataset.board === this.selected?.id);
    }
  }

  private renderGutter(): void {
    const n = this.editor.value.split('\n').length;
    this.gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    this.gutter.scrollTop = this.editor.scrollTop;
  }

  private startUpload(): void {
    const b = this.selected;
    if (!b || this.upload) return;
    const r = compile(this.editor.value, b.kind);
    if (!r.ok) {
      this.showErrors(r.errors);
      this.setStatus('Compilation error', 'err');
      return;
    }
    this.errorsEl.innerHTML = '';
    this.upload = { boardId: b.id, program: r.program, start: performance.now() };
    this.uploadBtn.disabled = true;
  }

  private stepUpload(now: number): void {
    const u = this.upload;
    if (!u) return;
    const t = now - u.start;
    if (t < COMPILE_MS) {
      this.setStatus('Compiling sketch…', '');
      this.bar.style.width = '0%';
      return;
    }
    const f = Math.min(1, (t - COMPILE_MS) / UPLOAD_MS);
    this.bar.style.width = `${Math.round(f * 100)}%`;
    this.setStatus(`Uploading… ${Math.round(f * 100)}%`, '');
    if (f < 1) return;
    this.hooks.upload(u.boardId, u.program);
    this.upload = null;
    this.uploadBtn.disabled = false;
    this.setStatus('Done uploading. The board is running your sketch.', 'ok');
    setTimeout(() => (this.bar.style.width = '0%'), 800);
  }

  private showErrors(errors: CompileError[]): void {
    this.errorsEl.innerHTML = '';
    for (const e of errors) {
      const row = document.createElement('button');
      row.className = 'code-error';
      row.textContent = `line ${e.line}: ${e.message}`;
      row.addEventListener('click', () => this.gotoLine(e.line));
      this.errorsEl.appendChild(row);
    }
    if (errors[0]) this.gotoLine(errors[0].line);
  }

  private gotoLine(line: number): void {
    const lines = this.editor.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    this.editor.focus();
    this.editor.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    const lh = parseFloat(getComputedStyle(this.editor).lineHeight) || 16;
    this.editor.scrollTop = Math.max(0, (line - 4) * lh);
  }

  private setStatus(text: string, cls: '' | 'ok' | 'err'): void {
    if (this.statusEl.textContent === text) return;
    this.statusEl.textContent = text;
    this.statusEl.className = `code-status ${cls}`;
  }
}

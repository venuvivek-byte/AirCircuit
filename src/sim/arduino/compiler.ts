// Arduino-C subset -> JavaScript compiler. Pure: no Three.js, no DOM.
//
// A sketch (setup / loop, globals, functions, if / for / while / do / switch, arrays, String, casts,
// #define constants) is compiled to JS generator functions. Blocking calls (delay, pulseIn, user
// functions) become `yield*`, so a board can sleep without freezing the app; loops also yield to the
// scheduler when they run too long (see runtime.ts). Integer maths follows C: int / int truncates.
//
// Not supported (reported as compile errors): pointers, references, classes / structs, char arrays,
// function-like macros, and libraries other than those in LIBRARIES.

import type { BoardKind } from '../../components/boards';

export type CType = 'int' | 'float' | 'bool' | 'char' | 'string' | 'void' | 'object';

export interface CompileError {
  line: number;
  col: number;
  message: string;
}

/** Generated program for one board: create() binds it to a runtime API object. */
export interface CompiledProgram {
  boardKind: BoardKind;
  source: string;
  create(rt: unknown): { init: () => Generator<number, void>; setup: () => Generator<number, void>; loop: () => Generator<number, void> };
}

export type CompileResult = { ok: true; program: CompiledProgram } | { ok: false; errors: CompileError[] };

/** Libraries a sketch may #include. Anything else is a compile error. */
export const LIBRARIES = ['Arduino.h', 'NewPing.h'];

// ---------------------------------------------------------------------------
// Board constants
// ---------------------------------------------------------------------------

const BOARD_CONSTANTS: Record<BoardKind, Record<string, number>> = {
  'arduino-uno': { LED_BUILTIN: 13, A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19 },
  esp32: { LED_BUILTIN: 2, A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A12: 2 },
};

const CONSTANTS: Record<string, { c: string; t: CType }> = {
  HIGH: { c: '1', t: 'int' },
  LOW: { c: '0', t: 'int' },
  INPUT: { c: '0', t: 'int' },
  OUTPUT: { c: '1', t: 'int' },
  INPUT_PULLUP: { c: '2', t: 'int' },
  INPUT_PULLDOWN: { c: '3', t: 'int' },
  true: { c: 'true', t: 'bool' },
  false: { c: 'false', t: 'bool' },
  DEC: { c: '10', t: 'int' },
  HEX: { c: '16', t: 'int' },
  OCT: { c: '8', t: 'int' },
  BIN: { c: '2', t: 'int' },
  PI: { c: String(Math.PI), t: 'float' },
  HALF_PI: { c: String(Math.PI / 2), t: 'float' },
  TWO_PI: { c: String(Math.PI * 2), t: 'float' },
  DEG_TO_RAD: { c: String(Math.PI / 180), t: 'float' },
  RAD_TO_DEG: { c: String(180 / Math.PI), t: 'float' },
};

// ---------------------------------------------------------------------------
// Built-in functions
// ---------------------------------------------------------------------------

interface Builtin {
  min: number;
  max: number;
  /** Result type; 'arg0' = type of the first argument, 'promote' = float if any argument is float. */
  ret: CType | 'arg0' | 'promote';
  /** Runtime method name (defaults to the Arduino name). */
  js?: string;
  /** Blocking: emitted as yield*. */
  gen?: boolean;
  /** Only on these boards. */
  boards?: BoardKind[];
  /** Pass argument types too (for printing). */
  typed?: boolean;
}

const BUILTINS: Record<string, Builtin> = {
  pinMode: { min: 2, max: 2, ret: 'void' },
  digitalWrite: { min: 2, max: 2, ret: 'void' },
  digitalRead: { min: 1, max: 1, ret: 'int' },
  analogRead: { min: 1, max: 1, ret: 'int' },
  analogWrite: { min: 2, max: 2, ret: 'void' },
  analogReadResolution: { min: 1, max: 1, ret: 'void', boards: ['esp32'] },
  delay: { min: 1, max: 1, ret: 'void', gen: true },
  delayMicroseconds: { min: 1, max: 1, ret: 'void', gen: true },
  millis: { min: 0, max: 0, ret: 'int' },
  micros: { min: 0, max: 0, ret: 'int' },
  pulseIn: { min: 2, max: 3, ret: 'int', gen: true },
  pulseInLong: { min: 2, max: 3, ret: 'int', gen: true, js: 'pulseIn' },
  tone: { min: 2, max: 3, ret: 'void' },
  noTone: { min: 1, max: 1, ret: 'void' },
  map: { min: 5, max: 5, ret: 'int' },
  constrain: { min: 3, max: 3, ret: 'arg0' },
  min: { min: 2, max: 2, ret: 'promote' },
  max: { min: 2, max: 2, ret: 'promote' },
  abs: { min: 1, max: 1, ret: 'arg0' },
  sq: { min: 1, max: 1, ret: 'arg0' },
  pow: { min: 2, max: 2, ret: 'float' },
  sqrt: { min: 1, max: 1, ret: 'float' },
  sin: { min: 1, max: 1, ret: 'float' },
  cos: { min: 1, max: 1, ret: 'float' },
  tan: { min: 1, max: 1, ret: 'float' },
  atan: { min: 1, max: 1, ret: 'float' },
  atan2: { min: 2, max: 2, ret: 'float' },
  exp: { min: 1, max: 1, ret: 'float' },
  log: { min: 1, max: 1, ret: 'float' },
  log10: { min: 1, max: 1, ret: 'float' },
  floor: { min: 1, max: 1, ret: 'float' },
  ceil: { min: 1, max: 1, ret: 'float' },
  fabs: { min: 1, max: 1, ret: 'float', js: 'abs' },
  round: { min: 1, max: 1, ret: 'int' },
  random: { min: 1, max: 2, ret: 'int' },
  randomSeed: { min: 1, max: 1, ret: 'void' },
  isnan: { min: 1, max: 1, ret: 'bool' },
  isinf: { min: 1, max: 1, ret: 'bool' },
  bitRead: { min: 2, max: 2, ret: 'int' },
  bit: { min: 1, max: 1, ret: 'int' },
  lowByte: { min: 1, max: 1, ret: 'int' },
  highByte: { min: 1, max: 1, ret: 'int' },
  ledcSetup: { min: 3, max: 3, ret: 'int', boards: ['esp32'] },
  ledcAttachPin: { min: 2, max: 2, ret: 'void', boards: ['esp32'] },
  ledcAttach: { min: 3, max: 3, ret: 'bool', boards: ['esp32'] },
  ledcWrite: { min: 2, max: 2, ret: 'void', boards: ['esp32'] },
};

/** Methods on `Serial`. */
const SERIAL_METHODS: Record<string, Builtin> = {
  begin: { min: 1, max: 2, ret: 'void', js: 'serialBegin' },
  print: { min: 1, max: 2, ret: 'int', js: 'print', typed: true },
  println: { min: 0, max: 2, ret: 'int', js: 'println', typed: true },
  printf: { min: 1, max: 20, ret: 'int', js: 'printf' },
  write: { min: 1, max: 1, ret: 'int', js: 'serialWrite' },
  available: { min: 0, max: 0, ret: 'int', js: 'serialAvailable' },
  read: { min: 0, max: 0, ret: 'int', js: 'serialRead' },
  flush: { min: 0, max: 0, ret: 'void', js: 'serialFlush' },
};

/** Library classes: constructor + methods. */
const CLASSES: Record<string, { lib: string; ctor: [number, number]; methods: Record<string, Builtin> }> = {
  NewPing: {
    lib: 'NewPing.h',
    ctor: [2, 3],
    methods: {
      ping: { min: 0, max: 1, ret: 'int', gen: true, js: 'pingUs' },
      ping_cm: { min: 0, max: 1, ret: 'int', gen: true, js: 'pingCm' },
      ping_in: { min: 0, max: 1, ret: 'int', gen: true, js: 'pingIn' },
    },
  },
};

const TYPE_WORDS: Record<string, CType> = {
  void: 'void',
  int: 'int', long: 'int', short: 'int', unsigned: 'int', signed: 'int', byte: 'int', word: 'int', size_t: 'int',
  uint8_t: 'int', uint16_t: 'int', uint32_t: 'int', uint64_t: 'int', int8_t: 'int', int16_t: 'int', int32_t: 'int', int64_t: 'int',
  float: 'float', double: 'float',
  bool: 'bool', boolean: 'bool',
  char: 'char',
  String: 'string',
};
const QUALIFIERS = new Set(['const', 'static', 'volatile', 'unsigned', 'signed', 'constexpr']);
const TYPE_BYTES: Record<CType, number> = { int: 4, float: 4, bool: 1, char: 1, string: 6, void: 0, object: 4 };

// ---------------------------------------------------------------------------
// Tokenizer + preprocessor
// ---------------------------------------------------------------------------

interface Token {
  k: 'num' | 'str' | 'char' | 'id' | 'op' | 'eof';
  v: string;
  line: number;
  col: number;
  float?: boolean;
}

class CError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(message);
  }
}

const OPS = [
  '<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '::', '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.',
  '(', ')', '[', ']', '{', '}',
];

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const err = (m: string): never => {
    throw new CError(m, line, i - lineStart + 1);
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) err('unterminated comment');
      for (let j = i; j < end; j++) if (src[j] === '\n') {
        line++;
        lineStart = j + 1;
      }
      i = end + 2;
      continue;
    }
    const col = i - lineStart + 1;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i))!;
      const body = m[1];
      const isHex = /^0[xXbB]/.test(body);
      const float = !isHex && (/[.eE]/.test(body) || /[fF]/.test(m[2]));
      const v = /^0[bB]/.test(body) ? String(parseInt(body.slice(2), 2)) : isHex ? String(parseInt(body, 16)) : body;
      toks.push({ k: 'num', v, line, col, float });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      toks.push({ k: 'id', v: m[0], line, col });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\n') err('missing terminating ' + ch + ' character');
        if (src[j] === '\\') {
          const e = src[j + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === '0' ? '\0' : e;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) err('missing terminating ' + ch + ' character');
      if (ch === "'") {
        if (s.length !== 1) err('character constant must hold exactly one character');
        toks.push({ k: 'char', v: String(s.charCodeAt(0)), line, col });
      } else toks.push({ k: 'str', v: s, line, col });
      i = j + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) err(`stray '${ch}' in program`);
    toks.push({ k: 'op', v: op!, line, col });
    i += op!.length;
  }
  toks.push({ k: 'eof', v: '', line, col: 1 });
  return toks;
}

/** Handles #include / #define / #ifdef lines; returns the source with directives blanked (line numbers kept). */
function preprocess(src: string): { code: string; includes: Array<{ name: string; line: number }>; defines: Map<string, string> } {
  const includes: Array<{ name: string; line: number }> = [];
  const defines = new Map<string, string>();
  const lines = src.split('\n').map((raw, idx) => {
    const t = raw.trim();
    if (!t.startsWith('#')) return raw;
    const m = /^#\s*(\w+)\s*(.*)$/.exec(t);
    const dir = m?.[1] ?? '';
    const rest = (m?.[2] ?? '').replace(/\/\/.*$/, '').trim();
    if (dir === 'include') {
      const name = /^[<"]([^>"]+)[>"]/.exec(rest)?.[1];
      if (!name) throw new CError('#include expects "FILENAME" or <FILENAME>', idx + 1, 1);
      includes.push({ name, line: idx + 1 });
    } else if (dir === 'define') {
      const d = /^([A-Za-z_]\w*)(\()?\s*(.*)$/.exec(rest);
      if (!d) throw new CError('macro names must be identifiers', idx + 1, 1);
      if (d[2]) throw new CError(`function-like macro '${d[1]}' is not supported; write a function instead`, idx + 1, 1);
      defines.set(d[1], d[3]);
    } else if (!['ifdef', 'ifndef', 'endif', 'else', 'pragma', 'undef', 'if', 'elif'].includes(dir)) {
      throw new CError(`invalid preprocessing directive #${dir}`, idx + 1, 1);
    }
    return '';
  });
  return { code: lines.join('\n'), includes, defines };
}

/** Replaces #define names with their (tokenized) bodies. */
function expandMacros(toks: Token[], defines: Map<string, string>): Token[] {
  const bodies = new Map<string, Token[]>();
  for (const [name, body] of defines) bodies.set(name, tokenize(body).slice(0, -1));
  const out: Token[] = [];
  const expand = (t: Token, depth: number): void => {
    const body = t.k === 'id' ? bodies.get(t.v) : undefined;
    if (!body || depth > 8) {
      out.push(t);
      return;
    }
    for (const b of body) expand({ ...b, line: t.line, col: t.col }, depth + 1);
  };
  for (const t of toks) expand(t, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Parser / emitter
// ---------------------------------------------------------------------------

interface VarInfo {
  js: string;
  type: CType;
  dims: number;
  cls?: string;
}

interface FuncInfo {
  js: string;
  ret: CType;
  params: number;
  defined: boolean;
}

/** Emitted expression: JS code, C type, and lvalue info. */
interface Expr {
  c: string;
  t: CType;
  lv?: boolean;
  /** Variable (for member calls / arrays). */
  v?: VarInfo;
  /** Remaining array dimensions when indexing. */
  dims?: number;
  /** `Serial` itself. */
  serial?: boolean;
}

interface TypeSpec {
  type: CType;
  cls?: string;
  isStatic: boolean;
}

const BINARY_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

class Parser {
  private i = 0;
  private scopes: Array<Map<string, VarInfo>> = [new Map()];
  private funcs = new Map<string, FuncInfo>();
  private globalDecls: string[] = [];
  private globalInit: string[] = [];
  private fnRet: CType = 'void';
  private uid = 0;
  private constants: Record<string, { c: string; t: CType }>;

  constructor(
    private toks: Token[],
    private board: BoardKind,
    private libs: Set<string>,
  ) {
    const bc = Object.fromEntries(Object.entries(BOARD_CONSTANTS[board]).map(([k, v]) => [k, { c: String(v), t: 'int' as CType }]));
    this.constants = { ...CONSTANTS, ...bc };
  }

  // ---- token helpers ----

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next(): Token {
    return this.toks[this.i++] ?? this.toks[this.toks.length - 1];
  }
  private is(v: string, o = 0): boolean {
    const t = this.peek(o);
    return (t.k === 'op' || t.k === 'id') && t.v === v;
  }
  private accept(v: string): boolean {
    if (!this.is(v)) return false;
    this.i++;
    return true;
  }
  private fail(msg: string, t: Token = this.peek()): never {
    throw new CError(msg, t.line, t.col);
  }
  private expect(v: string): Token {
    if (this.is(v)) return this.next();
    const t = this.peek();
    const before = t.k === 'eof' ? 'end of input' : `'${t.k === 'str' ? '"' + t.v + '"' : t.v}'`;
    // Like gcc, point a missing ';' at the end of the previous token's line.
    const prev = this.toks[this.i - 1];
    if (v === ';' && prev && prev.line < t.line) this.fail(`expected ';' at end of line`, prev);
    return this.fail(`expected '${v}' before ${before}`);
  }
  private ident(): Token {
    const t = this.peek();
    if (t.k !== 'id') this.fail(`expected identifier before '${t.v || 'end of input'}'`);
    return this.next();
  }

  // ---- scopes ----

  private lookup(name: string): VarInfo | undefined {
    for (let s = this.scopes.length - 1; s >= 0; s--) {
      const v = this.scopes[s].get(name);
      if (v) return v;
    }
    return undefined;
  }
  private declare(name: string, info: VarInfo, tok: Token): void {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope.has(name)) this.fail(`redeclaration of '${name}'`, tok);
    scope.set(name, info);
  }

  // ---- types ----

  private isTypeStart(o = 0): boolean {
    const t = this.peek(o);
    if (t.k !== 'id') return false;
    return t.v in TYPE_WORDS || QUALIFIERS.has(t.v) || (t.v in CLASSES && this.libs.has(CLASSES[t.v].lib));
  }

  private parseType(): TypeSpec {
    const words: string[] = [];
    let cls: string | undefined;
    while (this.peek().k === 'id' && !cls) {
      const v = this.peek().v;
      if (v in CLASSES && this.libs.has(CLASSES[v].lib) && !words.some((w) => w in TYPE_WORDS)) cls = v;
      else if (!(v in TYPE_WORDS) && !QUALIFIERS.has(v)) break;
      words.push(v);
      this.i++;
    }
    const isStatic = words.includes('static');
    if (!cls && !words.some((w) => w in TYPE_WORDS)) this.fail(`'${this.peek().v}' does not name a type`);
    const type = cls ? 'object' : resolveType(words);
    if (this.is('*')) this.fail('pointers are not supported in the simulator');
    if (this.is('&')) this.fail('references are not supported in the simulator');
    return { type, cls, isStatic };
  }

  // ---- program ----

  parseProgram(): string {
    this.prescanFunctions();
    while (this.peek().k !== 'eof') {
      if (this.accept(';')) continue;
      if (this.is('struct') || this.is('class') || this.is('enum') || this.is('typedef')) {
        this.fail(`'${this.peek().v}' is not supported in the simulator`);
      }
      if (!this.isTypeStart()) this.fail(`'${this.peek().v}' does not name a type`);
      const spec = this.parseType();
      const nameTok = this.ident();
      if (this.is('(')) this.parseFunction(spec, nameTok);
      else this.parseDeclRest(spec, nameTok, true);
    }
    for (const req of ['setup', 'loop']) {
      if (!this.funcs.get(req)?.defined) throw new CError(`undefined reference to '${req}()' (every sketch needs setup() and loop())`, 1, 1);
    }
    return [
      '"use strict";',
      'return function (__rt) {',
      ...this.globalDecls,
      ...this.fnCode,
      `function* __init() { ${this.globalInit.join(' ')} }`,
      'return { init: __init, setup: u_setup, loop: u_loop };',
      '};',
    ].join('\n');
  }

  private fnCode: string[] = [];

  /** Collects every top-level function's return type first, so calls may precede definitions. */
  private prescanFunctions(): void {
    let depth = 0;
    for (let k = 0; k < this.toks.length - 1; k++) {
      const t = this.toks[k];
      if (t.v === '{' && t.k === 'op') depth++;
      else if (t.v === '}' && t.k === 'op') depth--;
      else if (depth === 0 && t.k === 'id' && this.toks[k + 1].v === '(' && this.toks[k + 1].k === 'op' && k > 0) {
        const prevT = this.toks[k - 1];
        if (prevT.k !== 'id' || !(prevT.v in TYPE_WORDS || prevT.v in CLASSES)) continue;
        // Walk back over the type words.
        const words: string[] = [];
        for (let j = k - 1; j >= 0 && this.toks[j].k === 'id' && (this.toks[j].v in TYPE_WORDS || QUALIFIERS.has(this.toks[j].v)); j--) {
          words.push(this.toks[j].v);
        }
        const ret: CType = words.length ? resolveType(words) : 'object';
        // Count parameters.
        let params = 0;
        let pd = 0;
        let any = false;
        for (let q = k + 2; q < this.toks.length; q++) {
          const v = this.toks[q];
          if (v.k === 'op' && v.v === '(') pd++;
          else if (v.k === 'op' && v.v === ')') {
            if (pd === 0) break;
            pd--;
          } else if (v.k === 'op' && v.v === ',' && pd === 0) params++;
          else if (!(v.k === 'id' && v.v === 'void' && !any && this.toks[q + 1].v === ')')) any = true;
        }
        if (!this.funcs.has(t.v)) this.funcs.set(t.v, { js: `u_${t.v}`, ret, params: any ? params + 1 : 0, defined: false });
      }
    }
  }

  private parseFunction(spec: TypeSpec, nameTok: Token): void {
    const name = nameTok.v;
    if (name in BUILTINS) this.fail(`'${name}' is a built-in function and can't be redefined`, nameTok);
    this.expect('(');
    const params: Array<{ name: string; info: VarInfo; tok: Token }> = [];
    if (!(this.is('void') && this.is(')', 1))) {
      while (!this.is(')')) {
        const ps = this.parseType();
        const pt = this.ident();
        let dims = 0;
        while (this.accept('[')) {
          if (!this.is(']')) this.parseExpr();
          this.expect(']');
          dims++;
        }
        params.push({ name: pt.v, info: { js: `u_${pt.v}`, type: ps.type, dims, cls: ps.cls }, tok: pt });
        if (!this.accept(',')) break;
      }
    } else this.i++;
    this.expect(')');
    let info = this.funcs.get(name);
    if (!info) this.funcs.set(name, (info = { js: `u_${name}`, ret: spec.type, params: params.length, defined: false }));
    info.ret = spec.type;
    info.params = params.length;
    if (this.accept(';')) return; // prototype
    if (info.defined) this.fail(`redefinition of '${name}'`, nameTok);
    info.defined = true;

    this.fnRet = spec.type;
    this.scopes.push(new Map());
    for (const p of params) this.declare(p.name, p.info, p.tok);
    const body = this.parseBlock(false);
    this.scopes.pop();
    this.fnCode.push(`function* ${info.js}(${params.map((p) => p.info.js).join(', ')}) ${body}`);
  }

  /** After `type name`: [dims] [= init | (ctor args)] {, name ...} ; */
  private parseDeclRest(spec: TypeSpec, firstName: Token, global: boolean): string {
    if (spec.type === 'void') this.fail(`variable '${firstName.v}' declared void`, firstName);
    const parts: string[] = [];
    let nameTok = firstName;
    for (;;) {
      const dimsCode: string[] = [];
      while (this.accept('[')) {
        dimsCode.push(this.is(']') ? '' : this.parseExpr().c);
        this.expect(']');
      }
      if (dimsCode.length && spec.type === 'char') {
        this.fail('char arrays are not supported in the simulator; use String instead', nameTok);
      }
      const hoist = global || spec.isStatic;
      const js = hoist ? (spec.isStatic && !global ? `s${++this.uid}_${nameTok.v}` : `u_${nameTok.v}`) : `u_${nameTok.v}`;
      const info: VarInfo = { js, type: spec.type, dims: dimsCode.length, cls: spec.cls };

      let init: string;
      if (spec.type === 'object') {
        const cls = CLASSES[spec.cls!];
        this.expect('(');
        const args = this.parseArgs();
        if (args.length < cls.ctor[0] || args.length > cls.ctor[1]) this.fail(`no matching constructor for '${spec.cls}'`, nameTok);
        init = `__rt.new${spec.cls}(${args.map((a) => a.c).join(', ')})`;
      } else if (this.accept('=')) {
        if (dimsCode.length) {
          init = this.parseInitList(spec.type, dimsCode);
        } else {
          init = this.convert(this.parseAssign(), spec.type).c;
        }
      } else if (dimsCode.length) {
        if (dimsCode.some((d) => d === '')) this.fail(`array size missing in '${nameTok.v}'`, nameTok);
        init = this.arrayInit(dimsCode, defaultValue(spec.type));
      } else {
        init = defaultValue(spec.type);
      }
      this.declare(nameTok.v, info, nameTok);

      if (hoist) {
        this.globalDecls.push(`let ${js} = ${defaultValue(spec.type)};`);
        this.globalInit.push(`${js} = ${init};`);
      } else {
        parts.push(`${js} = ${init}`);
      }
      if (!this.accept(',')) break;
      nameTok = this.ident();
    }
    this.expect(';');
    return parts.length ? `let ${parts.join(', ')};` : '';
  }

  private arrayInit(dims: string[], fill: string): string {
    if (dims.length === 1) return `__rt.array(${dims[0]}, () => ${fill})`;
    return `__rt.array(${dims[0]}, () => ${this.arrayInit(dims.slice(1), fill)})`;
  }

  /** `{1, 2, 3}` (nested for 2D); sizes taken from the list when the declaration left them empty. */
  private parseInitList(type: CType, dims: string[]): string {
    if (type === 'string' && !this.is('{')) this.fail('array must be initialized with a brace-enclosed initializer');
    this.expect('{');
    const items: string[] = [];
    while (!this.is('}')) {
      items.push(dims.length > 1 ? this.parseInitList(type, dims.slice(1)) : this.convert(this.parseAssign(), type).c);
      if (!this.accept(',')) break;
    }
    this.expect('}');
    const pad = dims[0] ? `__rt.pad([${items.join(', ')}], ${dims[0]}, () => ${dims.length > 1 ? this.arrayInit(dims.slice(1), defaultValue(type)) : defaultValue(type)})` : `[${items.join(', ')}]`;
    return pad;
  }

  // ---- statements ----

  private parseBlock(newScope = true): string {
    this.expect('{');
    if (newScope) this.scopes.push(new Map());
    const out: string[] = [];
    while (!this.is('}')) {
      if (this.peek().k === 'eof') this.fail("expected '}' at end of input");
      out.push(this.parseStatement());
    }
    this.expect('}');
    if (newScope) this.scopes.pop();
    return `{\n${out.join('\n')}\n}`;
  }

  /** Loop bodies yield to the scheduler when a step's op budget runs out. */
  private loopBody(): string {
    this.scopes.push(new Map());
    const s = this.parseStatement();
    this.scopes.pop();
    return `{ if (__rt.tick()) yield 0;\n${s}\n}`;
  }

  private parseStatement(): string {
    const t = this.peek();
    if (t.k === 'op' && t.v === '{') return this.parseBlock();
    if (t.k === 'op' && t.v === ';') {
      this.i++;
      return ';';
    }
    if (t.k === 'id') {
      switch (t.v) {
        case 'if': {
          this.i++;
          this.expect('(');
          const c = this.parseExpr().c;
          this.expect(')');
          const a = this.scoped(() => this.parseStatement());
          if (this.accept('else')) return `if (${c}) ${a} else ${this.scoped(() => this.parseStatement())}`;
          return `if (${c}) ${a}`;
        }
        case 'while': {
          this.i++;
          this.expect('(');
          const c = this.parseExpr().c;
          this.expect(')');
          return `while (${c}) ${this.loopBody()}`;
        }
        case 'do': {
          this.i++;
          const body = this.loopBody();
          this.expect('while');
          this.expect('(');
          const c = this.parseExpr().c;
          this.expect(')');
          this.expect(';');
          return `do ${body} while (${c});`;
        }
        case 'for': {
          this.i++;
          this.expect('(');
          this.scopes.push(new Map());
          let init = '';
          if (this.isTypeStart()) {
            const spec = this.parseType();
            init = this.parseDeclRest(spec, this.ident(), false).replace(/;$/, '');
          } else {
            if (!this.is(';')) init = this.parseComma().c;
            this.expect(';');
          }
          const cond = this.is(';') ? '' : this.parseExpr().c;
          this.expect(';');
          const upd = this.is(')') ? '' : this.parseComma().c;
          this.expect(')');
          const body = this.loopBody();
          this.scopes.pop();
          return `for (${init}; ${cond}; ${upd}) ${body}`;
        }
        case 'switch': {
          this.i++;
          this.expect('(');
          const c = this.parseExpr().c;
          this.expect(')');
          this.expect('{');
          this.scopes.push(new Map());
          const out: string[] = [];
          while (!this.is('}')) {
            if (this.accept('case')) {
              const v = this.parseTernary().c;
              this.expect(':');
              out.push(`case ${v}:`);
            } else if (this.accept('default')) {
              this.expect(':');
              out.push('default:');
            } else out.push(this.parseStatement());
          }
          this.expect('}');
          this.scopes.pop();
          return `switch (${c}) {\n${out.join('\n')}\n}`;
        }
        case 'break':
        case 'continue':
          this.i++;
          this.expect(';');
          return `${t.v};`;
        case 'return': {
          this.i++;
          if (this.accept(';')) return 'return;';
          if (this.fnRet === 'void') this.fail(`return-statement with a value, in function returning 'void'`, t);
          const e = this.convert(this.parseExpr(), this.fnRet);
          this.expect(';');
          return `return ${e.c};`;
        }
        case 'goto':
          this.fail("'goto' is not supported in the simulator");
      }
      if (this.isTypeStart() && !(this.peek(1).v === '(' && this.peek(1).k === 'op')) {
        const spec = this.parseType();
        return this.parseDeclRest(spec, this.ident(), false);
      }
    }
    const e = this.parseComma();
    this.expect(';');
    return `${e.c};`;
  }

  private scoped(f: () => string): string {
    this.scopes.push(new Map());
    const s = f();
    this.scopes.pop();
    return s;
  }

  // ---- expressions ----

  private parseComma(): Expr {
    let e = this.parseExpr();
    while (this.accept(',')) {
      const r = this.parseExpr();
      e = { c: `(${e.c}, ${r.c})`, t: r.t };
    }
    return e;
  }

  parseExpr(): Expr {
    return this.parseAssign();
  }

  private parseAssign(): Expr {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.k === 'op' && ASSIGN_OPS.has(t.v)) {
      this.i++;
      if (!left.lv) this.fail('lvalue required as left operand of assignment', t);
      const right = this.parseAssign();
      if (t.v === '=') return { c: `(${left.c} = ${this.convert(right, left.t).c})`, t: left.t };
      const op = t.v.slice(0, -1);
      // Mutating String methods aside, a compound assignment is `x = x op y` with C typing.
      const value = this.binary(op, left, right, t);
      return { c: `(${left.c} = ${this.convert(value, left.t).c})`, t: left.t };
    }
    return left;
  }

  private parseTernary(): Expr {
    const c = this.parseBinary(1);
    if (!this.accept('?')) return c;
    const a = this.parseAssign();
    this.expect(':');
    const b = this.parseAssign();
    const t: CType = a.t === 'string' || b.t === 'string' ? 'string' : a.t === 'float' || b.t === 'float' ? 'float' : a.t;
    return { c: `(${c.c} ? ${a.c} : ${b.c})`, t };
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const prec = t.k === 'op' ? BINARY_PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      this.i++;
      const right = this.parseBinary(prec + 1);
      left = this.binary(t.v, left, right, t);
    }
  }

  private binary(op: string, a: Expr, b: Expr, tok: Token): Expr {
    if (a.serial || b.serial || a.t === 'void' || b.t === 'void') this.fail(`invalid operands to binary '${op}'`, tok);
    if (op === '+' && (a.t === 'string' || b.t === 'string')) return { c: `(${this.str(a)} + ${this.str(b)})`, t: 'string' };
    if (a.t === 'string' || b.t === 'string') {
      if (op === '==' || op === '!=') return { c: `(${a.c} ${op}= ${b.c})`, t: 'bool' };
      if (['<', '>', '<=', '>='].includes(op)) return { c: `(${a.c} ${op} ${b.c})`, t: 'bool' };
      this.fail(`invalid operands of types '${cName(a.t)}' and '${cName(b.t)}' to binary 'operator${op}'`, tok);
    }
    const num: CType = a.t === 'float' || b.t === 'float' ? 'float' : 'int';
    switch (op) {
      case '&&':
      case '||':
        return { c: `(${a.c} ${op} ${b.c})`, t: 'bool' };
      case '==':
      case '!=':
      case '<':
      case '>':
      case '<=':
      case '>=':
        return { c: `(${a.c} ${op} ${b.c})`, t: 'bool' };
      case '/':
        return num === 'int' ? { c: `__rt.idiv(${a.c}, ${b.c})`, t: 'int' } : { c: `(${a.c} / ${b.c})`, t: 'float' };
      case '%':
        if (num === 'float') this.fail(`invalid operands of types '${cName(a.t)}' and '${cName(b.t)}' to binary 'operator%'`, tok);
        return { c: `__rt.imod(${a.c}, ${b.c})`, t: 'int' };
      case '&':
      case '|':
      case '^':
      case '<<':
      case '>>':
        if (num === 'float') this.fail(`invalid operands of types '${cName(a.t)}' and '${cName(b.t)}' to binary 'operator${op}'`, tok);
        return { c: `(${a.c} ${op} ${b.c})`, t: 'int' };
      default:
        return { c: `(${a.c} ${op} ${b.c})`, t: num };
    }
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.k === 'op') {
      if (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~') {
        this.i++;
        const e = this.parseUnary();
        if (t.v === '!') return { c: `(!${e.c})`, t: 'bool' };
        if (e.t === 'string') this.fail(`wrong type argument to unary '${t.v}'`, t);
        return { c: `(${t.v}${e.c})`, t: t.v === '~' ? 'int' : e.t === 'float' ? 'float' : 'int' };
      }
      if (t.v === '++' || t.v === '--') {
        this.i++;
        const e = this.parseUnary();
        if (!e.lv) this.fail(`lvalue required as ${t.v === '++' ? 'increment' : 'decrement'} operand`, t);
        return { c: `(${t.v}${e.c})`, t: e.t };
      }
      if (t.v === '*' || t.v === '&') this.fail('pointers are not supported in the simulator', t);
      if (t.v === '(' && this.isTypeStart(1)) {
        // C-style cast: (int) x
        const save = this.i;
        this.i++;
        const spec = this.parseType();
        if (this.accept(')')) return this.convert(this.parseUnary(), spec.type, true);
        this.i = save;
      }
    }
    if (t.k === 'id' && t.v === 'sizeof') return this.parseSizeof();
    return this.parsePostfix(this.parsePrimary());
  }

  private parseSizeof(): Expr {
    this.i++;
    const paren = this.accept('(');
    let bytes: string;
    if (paren && this.isTypeStart()) {
      bytes = String(TYPE_BYTES[this.parseType().type]);
    } else {
      const e = paren ? this.parseExpr() : this.parseUnary();
      bytes = e.dims ? `(${e.c}.length * ${this.elemBytes(e)})` : String(TYPE_BYTES[e.t]);
    }
    if (paren) this.expect(')');
    return { c: bytes, t: 'int' };
  }

  private elemBytes(e: Expr): string {
    // Byte size of one element of an array expression (nested arrays: product of inner lengths).
    let c = String(TYPE_BYTES[e.t]);
    let inner = `${e.c}[0]`;
    for (let d = 1; d < (e.dims ?? 1); d++) {
      c = `${inner}.length * ${c}`;
      inner += '[0]';
    }
    return c;
  }

  private parsePostfix(e: Expr): Expr {
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op') return e;
      if (t.v === '[') {
        this.i++;
        const idx = this.parseExpr();
        this.expect(']');
        if (e.t === 'string' && !e.dims) {
          e = { c: `__rt.charAt(${e.c}, ${idx.c})`, t: 'char' };
        } else {
          if (!e.dims) this.fail('subscripted value is neither array nor pointer', t);
          e = { c: `${e.c}[__rt.idx(${e.c}, ${idx.c})]`, t: e.t, lv: true, dims: e.dims - 1, v: e.v };
          if (e.dims === 0) e.dims = undefined;
        }
      } else if (t.v === '.') {
        this.i++;
        const name = this.ident();
        e = this.member(e, name);
      } else if (t.v === '++' || t.v === '--') {
        if (!e.lv) return e;
        this.i++;
        e = { c: `(${e.c}${t.v})`, t: e.t };
      } else if (t.v === '->') {
        this.fail('pointers are not supported in the simulator', t);
      } else return e;
    }
  }

  private member(base: Expr, name: Token): Expr {
    if (base.serial) {
      const m = SERIAL_METHODS[name.v];
      if (!m) this.fail(`'class HardwareSerial' has no member named '${name.v}'`, name);
      return this.callBuiltin(name, m, []);
    }
    if (base.t === 'object' && base.v?.cls) {
      const m = CLASSES[base.v.cls].methods[name.v];
      if (!m) this.fail(`'class ${base.v.cls}' has no member named '${name.v}'`, name);
      return this.callBuiltin(name, m, [{ c: base.c, t: 'object' }]);
    }
    if (base.t === 'string') return this.stringMethod(base, name);
    return this.fail(`request for member '${name.v}' in something that is not a structure or class`, name);
  }

  private stringMethod(s: Expr, name: Token): Expr {
    this.expect('(');
    const args = this.parseArgs();
    const a = args.map((x) => x.c);
    const need = (n: number, m = n) => {
      if (args.length < n || args.length > m) this.fail(`wrong number of arguments to 'String::${name.v}'`, name);
    };
    const mutate = (expr: string): Expr => {
      if (!s.lv) this.fail(`'${name.v}' needs a String variable`, name);
      return { c: `(${s.c} = ${expr}, undefined)`, t: 'void' };
    };
    switch (name.v) {
      case 'length':
        need(0);
        return { c: `${s.c}.length`, t: 'int' };
      case 'toInt':
        need(0);
        return { c: `__rt.strToInt(${s.c})`, t: 'int' };
      case 'toFloat':
      case 'toDouble':
        need(0);
        return { c: `__rt.strToFloat(${s.c})`, t: 'float' };
      case 'indexOf':
      case 'lastIndexOf':
        need(1, 2);
        return { c: `${s.c}.${name.v}(${[this.str(args[0]), ...a.slice(1)].join(', ')})`, t: 'int' };
      case 'substring':
        need(1, 2);
        return { c: `${s.c}.substring(${a.join(', ')})`, t: 'string' };
      case 'charAt':
        need(1);
        return { c: `__rt.charAt(${s.c}, ${a[0]})`, t: 'char' };
      case 'equals':
        need(1);
        return { c: `(${s.c} === ${this.str(args[0])})`, t: 'bool' };
      case 'equalsIgnoreCase':
        need(1);
        return { c: `(${s.c}.toLowerCase() === ${this.str(args[0])}.toLowerCase())`, t: 'bool' };
      case 'startsWith':
      case 'endsWith':
        need(1);
        return { c: `${s.c}.${name.v}(${this.str(args[0])})`, t: 'bool' };
      case 'toUpperCase':
      case 'toLowerCase':
        need(0);
        return mutate(`${s.c}.${name.v}()`);
      case 'trim':
        need(0);
        return mutate(`${s.c}.trim()`);
      case 'concat':
        need(1);
        return mutate(`${s.c} + ${this.str(args[0])}`);
      case 'replace':
        need(2);
        return mutate(`${s.c}.split(${this.str(args[0])}).join(${this.str(args[1])})`);
      default:
        return this.fail(`'class String' has no member named '${name.v}'`, name);
    }
  }

  private parseArgs(): Expr[] {
    const args: Expr[] = [];
    while (!this.is(')')) {
      args.push(this.parseAssign());
      if (!this.accept(',')) break;
    }
    this.expect(')');
    return args;
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { c: t.v, t: t.float ? 'float' : 'int' };
      case 'char':
        return { c: t.v, t: 'char' };
      case 'str': {
        let v = t.v;
        while (this.peek().k === 'str') v += this.next().v;
        return { c: JSON.stringify(v), t: 'string' };
      }
      case 'op':
        if (t.v === '(') {
          const e = this.parseComma();
          this.expect(')');
          return { c: `(${e.c})`, t: e.t };
        }
        return this.fail(`expected primary-expression before '${t.v}' token`, t);
      case 'eof':
        return this.fail('expected primary-expression at end of input', t);
    }
    const name = t.v;
    if (name === 'Serial') return { c: '__rt', t: 'object', serial: true };
    if (this.is('(')) return this.parseCall(t);
    const v = this.lookup(name);
    if (v) return { c: v.js, t: v.type, lv: !v.dims, v, dims: v.dims || undefined };
    const k = this.constants[name];
    if (k) return { ...k };
    if (name in TYPE_WORDS) return this.fail(`expected primary-expression before '${name}'`, t);
    return this.fail(`'${name}' was not declared in this scope`, t);
  }

  private parseCall(nameTok: Token): Expr {
    const name = nameTok.v;
    // Functional casts: int(x), float(x), String(x [, base | decimals]).
    if (name in TYPE_WORDS && name !== 'void') {
      this.expect('(');
      const args = this.parseArgs();
      const type = TYPE_WORDS[name];
      if (type === 'string') {
        if (args.length > 2) this.fail(`no matching function for call to 'String'`, nameTok);
        if (!args.length) return { c: '""', t: 'string' };
        return { c: `__rt.String(${args[0].c}, ${JSON.stringify(args[0].t)}${args[1] ? ', ' + args[1].c : ''})`, t: 'string' };
      }
      if (args.length !== 1) this.fail(`functional cast to '${name}' needs one argument`, nameTok);
      return this.convert(args[0], type, true);
    }
    if (name === 'yield') {
      this.expect('(');
      this.expect(')');
      return { c: '(yield 0)', t: 'void' };
    }
    const fn = this.funcs.get(name);
    if (fn && !this.lookup(name)) {
      this.expect('(');
      const args = this.parseArgs();
      if (args.length !== fn.params) {
        this.fail(`too ${args.length < fn.params ? 'few' : 'many'} arguments to function '${name}'`, nameTok);
      }
      return { c: `(yield* ${fn.js}(${args.map((a) => a.c).join(', ')}))`, t: fn.ret };
    }
    const b = BUILTINS[name];
    if (b && (!b.boards || b.boards.includes(this.board))) return this.callBuiltin(nameTok, b, []);
    return this.fail(`'${name}' was not declared in this scope`, nameTok);
  }

  /** Calls a runtime builtin; `pre` are leading arguments (the object for library methods). */
  private callBuiltin(nameTok: Token, b: Builtin, pre: Expr[]): Expr {
    this.expect('(');
    const args = this.parseArgs();
    if (args.length < b.min) this.fail(`too few arguments to function '${nameTok.v}'`, nameTok);
    if (args.length > b.max) this.fail(`too many arguments to function '${nameTok.v}'`, nameTok);
    for (const a of args) if (a.t === 'void') this.fail(`invalid use of void expression`, nameTok);
    const js = b.js ?? nameTok.v;
    const list = [...pre, ...args].map((a) => a.c);
    if (b.typed && args.length) list.splice(pre.length + 1, 0, JSON.stringify(args[0]?.t ?? 'void'));
    const call = `__rt.${js}(${list.join(', ')})`;
    const ret: CType =
      b.ret === 'arg0' ? (args[0].t === 'float' ? 'float' : 'int')
      : b.ret === 'promote' ? (args.some((a) => a.t === 'float') ? 'float' : 'int')
      : b.ret;
    return { c: b.gen ? `(yield* ${call})` : call, t: ret };
  }

  // ---- conversions ----

  /** Converts an expression to a declared type (int truncates, String formats numbers). */
  private convert(e: Expr, to: CType, explicit = false): Expr {
    if (e.t === 'void') this.fail('void value not ignored as it ought to be');
    if (e.serial || (e.t === 'object' && to !== 'object')) this.fail(`cannot convert '${e.v?.cls ?? 'Serial'}' to '${cName(to)}'`);
    if (to === e.t || to === 'void' || to === 'object') return e;
    switch (to) {
      case 'int':
        if (e.t === 'string') {
          if (!explicit) this.fail(`cannot convert 'String' to 'int'; use .toInt()`);
          return { c: `__rt.strToInt(${e.c})`, t: 'int' };
        }
        return e.t === 'float' ? { c: `__rt.toInt(${e.c})`, t: 'int' } : e.t === 'bool' ? { c: `(+${e.c})`, t: 'int' } : { ...e, t: 'int' };
      case 'char':
        return e.t === 'float' ? { c: `(__rt.toInt(${e.c}) & 255)`, t: 'char' } : e.t === 'bool' ? { c: `(+${e.c})`, t: 'char' } : { ...e, t: 'char' };
      case 'float':
        if (e.t === 'string') this.fail(`cannot convert 'String' to 'float'; use .toFloat()`);
        return e.t === 'bool' ? { c: `(+${e.c})`, t: 'float' } : { ...e, t: 'float' };
      case 'bool':
        return { c: `(!!${e.c})`, t: 'bool' };
      case 'string':
        return { c: this.str(e), t: 'string' };
    }
    return e;
  }

  /** JS string of an expression, formatted like Arduino's String(x). */
  private str(e: Expr): string {
    return e.t === 'string' ? e.c : `__rt.String(${e.c}, ${JSON.stringify(e.t)})`;
  }
}

/** C type of a run of type words: "unsigned long" -> int, "unsigned char" -> int, "double" -> float. */
function resolveType(words: string[]): CType {
  const has = (...w: string[]) => w.some((x) => words.includes(x));
  if (has('void')) return 'void';
  if (has('float', 'double')) return 'float';
  if (has('bool', 'boolean')) return 'bool';
  if (has('String')) return 'string';
  if (has('char')) return has('unsigned', 'signed') ? 'int' : 'char';
  return 'int';
}

function defaultValue(t: CType): string {
  return t === 'string' ? '""' : t === 'bool' ? 'false' : t === 'object' ? 'null' : '0';
}

function cName(t: CType): string {
  return t === 'string' ? 'String' : t;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function compile(source: string, boardKind: BoardKind): CompileResult {
  try {
    const pre = preprocess(source);
    const libs = new Set<string>();
    for (const inc of pre.includes) {
      if (!LIBRARIES.includes(inc.name)) {
        const hint = /wifi|bluetooth|ble|http|mqtt/i.test(inc.name) ? ' (networking is not simulated)' : '';
        throw new CError(`${inc.name}: library not available in the simulator${hint}. Available: ${LIBRARIES.join(', ')}`, inc.line, 1);
      }
      libs.add(inc.name);
    }
    const toks = expandMacros(tokenize(pre.code), pre.defines);
    const js = new Parser(toks, boardKind, libs).parseProgram();
    let factory: CompiledProgram['create'];
    try {
      factory = new Function(js)() as CompiledProgram['create'];
    } catch (e) {
      // A construct the emitter got wrong; report it rather than crash.
      return { ok: false, errors: [{ line: 1, col: 1, message: `internal compiler error: ${(e as Error).message}` }] };
    }
    return { ok: true, program: { boardKind, source, create: factory } };
  } catch (e) {
    if (e instanceof CError) return { ok: false, errors: [{ line: e.line, col: e.col, message: e.message }] };
    throw e;
  }
}

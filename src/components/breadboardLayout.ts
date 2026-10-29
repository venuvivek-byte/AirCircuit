// Breadboard hole layout and internal connectivity as pure data (shared by renderer and simulator).
//
// Terminal strip: columns 1..COLUMNS, rows a-e (top half) and f-j (bottom half).
// Holes a..e in one column are connected (a group of 5); f..j likewise.
// Power rails: one '+' rail and one '-' rail, each a single connected strip.
// Hole names: 'a1'..'j30' for the terminal strip, '+1'..'+30' and '-1'..'-30' for rails.

export const COLUMNS = 30;
export const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'] as const;
export const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'] as const;
export const RAILS = ['+', '-'] as const;

export function allHoleNames(): string[] {
  const names: string[] = [];
  for (let c = 1; c <= COLUMNS; c++) {
    for (const r of [...TOP_ROWS, ...BOTTOM_ROWS]) names.push(`${r}${c}`);
    for (const rail of RAILS) names.push(`${rail}${c}`);
  }
  return names;
}

/** Returns the internal group a hole belongs to; holes with the same group are electrically connected. */
export function holeGroup(hole: string): string {
  const m = /^([a-j+-])(\d+)$/.exec(hole);
  if (!m) throw new Error(`Invalid breadboard hole: ${hole}`);
  const [, row, col] = m;
  if (row === '+') return 'rail+';
  if (row === '-') return 'rail-';
  return (TOP_ROWS as readonly string[]).includes(row) ? `col${col}top` : `col${col}bot`;
}

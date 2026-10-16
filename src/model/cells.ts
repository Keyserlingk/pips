import type { Cell, Constraint, Puzzle, Region } from './types';
import { NUM_REGION_COLORS } from './types';

export const DIRS: readonly Cell[] = [
  { r: 0, c: 1 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: -1, c: 0 },
];

export const key = (c: Cell) => `${c.r},${c.c}`;
export const sameCell = (a: Cell, b: Cell) => a.r === b.r && a.c === b.c;
export const add = (a: Cell, b: Cell): Cell => ({ r: a.r + b.r, c: a.c + b.c });
export const toIdx = (c: Cell, width: number) => c.r * width + c.c;
export const fromIdx = (i: number, width: number): Cell => ({ r: Math.floor(i / width), c: i % width });

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function setSize(maxPip: number): number {
  return ((maxPip + 1) * (maxPip + 2)) / 2;
}

export function constraintLabel(con: Constraint): string {
  switch (con.kind) {
    case 'sum':
      return con.op === '=' ? `${con.value}` : `${con.op}${con.value}`;
    case 'equal':
      return '=';
    case 'distinct':
      return '≠';
    case 'none':
      return '';
    case 'step':
      return `Δ≤${con.max}`;
    case 'product':
      return `×${con.value}`;
    case 'extreme':
      return `${con.which} ${con.value}`;
    case 'sumParity':
      return con.even ? 'Σ even' : 'Σ odd';
  }
}

/** Plain-language rule, used by the legend on the play screen. */
export function constraintRule(con: Constraint): string {
  switch (con.kind) {
    case 'sum':
      return con.op === '='
        ? 'A number: the pips in the region add up to it.'
        : con.op === '<'
          ? '<N: the pips in the region add up to less than N.'
          : '>N: the pips in the region add up to more than N.';
    case 'equal':
      return '=: every cell in the region shows the same number.';
    case 'distinct':
      return '≠: every cell in the region shows a different number.';
    case 'none':
      return '';
    case 'step':
      return 'Δ≤N: side-by-side cells in the region differ by at most N.';
    case 'product':
      return '×N: the pips in the region multiply to N.';
    case 'extreme':
      return con.which === 'max'
        ? 'max N: the largest number in the region is exactly N.'
        : 'min N: the smallest number in the region is exactly N.';
    case 'sumParity':
      return 'Σ even / Σ odd: the pips in the region add up to an even / odd number.';
  }
}

/** Key used to show each kind of rule once in the legend. */
export function ruleKey(con: Constraint): string {
  if (con.kind === 'sum') return `sum${con.op}`;
  if (con.kind === 'extreme') return `extreme${con.which}`;
  return con.kind;
}

/** `cells[i]` holds `values[i]`; cells are only needed for adjacency rules. */
export function satisfies(con: Constraint, values: number[], cells: Cell[] = []): boolean {
  const sum = () => values.reduce((a, b) => a + b, 0);
  switch (con.kind) {
    case 'none':
      return true;
    case 'equal':
      return values.every((v) => v === values[0]);
    case 'distinct':
      return new Set(values).size === values.length;
    case 'sum': {
      const s = sum();
      return con.op === '=' ? s === con.value : con.op === '<' ? s < con.value : s > con.value;
    }
    case 'step':
      return cells.every((a, i) =>
        cells.every((b, j) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1 || Math.abs(values[i] - values[j]) <= con.max),
      );
    case 'product':
      return values.reduce((a, b) => a * b, 1) === con.value;
    case 'extreme':
      return (con.which === 'max' ? Math.max(...values) : Math.min(...values)) === con.value;
    case 'sumParity':
      return (sum() % 2 === 0) === con.even;
  }
}

export type RegionStatus = 'open' | 'ok' | 'bad';

export function evaluate(p: Puzzle, values: Map<string, number>) {
  const status: Record<string, RegionStatus> = {};
  let solved = p.cells.every((c) => values.has(key(c)));
  for (const reg of p.regions) {
    const vals = reg.cells.map((c) => values.get(key(c)));
    if (vals.some((v) => v === undefined)) {
      status[reg.id] = 'open';
      continue;
    }
    const ok = satisfies(reg.constraint, vals as number[], reg.cells);
    status[reg.id] = ok ? 'ok' : 'bad';
    if (!ok) solved = false;
  }
  return { status, solved };
}

/** Greedy colouring so that touching regions get different palette slots. */
export function assignColors(regions: Region[]): Region[] {
  const owner = new Map<string, number>();
  regions.forEach((reg, i) => reg.cells.forEach((c) => owner.set(key(c), i)));
  const used = new Array(NUM_REGION_COLORS).fill(0);
  const colors: number[] = [];
  regions.forEach((reg, i) => {
    const banned = new Set<number>();
    for (const c of reg.cells)
      for (const d of DIRS) {
        const j = owner.get(key(add(c, d)));
        if (j !== undefined && j < i) banned.add(colors[j]);
      }
    let best = -1;
    for (let k = 0; k < NUM_REGION_COLORS; k++)
      if (!banned.has(k) && (best < 0 || used[k] < used[best])) best = k;
    if (best < 0) best = i % NUM_REGION_COLORS;
    used[best]++;
    colors.push(best);
  });
  return regions.map((reg, i) => ({ ...reg, color: colors[i] }));
}

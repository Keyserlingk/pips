import type { Cell, Constraint, Difficulty, Domino, Placement, PuzzleOptions, Region } from '../model/types';
import { assignColors, fromIdx, newId, setSize, toIdx } from '../model/cells';
import { type Rng, mulberry32, pickWeighted, randInt, randomSeed, shuffle } from './rng';
import { randomShape } from './shape';
import { type SolveProblem, type SolveResult, solve } from './solver';
import { randomTiling, tileability } from './tiling';

/**
 * auto    – generate regions, constraints and dominoes
 * regions – keep the author's regions, generate constraints and dominoes
 * manual  – keep regions and constraints, search for a domino set that fits
 */
export type GenMode = 'auto' | 'regions' | 'manual';

export interface GenOptions extends PuzzleOptions {
  mode: GenMode;
  difficulty: Difficulty;
  seed?: number;
}

export interface Layout {
  width: number;
  height: number;
  cells: Cell[];
  regions: Region[];
}

export interface GenStats {
  /** 0 = none found, 1 = unique, 2 = more than one. */
  solutions: 0 | 1 | 2;
  /** True when the solver hit its node limit, so `solutions` is a lower bound. */
  aborted: boolean;
  nodes: number;
  rating: Difficulty;
}

export type GenResult =
  | { ok: true; regions: Region[]; dominoes: Domino[]; solution: Placement[]; stats: GenStats }
  | { ok: false; error: string };

const NODE_LIMIT = 1_500_000;

type EReg = { id: string; color: number; cells: number[]; constraint: Constraint };

export function fullSet(maxPip: number): Domino[] {
  const out: Domino[] = [];
  for (let a = 0; a <= maxPip; a++) for (let b = a; b <= maxPip; b++) out.push([a, b]);
  return out;
}

function trayTypes(dominoes: Domino[]) {
  const m = new Map<string, number>();
  const types: [number, number][] = [];
  const counts: number[] = [];
  for (const [x, y] of dominoes) {
    const a = Math.min(x, y);
    const b = Math.max(x, y);
    const k = `${a},${b}`;
    if (!m.has(k)) {
      m.set(k, types.length);
      types.push([a, b]);
      counts.push(0);
    }
    counts[m.get(k)!]++;
  }
  return { types, counts };
}

function problem(
  W: number,
  H: number,
  cells: number[],
  regs: EReg[],
  types: [number, number][],
  counts: number[],
  maxPip: number,
): SolveProblem {
  const regionOf = new Array(W * H).fill(-1);
  regs.forEach((reg, i) => reg.cells.forEach((c) => (regionOf[c] = i)));
  return { width: W, height: H, cells, regionOf, constraints: regs.map((r) => r.constraint), types, counts, maxPip };
}

export function rate(nodes: number, nCells: number): Difficulty {
  const perCell = nodes / Math.max(1, nCells);
  if (perCell < 12) return 'easy';
  if (perCell < 60) return 'medium';
  return 'hard';
}

const statsFrom = (res: SolveResult, nCells: number): GenStats => ({
  solutions: Math.min(2, res.solutions.length) as 0 | 1 | 2,
  aborted: res.aborted,
  nodes: res.nodes,
  rating: rate(res.nodes, nCells),
});

// ---------------------------------------------------------------- validation

export function validateLayout(layout: Layout, opts: PuzzleOptions): string | null {
  const n = layout.cells.length;
  if (n < 2) return 'Add some cells first.';
  if (n % 2) return `The board has ${n} cells; it needs an even number.`;
  const idx = layout.cells.map((c) => toIdx(c, layout.width));
  if (!tileability(layout.width, layout.height, idx).ok)
    return 'The board cannot be covered by dominoes (see highlighted cells).';
  if (!opts.allowDuplicates && n / 2 > setSize(opts.maxPip))
    return `A 0–${opts.maxPip} set only has ${setSize(opts.maxPip)} dominoes; this board needs ${n / 2}. Allow duplicates or use a bigger set.`;
  return null;
}

// ---------------------------------------------------------- regions & hints

const REGION_SIZES: Record<Difficulty, [number, number][]> = {
  easy: [[1, 3], [2, 4], [3, 3], [4, 1]],
  medium: [[1, 2], [2, 4], [3, 3], [4, 2]],
  hard: [[1, 1], [2, 3], [3, 3], [4, 2], [5, 1]],
};
const BLANK_FRACTION: Record<Difficulty, number> = { easy: 0.15, medium: 0.25, hard: 0.3 };

const HINT_WEIGHTS: Record<Difficulty, { sum: number; single: number; equal: number; distinct: number; ineq: number; slack: number }> = {
  easy: { sum: 3, single: 4, equal: 3, distinct: 1, ineq: 0.5, slack: 0 },
  medium: { sum: 2, single: 2, equal: 2, distinct: 2, ineq: 1.5, slack: 1 },
  hard: { sum: 1.5, single: 1, equal: 2, distinct: 2, ineq: 2.5, slack: 2 },
};

function growRegions(W: number, H: number, cells: number[], rng: Rng, diff: Difficulty) {
  const active = new Set(cells);
  const assigned = new Set<number>();
  const groups: { cells: number[]; blank: boolean }[] = [];
  for (const start of shuffle(rng, cells.slice())) {
    if (assigned.has(start)) continue;
    const size = pickWeighted(rng, REGION_SIZES[diff]);
    const group = [start];
    assigned.add(start);
    while (group.length < size) {
      const cand: number[] = [];
      for (const c of group) {
        const r = Math.floor(c / W);
        const col = c % W;
        const ns = [
          col + 1 < W ? c + 1 : -1,
          col > 0 ? c - 1 : -1,
          r + 1 < H ? c + W : -1,
          r > 0 ? c - W : -1,
        ];
        for (const n of ns) if (n >= 0 && active.has(n) && !assigned.has(n)) cand.push(n);
      }
      if (!cand.length) break;
      const pick = cand[Math.floor(rng() * cand.length)];
      group.push(pick);
      assigned.add(pick);
    }
    groups.push({ cells: group, blank: rng() < BLANK_FRACTION[diff] });
  }
  return groups;
}

function deriveConstraint(vals: number[], diff: Difficulty, rng: Rng, maxPip: number): Constraint {
  const w = HINT_WEIGHTS[diff];
  const n = vals.length;
  const s = vals.reduce((a, b) => a + b, 0);
  const opts: [Constraint, number][] = [[{ kind: 'sum', op: '=', value: s }, n === 1 ? w.single : w.sum]];
  if (n > 1 && vals.every((v) => v === vals[0])) opts.push([{ kind: 'equal' }, w.equal]);
  if (n > 1 && new Set(vals).size === n) opts.push([{ kind: 'distinct' }, w.distinct]);
  const slack = randInt(rng, 0, w.slack);
  if (s + 1 + slack <= n * maxPip) opts.push([{ kind: 'sum', op: '<', value: s + 1 + slack }, w.ineq]);
  if (s - 1 - slack >= 0) opts.push([{ kind: 'sum', op: '>', value: s - 1 - slack }, w.ineq]);
  return pickWeighted(rng, opts);
}

function components(W: number, cells: number[]): number[][] {
  const left = new Set(cells);
  const out: number[][] = [];
  for (const s of cells) {
    if (!left.has(s)) continue;
    const comp: number[] = [];
    const stack = [s];
    left.delete(s);
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const ns = [c % W !== W - 1 ? c + 1 : -1, c % W !== 0 ? c - 1 : -1, c + W, c - W];
      for (const n of ns)
        if (left.has(n)) {
          left.delete(n);
          stack.push(n);
        }
    }
    out.push(comp);
  }
  return out;
}

/**
 * Adds/tightens constraints until the fixed tray has a single solution
 * (by cell values). `allowCarve` lets it split regions into smaller ones.
 */
function uniquify(
  W: number,
  H: number,
  cells: number[],
  regs: EReg[],
  values: number[],
  tray: { types: [number, number][]; counts: number[] },
  maxPip: number,
  allowCarve: boolean,
  rng: Rng,
): SolveResult {
  const sumOf = (cs: number[], vals: number[]) => cs.reduce((s, c) => s + vals[c], 0);
  const exact = (cs: number[]): Constraint => ({ kind: 'sum', op: '=', value: sumOf(cs, values) });
  let res = solve(problem(W, H, cells, regs, tray.types, tray.counts, maxPip), { limit: 2, nodeLimit: NODE_LIMIT });
  for (let iter = 0; iter < 80; iter++) {
    if (res.aborted || res.solutions.length <= 1) return res;
    const alt = res.solutions.find((s) => cells.some((c) => s.values[c] !== values[c]));
    // Only the pairing differs: same numbers on every cell. Accept.
    if (!alt) return { ...res, solutions: res.solutions.slice(0, 1) };
    const diff = shuffle(rng, cells.filter((c) => alt.values[c] !== values[c]));
    let progressed = false;
    for (const d of diff) {
      const ri = regs.findIndex((r) => r.cells.includes(d));
      if (ri < 0) {
        regs.push({ id: newId(), color: 0, cells: [d], constraint: exact([d]) });
        progressed = true;
        break;
      }
      const reg = regs[ri];
      const isExact = reg.constraint.kind === 'sum' && reg.constraint.op === '=';
      if (!isExact && sumOf(reg.cells, alt.values) !== sumOf(reg.cells, values)) {
        reg.constraint = exact(reg.cells);
        progressed = true;
        break;
      }
      if (allowCarve && reg.cells.length > 1) {
        const rest = components(W, reg.cells.filter((c) => c !== d));
        regs.splice(
          ri,
          1,
          { id: newId(), color: 0, cells: [d], constraint: exact([d]) },
          ...rest.map((cs, i) => ({ id: i === 0 ? reg.id : newId(), color: 0, cells: cs, constraint: exact(cs) })),
        );
        progressed = true;
        break;
      }
    }
    if (!progressed) return res;
    res = solve(problem(W, H, cells, regs, tray.types, tray.counts, maxPip), { limit: 2, nodeLimit: NODE_LIMIT });
  }
  return res;
}

// ------------------------------------------------------------- conversions

function toRegions(W: number, regs: EReg[]): Region[] {
  return assignColors(
    regs.map((r) => ({ id: r.id, color: r.color, constraint: r.constraint, cells: r.cells.map((c) => fromIdx(c, W)) })),
  );
}

function placementsFrom(W: number, cells: number[], values: number[], partner: number[]): Placement[] {
  const out: Placement[] = [];
  for (const c of cells) {
    const p = partner[c];
    if (p > c) out.push({ a: fromIdx(c, W), b: fromIdx(p, W), pips: [values[c], values[p]] });
  }
  return out;
}

function trayFrom(placements: Placement[], rng: Rng): Domino[] {
  return shuffle(
    rng,
    placements.map((p) => (rng() < 0.5 ? [p.pips[0], p.pips[1]] : [p.pips[1], p.pips[0]]) as Domino),
  );
}

// -------------------------------------------------------------- generation

export function generate(layout: Layout, opts: GenOptions): GenResult {
  const err = validateLayout(layout, opts);
  if (err) return { ok: false, error: err };
  if (opts.mode === 'manual') return findDominoes(layout, opts);

  const rng = mulberry32(opts.seed ?? randomSeed());
  const { width: W, height: H } = layout;
  const cells = layout.cells.map((c) => toIdx(c, W));
  const order = ['easy', 'medium', 'hard'];
  const maxAttempts = opts.mode === 'auto' ? 10 : 6;
  let best: { result: GenResult & { ok: true }; score: number } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tiles = randomTiling(W, H, cells, rng);
    if (!tiles) continue;
    const doms: Domino[] = opts.allowDuplicates
      ? tiles.map(() => [randInt(rng, 0, opts.maxPip), randInt(rng, 0, opts.maxPip)])
      : shuffle(rng, fullSet(opts.maxPip)).slice(0, tiles.length);
    const values = new Array(W * H).fill(-1);
    const partner = new Array(W * H).fill(-1);
    tiles.forEach(([x, y], i) => {
      const [a, b] = rng() < 0.5 ? doms[i] : [doms[i][1], doms[i][0]];
      values[x] = a;
      values[y] = b;
      partner[x] = y;
      partner[y] = x;
    });

    const groups =
      opts.mode === 'auto'
        ? growRegions(W, H, cells, rng, opts.difficulty).filter((g) => !g.blank)
        : layout.regions.map((r) => ({ cells: r.cells.map((c) => toIdx(c, W)), id: r.id, color: r.color }));
    const regs: EReg[] = groups.map((g) => ({
      id: 'id' in g ? g.id : newId(),
      color: 'color' in g ? g.color : 0,
      cells: g.cells,
      constraint: deriveConstraint(g.cells.map((c) => values[c]), opts.difficulty, rng, opts.maxPip),
    }));

    const tray = trayTypes(doms);
    const res = opts.requireUnique
      ? uniquify(W, H, cells, regs, values, tray, opts.maxPip, opts.mode === 'auto', rng)
      : solve(problem(W, H, cells, regs, tray.types, tray.counts, opts.maxPip), { limit: 2, nodeLimit: NODE_LIMIT });
    const stats = statsFrom(res, cells.length);
    if (opts.requireUnique && stats.solutions !== 1) continue;

    const solution = placementsFrom(W, cells, values, partner);
    const result = {
      ok: true as const,
      regions: opts.mode === 'auto' ? toRegions(W, regs) : toRegionsKeepColors(W, regs, layout.regions),
      dominoes: trayFrom(solution, rng),
      solution,
      stats,
    };
    const score = Math.abs(order.indexOf(stats.rating) - order.indexOf(opts.difficulty)) + (stats.aborted ? 1 : 0);
    if (!best || score < best.score) best = { result, score };
    if (opts.mode !== 'auto' || score === 0) break;
  }

  if (best) return best.result;
  return {
    ok: false,
    error: opts.requireUnique
      ? 'Could not make a puzzle with a unique solution for these regions. Try smaller regions, or turn off "unique solution".'
      : 'Could not generate a puzzle for this board.',
  };
}

function toRegionsKeepColors(W: number, regs: EReg[], original: Region[]): Region[] {
  const known = new Set(original.map((r) => r.id));
  const out = regs.map((r) => ({
    id: r.id,
    color: r.color,
    constraint: r.constraint,
    cells: r.cells.map((c) => fromIdx(c, W)),
  }));
  // Regions the uniqueness step added get colours; the author's keep theirs.
  if (out.every((r) => known.has(r.id))) return out;
  const recoloured = assignColors(out);
  return out.map((r, i) => (known.has(r.id) ? r : recoloured[i]));
}

/** Manual mode: regions and constraints are fixed, search for a fitting domino set. */
export function findDominoes(layout: Layout, opts: GenOptions): GenResult {
  const rng = mulberry32(opts.seed ?? randomSeed());
  const { width: W, height: H } = layout;
  const cells = layout.cells.map((c) => toIdx(c, W));
  const regs: EReg[] = layout.regions.map((r) => ({
    id: r.id,
    color: r.color,
    constraint: r.constraint,
    cells: r.cells.map((c) => toIdx(c, W)),
  }));
  const types = fullSet(opts.maxPip) as [number, number][];
  const counts = types.map(() => (opts.allowDuplicates ? cells.length / 2 : 1));

  let fallback: GenResult | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = solve(problem(W, H, cells, regs, types, counts, opts.maxPip), { limit: 1, rng, nodeLimit: 3_000_000 });
    if (!found.solutions.length) {
      return {
        ok: false,
        error: found.aborted
          ? 'The search timed out. The constraints may be too tight or contradictory; try loosening some.'
          : 'No set of dominoes satisfies these constraints.',
      };
    }
    const sol = found.solutions[0];
    const solution = placementsFrom(W, cells, sol.values, sol.partner);
    const dominoes = trayFrom(solution, rng);
    const tray = trayTypes(dominoes);
    const check = solve(problem(W, H, cells, regs, tray.types, tray.counts, opts.maxPip), { limit: 2, nodeLimit: NODE_LIMIT });
    const result: GenResult = { ok: true, regions: layout.regions, dominoes, solution, stats: statsFrom(check, cells.length) };
    if (!opts.requireUnique || check.solutions.length === 1) return result;
    fallback ??= result;
  }
  return fallback!;
}

/** Counts solutions for an existing puzzle (used by the editor's Verify button). */
export function verify(layout: Layout, dominoes: Domino[], maxPip: number): GenResult {
  const W = layout.width;
  const cells = layout.cells.map((c) => toIdx(c, W));
  const regs: EReg[] = layout.regions.map((r) => ({ ...r, cells: r.cells.map((c) => toIdx(c, W)) }));
  const tray = trayTypes(dominoes);
  const res = solve(problem(W, layout.height, cells, regs, tray.types, tray.counts, maxPip), { limit: 2, nodeLimit: NODE_LIMIT });
  const first = res.solutions[0];
  return {
    ok: true,
    regions: layout.regions,
    dominoes,
    solution: first ? placementsFrom(W, cells, first.values, first.partner) : [],
    stats: statsFrom(res, cells.length),
  };
}

const QUICK_SIZE: Record<Difficulty, [number, number]> = { easy: [8, 12], medium: [12, 18], hard: [16, 24] };

/** A random board shape plus a fully generated puzzle. */
export function quickPuzzle(opts: Omit<GenOptions, 'mode'>) {
  const rng = mulberry32(opts.seed ?? randomSeed());
  const [lo, hi] = QUICK_SIZE[opts.difficulty];
  const n = randInt(rng, lo / 2, hi / 2) * 2;
  for (let i = 0; i < 5; i++) {
    const shape = randomShape(8, 8, n, rng);
    const res = generate({ ...shape, regions: [] }, { ...opts, mode: 'auto', seed: (rng() * 2 ** 32) >>> 0 });
    if (res.ok) return { ...shape, ...res };
  }
  return { ok: false as const, error: 'Could not generate a puzzle, please try again.' };
}

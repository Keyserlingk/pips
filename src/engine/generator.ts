import type { Cell, Constraint, Difficulty, Domino, ExtraKind, Placement, PuzzleOptions, Region } from '../model/types';
import { assignColors, fromIdx, newId, satisfies, setSize, toIdx } from '../model/cells';
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
/** Solver work a single uniqueness check may use; harder proofs mean the puzzle is too hard anyway. */
const UNIQUE_NODE_LIMIT = 400_000;
/** Total solver work one uniqueness pass may use before the attempt is dropped. */
const UNIQUIFY_BUDGET = 1_500_000;
/** Wall-clock budget for one generate() call. */
const TIME_BUDGET_MS = 3000;

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
const KEEP_SINGLE: Record<Difficulty, number> = { easy: 0.45, medium: 0.3, hard: 0.2 };
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
  // Leftover single cells mostly join their smallest neighbouring region.
  const owner = new Map<number, (typeof groups)[number]>();
  groups.forEach((g) => g.cells.forEach((c) => owner.set(c, g)));
  for (const g of groups) {
    if (g.cells.length !== 1 || rng() < KEEP_SINGLE[diff]) continue;
    const c = g.cells[0];
    const near = [c % W !== W - 1 ? c + 1 : -1, c % W !== 0 ? c - 1 : -1, c + W, c - W]
      .map((n) => owner.get(n))
      .filter((n): n is (typeof groups)[number] => !!n && n !== g && n.cells.length > 0 && n.cells.length < 5);
    if (!near.length) continue;
    const target = near.reduce((a, b) => (b.cells.length < a.cells.length ? b : a));
    target.cells.push(c);
    owner.set(c, target);
    g.cells = [];
  }
  return groups.filter((g) => g.cells.length);
}

const EXTRA_WEIGHTS: Record<Difficulty, Record<ExtraKind, number>> = {
  easy: { step: 1, product: 1, extreme: 1, sumParity: 0.3 },
  medium: { step: 1.5, product: 1.5, extreme: 1.5, sumParity: 0.7 },
  hard: { step: 2, product: 1.5, extreme: 2, sumParity: 1.2 },
};

/** Picks a constraint that the solution `values` (per grid index) satisfies on `cells`. */
function deriveConstraint(
  cells: number[],
  values: number[],
  W: number,
  diff: Difficulty,
  rng: Rng,
  maxPip: number,
  extras: ExtraKind[] = [],
): Constraint {
  const w = HINT_WEIGHTS[diff];
  const vals = cells.map((c) => values[c]);
  const n = vals.length;
  const s = vals.reduce((a, b) => a + b, 0);
  const opts: [Constraint, number][] = [[{ kind: 'sum', op: '=', value: s }, n === 1 ? w.single : w.sum]];
  if (n > 1 && vals.every((v) => v === vals[0])) opts.push([{ kind: 'equal' }, w.equal]);
  if (n > 1 && new Set(vals).size === n) opts.push([{ kind: 'distinct' }, w.distinct]);
  const slack = randInt(rng, 0, w.slack);
  if (s + 1 + slack <= n * maxPip) opts.push([{ kind: 'sum', op: '<', value: s + 1 + slack }, w.ineq]);
  if (s - 1 - slack >= 0) opts.push([{ kind: 'sum', op: '>', value: s - 1 - slack }, w.ineq]);

  if (n > 1) {
    const ew = EXTRA_WEIGHTS[diff];
    if (extras.includes('step')) {
      let maxGap = -1;
      for (const a of cells)
        for (const b of cells) {
          const adjacent = (b === a + 1 && a % W !== W - 1) || b === a + W;
          if (adjacent) maxGap = Math.max(maxGap, Math.abs(values[a] - values[b]));
        }
      const max = maxGap + randInt(rng, 0, Math.min(1, w.slack));
      if (maxGap >= 0 && max < maxPip) opts.push([{ kind: 'step', max }, ew.step]);
    }
    if (extras.includes('product')) opts.push([{ kind: 'product', value: vals.reduce((a, b) => a * b, 1) }, ew.product]);
    if (extras.includes('extreme')) {
      const which = rng() < 0.5 ? 'max' : 'min';
      opts.push([{ kind: 'extreme', which, value: which === 'max' ? Math.max(...vals) : Math.min(...vals) }, ew.extreme]);
    }
    if (extras.includes('sumParity')) opts.push([{ kind: 'sumParity', even: s % 2 === 0 }, ew.sumParity]);
  }
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
 * Exact constraints that hold for `values` on `cells` but not for `alt`, so
 * switching the region to one of them rules the alternative solution out.
 * Enabled extra kinds are preferred, so they survive the uniqueness step.
 */
function distinguishing(cells: number[], values: number[], alt: number[], W: number, extras: ExtraKind[]) {
  const vals = cells.map((c) => values[c]);
  const altVals = cells.map((c) => alt[c]);
  const pos = cells.map((c) => fromIdx(c, W));
  const n = cells.length;
  const out: [Constraint, number][] = [[{ kind: 'sum', op: '=', value: vals.reduce((a, b) => a + b, 0) }, 1]];
  if (n > 1) {
    if (vals.every((v) => v === vals[0])) out.push([{ kind: 'equal' }, 1.5]);
    if (new Set(vals).size === n) out.push([{ kind: 'distinct' }, 1.5]);
    if (extras.includes('step')) {
      let maxGap = -1;
      cells.forEach((a, i) =>
        cells.forEach((b, j) => {
          if ((b === a + 1 && a % W !== W - 1) || b === a + W) maxGap = Math.max(maxGap, Math.abs(vals[i] - vals[j]));
        }),
      );
      if (maxGap >= 0) out.push([{ kind: 'step', max: maxGap }, 2.5]);
    }
    if (extras.includes('product')) out.push([{ kind: 'product', value: vals.reduce((a, b) => a * b, 1) }, 2.5]);
    if (extras.includes('extreme')) {
      out.push([{ kind: 'extreme', which: 'max', value: Math.max(...vals) }, 2.5]);
      out.push([{ kind: 'extreme', which: 'min', value: Math.min(...vals) }, 2.5]);
    }
    if (extras.includes('sumParity')) out.push([{ kind: 'sumParity', even: vals.reduce((a, b) => a + b, 0) % 2 === 0 }, 2.5]);
  }
  return out.filter(([con]) => !satisfies(con, altVals, pos));
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
  extras: ExtraKind[] = [],
  deadline = Infinity,
): SolveResult {
  const sumOf = (cs: number[], vals: number[]) => cs.reduce((s, c) => s + vals[c], 0);
  const exact = (cs: number[]): Constraint => ({ kind: 'sum', op: '=', value: sumOf(cs, values) });
  const inGrid = new Set(cells);
  const regionIndex = (c: number) => regs.findIndex((r) => r.cells.includes(c));
  const nbrsOf = (c: number) => [c % W !== W - 1 ? c + 1 : -1, c % W !== 0 ? c - 1 : -1, c + W, c - W].filter((n) => inGrid.has(n));
  const blankNbrs = (c: number) => nbrsOf(c).filter((n) => regionIndex(n) < 0);
  const fixFor = (cs: number[], alt: number[]) => {
    const opts = distinguishing(cs, values, alt, W, extras);
    return opts.length ? pickWeighted(rng, opts) : null;
  };

  /** Rules the alternative out while keeping regions larger than one cell. */
  const repairNicely = (diff: number[], alt: number[]): boolean => {
    for (const d of diff) {
      const ri = regionIndex(d);
      if (ri >= 0) {
        const reg = regs[ri];
        const con = fixFor(reg.cells, alt);
        if (con) {
          reg.constraint = con;
          return true;
        }
        if (!allowCarve) continue;
        // Grow the region by one unconstrained neighbour.
        for (const e of shuffle(rng, reg.cells.flatMap(blankNbrs))) {
          const grown = fixFor([...reg.cells, e], alt);
          if (grown) {
            reg.cells = [...reg.cells, e];
            reg.constraint = grown;
            return true;
          }
        }
        const rest = reg.cells.filter((c) => c !== d);
        // Move d into a neighbouring region (values swapped inside a region need a border change).
        if (rest.length && components(W, rest).length === 1) {
          for (const n of shuffle(rng, nbrsOf(d))) {
            const rj = regionIndex(n);
            if (rj < 0 || rj === ri || regs[rj].cells.length >= 5) continue;
            const con = fixFor([...regs[rj].cells, d], alt);
            if (!con) continue;
            regs[rj].cells = [...regs[rj].cells, d];
            regs[rj].constraint = con;
            reg.cells = rest;
            reg.constraint = fixFor(rest, alt) ?? exact(rest);
            return true;
          }
        }
        // Split into two connected parts of at least two cells.
        if (reg.cells.length >= 4) {
          const others = reg.cells.filter((c) => c !== d);
          for (let mask = 0; mask < 1 << others.length; mask++) {
            const a = [d, ...others.filter((_, i) => mask & (1 << i))];
            const b = others.filter((_, i) => !(mask & (1 << i)));
            if (a.length < 2 || b.length < 2 || components(W, a).length > 1 || components(W, b).length > 1) continue;
            const ca = fixFor(a, alt);
            const cb = fixFor(b, alt);
            if (!ca && !cb) continue;
            regs.splice(ri, 1, { ...reg, cells: a, constraint: ca ?? exact(a) }, { id: newId(), color: 0, cells: b, constraint: cb ?? exact(b) });
            return true;
          }
        }
        continue;
      }
      // Unconstrained cell: group it with unconstrained neighbours into a new region.
      const group = [d];
      while (group.length < 3) {
        const next = shuffle(rng, group.flatMap(blankNbrs).filter((n) => !group.includes(n)))[0];
        if (next === undefined) break;
        group.push(next);
        const con = fixFor(group, alt);
        if (con) {
          regs.push({ id: newId(), color: 0, cells: group.slice(), constraint: con });
          return true;
        }
      }
      // Or attach it to a neighbouring region.
      if (allowCarve)
        for (const n of shuffle(rng, nbrsOf(d))) {
          const ri2 = regionIndex(n);
          if (ri2 < 0) continue;
          const con = fixFor([...regs[ri2].cells, d], alt);
          if (con) {
            regs[ri2].cells = [...regs[ri2].cells, d];
            regs[ri2].constraint = con;
            return true;
          }
        }
    }
    return false;
  };

  /** Last resort: give away a single cell's value, splitting its region if needed. */
  const repairBluntly = (diff: number[]): boolean => {
    for (const d of diff) {
      const ri = regionIndex(d);
      if (ri < 0) {
        regs.push({ id: newId(), color: 0, cells: [d], constraint: exact([d]) });
        return true;
      }
      const reg = regs[ri];
      if (allowCarve && reg.cells.length > 1) {
        const rest = components(W, reg.cells.filter((c) => c !== d));
        regs.splice(
          ri,
          1,
          { id: newId(), color: 0, cells: [d], constraint: exact([d]) },
          ...rest.map((cs, i) => ({ id: i === 0 ? reg.id : newId(), color: 0, cells: cs, constraint: exact(cs) })),
        );
        return true;
      }
    }
    return false;
  };

  let res = solve(problem(W, H, cells, regs, tray.types, tray.counts, maxPip), { limit: 2, nodeLimit: UNIQUE_NODE_LIMIT, distinctValues: true });
  let spent = res.nodes;
  for (let iter = 0; iter < 80; iter++) {
    if (res.aborted || res.solutions.length <= 1) return res;
    if (spent > UNIQUIFY_BUDGET || Date.now() > deadline) return { ...res, aborted: true };
    const alt = res.solutions.find((s) => cells.some((c) => s.values[c] !== values[c]));
    // Only the pairing differs: same numbers on every cell. Accept.
    if (!alt) return { ...res, solutions: res.solutions.slice(0, 1) };
    const diff = shuffle(rng, cells.filter((c) => alt.values[c] !== values[c]));
    // Border-preserving repairs keep the puzzle open (and the proof expensive);
    // once half the budget is gone, converge with the blunt ones.
    const progressed =
      spent < UNIQUIFY_BUDGET / 2
        ? repairNicely(diff, alt.values) || repairBluntly(diff)
        : repairBluntly(diff) || repairNicely(diff, alt.values);
    if (!progressed) return res;
    res = solve(problem(W, H, cells, regs, tray.types, tray.counts, maxPip), { limit: 2, nodeLimit: UNIQUE_NODE_LIMIT, distinctValues: true });
    spent += res.nodes;
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

export function generate(layout: Layout, opts: GenOptions, deadline = Date.now() + TIME_BUDGET_MS): GenResult {
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
    if (Date.now() > deadline && attempt > 0) break;
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
      constraint: deriveConstraint(g.cells, values, W, opts.difficulty, rng, opts.maxPip, opts.extras),
    }));

    const tray = trayTypes(doms);
    const res = opts.requireUnique
      ? uniquify(W, H, cells, regs, values, tray, opts.maxPip, opts.mode === 'auto', rng, opts.extras, deadline)
      : solve(problem(W, H, cells, regs, tray.types, tray.counts, opts.maxPip), { limit: 2, nodeLimit: NODE_LIMIT, distinctValues: true });
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
    const check = solve(problem(W, H, cells, regs, tray.types, tray.counts, opts.maxPip), { limit: 2, nodeLimit: NODE_LIMIT, distinctValues: true });
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
  const res = solve(problem(W, layout.height, cells, regs, tray.types, tray.counts, maxPip), { limit: 2, nodeLimit: NODE_LIMIT, distinctValues: true });
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
  const deadline = Date.now() + TIME_BUDGET_MS * 1.5;
  for (let i = 0; i < 5 && (i === 0 || Date.now() < deadline); i++) {
    const shape = randomShape(8, 8, n, rng);
    const res = generate({ ...shape, regions: [] }, { ...opts, mode: 'auto', seed: (rng() * 2 ** 32) >>> 0 }, deadline);
    if (res.ok) return { ...shape, ...res };
  }
  return { ok: false as const, error: 'Could not generate a puzzle, please try again.' };
}

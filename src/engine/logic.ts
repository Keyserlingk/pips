import type { Cell, Constraint, Difficulty } from '../model/types';
import { satisfies } from '../model/cells';

/**
 * A "human" solver used to grade puzzles. It never guesses; it only applies
 * deductions, grouped in levels:
 *
 *   1  basic      – a cell only one placement can cover, a domino that only
 *                   fits one place, region rules narrowing a cell's numbers
 *   2  counting   – a placement that would strand a neighbouring cell, and
 *                   counting how many of each number are left in the tray
 *   3  lookahead  – "if this domino went here, it would lead to a contradiction"
 *
 * A puzzle level 3 can't finish needs deeper lookahead.
 */

export interface LogicProblem {
  width: number;
  height: number;
  /** Grid indices (r * width + c). */
  cells: number[];
  /** Region index per grid index, -1 when the cell has no region. */
  regionOf: number[];
  constraints: Constraint[];
  /** The tray, one entry per physical domino. */
  dominoes: [number, number][];
}

export interface LogicResult {
  solved: boolean;
  /** Highest deduction level needed (4 = level 3 got stuck). */
  level: 1 | 2 | 3 | 4;
  /** Number of lookahead deductions used. */
  lookaheads: number;
  /** The number deduced for each cell (in `cells` order), -1 if unknown. */
  values: number[];
  /** The level at which each cell's number was worked out (5 = never). */
  knownAt: number[];
  grade: Difficulty;
}

const bit = (v: number) => 1 << v;
const GAC_LEAF_LIMIT = 20_000;

interface Model {
  n: number;
  nbrs: number[][];
  // Placements: domino pd[p] with value pva[p] on cell pa[p], pvb[p] on pb[p].
  pa: Int32Array;
  pb: Int32Array;
  pva: Int8Array;
  pvb: Int8Array;
  pd: Int32Array;
  byCell: number[][];
  byDomino: number[][];
  dominoes: [number, number][];
  regionCells: number[][];
  regionPos: Cell[][];
  regionOfLocal: Int32Array;
  constraints: Constraint[];
}

interface State {
  alive: Uint8Array;
  cand: Int32Array;
  value: Int8Array;
  used: Uint8Array;
  covered: number;
}

const clone = (s: State): State => ({
  alive: s.alive.slice(),
  cand: s.cand.slice(),
  value: s.value.slice(),
  used: s.used.slice(),
  covered: s.covered,
});

function buildModel(p: LogicProblem): Model {
  const W = p.width;
  const local = new Map(p.cells.map((c, i) => [c, i]));
  const n = p.cells.length;
  const nbrs: number[][] = p.cells.map((c) => {
    const out: number[] = [];
    const r = Math.floor(c / W);
    const col = c % W;
    for (const [nr, nc] of [[r, col + 1], [r + 1, col], [r, col - 1], [r - 1, col]]) {
      if (nr < 0 || nc < 0 || nr >= p.height || nc >= W) continue;
      const j = local.get(nr * W + nc);
      if (j !== undefined) out.push(j);
    }
    return out;
  });
  const pa: number[] = [];
  const pb: number[] = [];
  const pva: number[] = [];
  const pvb: number[] = [];
  const pd: number[] = [];
  p.dominoes.forEach(([x, y], d) => {
    for (let a = 0; a < n; a++)
      for (const b of nbrs[a]) {
        if (b < a) continue;
        for (const [va, vb] of x === y ? [[x, y]] : [[x, y], [y, x]]) {
          pa.push(a);
          pb.push(b);
          pva.push(va);
          pvb.push(vb);
          pd.push(d);
        }
      }
  });
  const byCell: number[][] = Array.from({ length: n }, () => []);
  const byDomino: number[][] = p.dominoes.map(() => []);
  pa.forEach((a, i) => {
    byCell[a].push(i);
    byCell[pb[i]].push(i);
    byDomino[pd[i]].push(i);
  });
  const regionCells: number[][] = p.constraints.map(() => []);
  const regionOfLocal = new Int32Array(n).fill(-1);
  p.cells.forEach((c, i) => {
    const r = p.regionOf[c];
    if (r >= 0) {
      regionCells[r].push(i);
      regionOfLocal[i] = r;
    }
  });
  const regionPos = regionCells.map((cs) => cs.map((i) => ({ r: Math.floor(p.cells[i] / W), c: p.cells[i] % W })));
  return {
    n,
    nbrs,
    pa: Int32Array.from(pa),
    pb: Int32Array.from(pb),
    pva: Int8Array.from(pva),
    pvb: Int8Array.from(pvb),
    pd: Int32Array.from(pd),
    byCell,
    byDomino,
    dominoes: p.dominoes,
    regionCells,
    regionPos,
    regionOfLocal,
    constraints: p.constraints,
  };
}

function initialState(m: Model): State {
  const cand = new Int32Array(m.n);
  for (let p = 0; p < m.pa.length; p++) {
    cand[m.pa[p]] |= bit(m.pva[p]);
    cand[m.pb[p]] |= bit(m.pvb[p]);
  }
  return {
    alive: new Uint8Array(m.pa.length).fill(1),
    cand,
    value: new Int8Array(m.n).fill(-1),
    used: new Uint8Array(m.dominoes.length),
    covered: 0,
  };
}

function place(m: Model, s: State, p: number) {
  const a = m.pa[p];
  const b = m.pb[p];
  for (const q of m.byCell[a]) s.alive[q] = 0;
  for (const q of m.byCell[b]) s.alive[q] = 0;
  for (const q of m.byDomino[m.pd[p]]) s.alive[q] = 0;
  s.value[a] = m.pva[p];
  s.value[b] = m.pvb[p];
  s.cand[a] = bit(m.pva[p]);
  s.cand[b] = bit(m.pvb[p]);
  s.used[m.pd[p]] = 1;
  s.covered += 2;
}

/** Values each region cell can take in some assignment that satisfies the rule; null = none. */
function regionSupport(m: Model, s: State, r: number): number[] | null {
  const cells = m.regionCells[r];
  const con = m.constraints[r];
  const k = cells.length;
  const support = new Array(k).fill(0);
  const vals = new Array(k).fill(0);
  const options = cells.map((c) => {
    const out: number[] = [];
    for (let v = 0; v < 31; v++) if (s.cand[c] & bit(v)) out.push(v);
    return out;
  });
  let leaves = 0;
  let any = false;
  const full = cells.map((c) => s.cand[c]);
  const dfs = (i: number): boolean => {
    if (i === k) {
      if (++leaves > GAC_LEAF_LIMIT) return false;
      if (satisfies(con, vals, m.regionPos[r])) {
        any = true;
        for (let j = 0; j < k; j++) support[j] |= bit(vals[j]);
      }
      return true;
    }
    for (const v of options[i]) {
      vals[i] = v;
      if (!dfs(i + 1)) return false;
    }
    return true;
  };
  if (!dfs(0)) return full; // too big to enumerate: no pruning
  return any ? support : null;
}

/** Level 1 (and 2 when allowed) to a fixpoint. Returns false on a contradiction. */
function propagate(m: Model, s: State, level: 1 | 2): boolean {
  const dirty = new Uint8Array(m.constraints.length).fill(1);
  for (;;) {
    let changed = false;

    for (let c = 0; c < m.n; c++) {
      if (s.value[c] >= 0) continue;
      let only = -1;
      let count = 0;
      for (const p of m.byCell[c])
        if (s.alive[p]) {
          only = p;
          if (++count > 1) break;
        }
      if (count === 0) return false;
      if (count === 1) {
        place(m, s, only);
        markDirty(m, dirty, only);
        changed = true;
      }
    }
    for (let d = 0; d < m.dominoes.length; d++) {
      if (s.used[d]) continue;
      let only = -1;
      let count = 0;
      for (const p of m.byDomino[d])
        if (s.alive[p]) {
          only = p;
          if (++count > 1) break;
        }
      if (count === 0) return false;
      if (count === 1) {
        place(m, s, only);
        markDirty(m, dirty, only);
        changed = true;
      }
    }

    // Candidate numbers per cell, from the placements still possible.
    const next = new Int32Array(m.n);
    for (let p = 0; p < m.pa.length; p++)
      if (s.alive[p]) {
        next[m.pa[p]] |= bit(m.pva[p]);
        next[m.pb[p]] |= bit(m.pvb[p]);
      }
    for (let c = 0; c < m.n; c++) {
      if (s.value[c] >= 0) continue;
      const v = next[c] & s.cand[c];
      if (!v) return false;
      if (v !== s.cand[c]) {
        s.cand[c] = v;
        if (m.regionOfLocal[c] >= 0) dirty[m.regionOfLocal[c]] = 1;
      }
    }

    for (let r = 0; r < m.constraints.length; r++) {
      if (!dirty[r]) continue;
      dirty[r] = 0;
      if (m.constraints[r].kind === 'none') continue;
      const sup = regionSupport(m, s, r);
      if (!sup) return false;
      m.regionCells[r].forEach((c, j) => {
        const v = s.cand[c] & sup[j];
        if (v !== s.cand[c]) {
          s.cand[c] = v;
          changed = true;
        }
      });
    }

    if (level >= 2 && !changed) {
      const res = counting(m, s);
      if (res === 'contradiction') return false;
      if (res === 'progress') changed = true;
    }

    // Drop placements that contradict the candidates.
    for (let p = 0; p < m.pa.length; p++)
      if (s.alive[p] && (!(s.cand[m.pa[p]] & bit(m.pva[p])) || !(s.cand[m.pb[p]] & bit(m.pvb[p])))) {
        s.alive[p] = 0;
        changed = true;
      }

    if (!changed) return true;
  }
}

function markDirty(m: Model, dirty: Uint8Array, p: number) {
  const ra = m.regionOfLocal[m.pa[p]];
  const rb = m.regionOfLocal[m.pb[p]];
  if (ra >= 0) dirty[ra] = 1;
  if (rb >= 0) dirty[rb] = 1;
}

/** Level 2 deductions. */
function counting(m: Model, s: State): 'progress' | 'none' | 'contradiction' {
  let progress = false;
  // A placement that leaves a neighbouring cell with nothing to cover it.
  for (let p = 0; p < m.pa.length; p++) {
    if (!s.alive[p]) continue;
    const a = m.pa[p];
    const b = m.pb[p];
    const d = m.pd[p];
    let strands = false;
    for (const x of [a, b]) {
      for (const nb of m.nbrs[x]) {
        if (nb === a || nb === b || s.value[nb] >= 0) continue;
        let ok = false;
        for (const q of m.byCell[nb]) {
          if (!s.alive[q] || m.pd[q] === d) continue;
          const qa = m.pa[q];
          const qb = m.pb[q];
          if (qa === a || qa === b || qb === a || qb === b) continue;
          ok = true;
          break;
        }
        if (!ok) strands = true;
      }
    }
    if (strands) {
      s.alive[p] = 0;
      progress = true;
    }
  }
  // Number supply: cells that must show v can't outnumber the v-halves left.
  let maxV = 0;
  for (const [x, y] of m.dominoes) maxV = Math.max(maxV, x, y);
  for (let v = 0; v <= maxV; v++) {
    let supply = 0;
    m.dominoes.forEach(([x, y], d) => {
      if (s.used[d]) return;
      if (x === v) supply++;
      if (y === v) supply++;
    });
    let need = 0;
    for (let c = 0; c < m.n; c++) if (s.value[c] < 0 && s.cand[c] === bit(v)) need++;
    if (need > supply) return 'contradiction';
    if (need === supply)
      for (let c = 0; c < m.n; c++)
        if (s.value[c] < 0 && s.cand[c] !== bit(v) && s.cand[c] & bit(v)) {
          s.cand[c] &= ~bit(v);
          progress = true;
        }
  }
  return progress ? 'progress' : 'none';
}

/** Level 3: find one placement whose consequences contradict, and rule it out. */
function lookahead(m: Model, s: State): boolean {
  const order: [number, number][] = [];
  for (let c = 0; c < m.n; c++) {
    if (s.value[c] >= 0) continue;
    let count = 0;
    for (const p of m.byCell[c]) if (s.alive[p]) count++;
    order.push([count, c]);
  }
  order.sort((x, y) => x[0] - y[0]);
  for (const [, c] of order)
    for (const p of m.byCell[c]) {
      if (!s.alive[p]) continue;
      const t = clone(s);
      place(m, t, p);
      if (!propagate(m, t, 2)) {
        s.alive[p] = 0;
        return true;
      }
    }
  return false;
}

export function gradeLogic(problem: LogicProblem): LogicResult {
  const m = buildModel(problem);
  const s = initialState(m);
  let level: LogicResult['level'] = 1;
  let lookaheads = 0;
  // Solved once every cell's number is known; which way identical numbers pair
  // up doesn't matter to the player (the win check only looks at the rules).
  const determined = () => s.cand.every((v) => (v & (v - 1)) === 0);
  const knownAt = new Array(m.n).fill(5);
  const stamp = () => s.cand.forEach((v, i) => knownAt[i] === 5 && (v & (v - 1)) === 0 && (knownAt[i] = level));
  for (;;) {
    const ok = propagate(m, s, 1);
    stamp();
    if (!ok) break;
    if (determined()) break;
    const before = clone(s);
    if (!propagate(m, s, 2)) break;
    if (changedState(before, s)) {
      level = Math.max(level, 2) as LogicResult['level'];
      continue;
    }
    if (lookahead(m, s)) {
      level = 3;
      lookaheads++;
      continue;
    }
    level = 4;
    break;
  }
  const solved = determined();
  return { solved, level, lookaheads, knownAt, values: Array.from(s.cand, (v) => (v & (v - 1) ? -1 : Math.log2(v))), grade: gradeOf(level, lookaheads) };
}

function changedState(a: State, b: State) {
  if (a.covered !== b.covered) return true;
  for (let i = 0; i < a.cand.length; i++) if (a.cand[i] !== b.cand[i]) return true;
  for (let i = 0; i < a.alive.length; i++) if (a.alive[i] !== b.alive[i]) return true;
  return false;
}

/** Thresholds for the lookahead count; tuned by measuring generated puzzles. */
export const EXPERT_LOOKAHEADS = 3;

function gradeOf(level: LogicResult['level'], lookaheads: number): Difficulty {
  if (level === 1) return 'easy';
  if (level === 2) return 'medium';
  if (level === 3 && lookaheads < EXPERT_LOOKAHEADS) return 'hard';
  return 'expert';
}

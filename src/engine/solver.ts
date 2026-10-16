import type { Constraint } from '../model/types';
import { type Rng, shuffle } from './rng';

/** Engine-level problem: cells are grid indices (r * width + c). */
export interface SolveProblem {
  width: number;
  height: number;
  cells: number[];
  /** Region index per grid index, -1 when the cell has no region. */
  regionOf: number[];
  constraints: Constraint[];
  /** Distinct domino types. */
  types: [number, number][];
  /** How many of each type are available. */
  counts: number[];
  maxPip: number;
}

export interface SolveOptions {
  /** Stop after this many solutions. */
  limit?: number;
  /** Give up after this many placements. */
  nodeLimit?: number;
  /** Randomise branch order (used when searching for a domino set). */
  rng?: Rng;
}

export interface Solution {
  values: number[];
  partner: number[];
}

export interface SolveResult {
  solutions: Solution[];
  nodes: number;
  aborted: boolean;
}

export function solve(p: SolveProblem, opts: SolveOptions = {}): SolveResult {
  const limit = opts.limit ?? 1;
  const nodeLimit = opts.nodeLimit ?? 2_000_000;
  const rng = opts.rng;
  const W = p.width;
  const N = p.width * p.height;
  const P = p.maxPip + 1;

  const active = new Uint8Array(N);
  for (const c of p.cells) active[c] = 1;
  const nbrs: number[][] = Array.from({ length: N }, () => []);
  for (const c of p.cells) {
    const r = Math.floor(c / W);
    const col = c % W;
    if (col + 1 < W && active[c + 1]) nbrs[c].push(c + 1);
    if (r + 1 < p.height && active[c + W]) nbrs[c].push(c + W);
    if (col > 0 && active[c - 1]) nbrs[c].push(c - 1);
    if (r > 0 && active[c - W]) nbrs[c].push(c - W);
  }

  const value = new Int32Array(N).fill(-1);
  const partner = new Int32Array(N).fill(-1);
  const counts = p.counts.slice();
  // Number of still-unplaced domino halves showing each pip value.
  const pipCount = new Int32Array(P);
  p.types.forEach(([a, b], t) => {
    pipCount[a] += counts[t];
    pipCount[b] += counts[t];
  });

  const R = p.constraints.length;
  const rSize = new Int32Array(R);
  const rFilled = new Int32Array(R);
  const rSum = new Int32Array(R);
  const rVals = new Int32Array(R * P);
  const rDistinct = new Int32Array(R);
  for (const c of p.cells) if (p.regionOf[c] >= 0) rSize[p.regionOf[c]]++;
  const constrained: number[] = [];
  p.constraints.forEach((con, r) => con.kind !== 'none' && constrained.push(r));

  const smallest = (k: number) => {
    let s = 0;
    for (let v = 0; v < P && k > 0; v++) {
      const take = Math.min(k, pipCount[v]);
      s += take * v;
      k -= take;
    }
    return k > 0 ? Infinity : s;
  };
  const largest = (k: number) => {
    let s = 0;
    for (let v = P - 1; v >= 0 && k > 0; v--) {
      const take = Math.min(k, pipCount[v]);
      s += take * v;
      k -= take;
    }
    return k > 0 ? -Infinity : s;
  };

  const regionOk = (r: number): boolean => {
    const con = p.constraints[r];
    const k = rSize[r] - rFilled[r];
    switch (con.kind) {
      case 'none':
        return true;
      case 'sum': {
        const lo = rSum[r] + smallest(k);
        const hi = rSum[r] + largest(k);
        if (con.op === '=') return lo <= con.value && con.value <= hi;
        if (con.op === '<') return lo < con.value;
        return hi > con.value;
      }
      case 'equal': {
        if (rDistinct[r] > 1) return false;
        if (k === 0) return true;
        if (rFilled[r] > 0) {
          for (let v = 0; v < P; v++) if (rVals[r * P + v] > 0) return pipCount[v] >= k;
        }
        for (let v = 0; v < P; v++) if (pipCount[v] >= k) return true;
        return false;
      }
      case 'distinct': {
        if (rDistinct[r] !== rFilled[r]) return false;
        if (k === 0) return true;
        let avail = 0;
        for (let v = 0; v < P; v++) if (rVals[r * P + v] === 0 && pipCount[v] > 0) avail++;
        return avail >= k;
      }
    }
  };

  const setCell = (c: number, v: number, sign: 1 | -1) => {
    value[c] = sign > 0 ? v : -1;
    const r = p.regionOf[c];
    if (r < 0) return;
    rFilled[r] += sign;
    rSum[r] += sign * v;
    const i = r * P + v;
    if (sign > 0) {
      if (rVals[i]++ === 0) rDistinct[r]++;
    } else if (--rVals[i] === 0) rDistinct[r]--;
  };

  const allOk = () => {
    for (const r of constrained) if (!regionOk(r)) return false;
    return true;
  };

  const solutions: Solution[] = [];
  let nodes = 0;
  let aborted = false;
  let remaining = p.cells.length;
  const typeOrder = p.types.map((_, i) => i);

  const search = (): void => {
    if (remaining === 0) {
      solutions.push({ values: Array.from(value), partner: Array.from(partner) });
      return;
    }
    // Most constrained uncovered cell first.
    let best = -1;
    let bestDeg = 5;
    for (const c of p.cells) {
      if (value[c] !== -1) continue;
      let d = 0;
      for (const n of nbrs[c]) if (value[n] === -1) d++;
      if (d < bestDeg) {
        bestDeg = d;
        best = c;
        if (d === 0) return;
      }
    }
    const ns = nbrs[best].filter((n) => value[n] === -1);
    const order = rng ? shuffle(rng, typeOrder.slice()) : typeOrder;
    if (rng) shuffle(rng, ns);
    for (const n of ns) {
      for (const t of order) {
        if (counts[t] === 0) continue;
        const [a, b] = p.types[t];
        for (let o = 0; o < (a === b ? 1 : 2); o++) {
          const x = o ? b : a;
          const y = o ? a : b;
          if (++nodes > nodeLimit) {
            aborted = true;
            return;
          }
          counts[t]--;
          pipCount[a]--;
          pipCount[b]--;
          setCell(best, x, 1);
          setCell(n, y, 1);
          partner[best] = n;
          partner[n] = best;
          remaining -= 2;
          if (allOk()) search();
          remaining += 2;
          partner[best] = -1;
          partner[n] = -1;
          setCell(n, y, -1);
          setCell(best, x, -1);
          counts[t]++;
          pipCount[a]++;
          pipCount[b]++;
          if (aborted || solutions.length >= limit) return;
        }
      }
    }
  };

  if (allOk()) search();
  return { solutions, nodes, aborted };
}

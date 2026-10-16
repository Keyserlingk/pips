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
  /**
   * Count solutions that differ only in how dominoes are paired, but show the
   * same number on every cell, as one. The player only sees the numbers.
   */
  distinctValues?: boolean;
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
      case 'step': // checked per placed cell by stepOk
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
      case 'product': {
        if (rVals[r * P] > 0) return con.value === 0;
        if (con.value === 0) return k > 0 && pipCount[0] > 0;
        let prod = 1;
        for (let v = 2; v < P; v++) if (rVals[r * P + v]) prod *= v ** rVals[r * P + v];
        if (con.value % prod !== 0) return false;
        const q = con.value / prod;
        if (k === 0) return q === 1;
        // Remaining cells must be non-zero and multiply to q.
        let lo = 0;
        let hi = 0;
        for (let v = 1; v < P; v++)
          if (pipCount[v] > 0) {
            if (!lo) lo = v;
            hi = v;
          }
        return lo > 0 && lo ** k <= q && q <= hi ** k;
      }
      case 'extreme': {
        const target = con.value;
        const isMax = con.which === 'max';
        if (target < 0 || target >= P) return false;
        // No placed value may lie beyond the target.
        for (let v = isMax ? target + 1 : 0; isMax ? v < P : v < target; v++) if (rVals[r * P + v] > 0) return false;
        if (k === 0) return rVals[r * P + target] > 0;
        let fits = false;
        for (let v = isMax ? 0 : target; isMax ? v <= target : v < P; v++) if (pipCount[v] > 0) fits = true;
        if (!fits) return false;
        return rVals[r * P + target] > 0 || pipCount[target] > 0;
      }
      case 'sumParity': {
        const want = con.even ? 0 : 1;
        if (k === 0) return rSum[r] % 2 === want;
        let hasEven = false;
        let hasOdd = false;
        for (let v = 0; v < P; v++)
          if (pipCount[v] > 0) {
            if (v % 2) hasOdd = true;
            else hasEven = true;
          }
        if (hasEven && hasOdd) return true;
        if (hasEven) return rSum[r] % 2 === want;
        if (hasOdd) return (rSum[r] + k) % 2 === want;
        return false;
      }
    }
  };

  // Same-region neighbours of each cell whose region has a step rule.
  const stepNbrs: number[][] = Array.from({ length: N }, () => []);
  const stepMax = new Int32Array(N);
  for (const c of p.cells) {
    const con = p.regionOf[c] >= 0 ? p.constraints[p.regionOf[c]] : null;
    if (con?.kind !== 'step') continue;
    stepMax[c] = con.max;
    stepNbrs[c] = nbrs[c].filter((n) => p.regionOf[n] === p.regionOf[c]);
  }
  const stepOk = (c: number) => {
    for (const n of stepNbrs[c]) if (value[n] !== -1 && Math.abs(value[c] - value[n]) > stepMax[c]) return false;
    return true;
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
  const seenValues = new Set<string>();
  let nodes = 0;
  let aborted = false;
  let remaining = p.cells.length;
  const typeOrder = p.types.map((_, i) => i);

  const search = (): void => {
    if (remaining === 0) {
      if (opts.distinctValues) {
        const k = value.join(',');
        if (seenValues.has(k)) return;
        seenValues.add(k);
      }
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
          if (stepOk(best) && stepOk(n) && allOk()) search();
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

import { type Rng, shuffle } from './rng';

function neighbours(W: number, H: number, active: Uint8Array, c: number): number[] {
  const r = Math.floor(c / W);
  const col = c % W;
  const out: number[] = [];
  if (col + 1 < W && active[c + 1]) out.push(c + 1);
  if (r + 1 < H && active[c + W]) out.push(c + W);
  if (col > 0 && active[c - 1]) out.push(c - 1);
  if (r > 0 && active[c - W]) out.push(c - W);
  return out;
}

function activeMask(W: number, H: number, cells: number[]) {
  const a = new Uint8Array(W * H);
  for (const c of cells) a[c] = 1;
  return a;
}

/**
 * Checks whether the shape can be covered by dominoes (perfect matching per
 * connected component). Returns the cells of every component that cannot.
 */
export function tileability(W: number, H: number, cells: number[]): { ok: boolean; badCells: number[] } {
  const active = activeMask(W, H, cells);
  const seen = new Uint8Array(W * H);
  const match = new Int32Array(W * H).fill(-1);
  const badCells: number[] = [];

  for (const start of cells) {
    if (seen[start]) continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      for (const n of neighbours(W, H, active, c))
        if (!seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
    }
    const black = comp.filter((c) => (Math.floor(c / W) + (c % W)) % 2 === 0);
    if (comp.length % 2 === 1 || black.length * 2 !== comp.length) {
      badCells.push(...comp);
      continue;
    }
    let matched = 0;
    for (const u of black) {
      const visited = new Set<number>();
      const tryAugment = (x: number): boolean => {
        for (const y of neighbours(W, H, active, x)) {
          if (visited.has(y)) continue;
          visited.add(y);
          if (match[y] === -1 || tryAugment(match[y])) {
            match[y] = x;
            return true;
          }
        }
        return false;
      };
      if (tryAugment(u)) matched++;
    }
    if (matched * 2 !== comp.length) badCells.push(...comp);
  }
  return { ok: badCells.length === 0, badCells };
}

/** A random domino tiling of the shape, or null if none was found. */
export function randomTiling(
  W: number,
  H: number,
  cells: number[],
  rng: Rng,
  nodeLimit = 200_000,
): [number, number][] | null {
  const active = activeMask(W, H, cells);
  const nbrs = new Map(cells.map((c) => [c, neighbours(W, H, active, c)]));
  const covered = new Uint8Array(W * H);
  const pairs: [number, number][] = [];
  let nodes = 0;

  const search = (): boolean => {
    let best = -1;
    let bestDeg = 5;
    for (const c of cells) {
      if (covered[c]) continue;
      let d = 0;
      for (const n of nbrs.get(c)!) if (!covered[n]) d++;
      // Random tie-breaking keeps the tilings varied.
      if (d < bestDeg || (d === bestDeg && rng() < 0.3)) {
        bestDeg = d;
        best = c;
      }
    }
    if (best < 0) return true;
    if (bestDeg === 0 || ++nodes > nodeLimit) return false;
    for (const n of shuffle(rng, nbrs.get(best)!.filter((x) => !covered[x]))) {
      covered[best] = covered[n] = 1;
      pairs.push([best, n]);
      if (search()) return true;
      pairs.pop();
      covered[best] = covered[n] = 0;
    }
    return false;
  };
  return search() ? pairs : null;
}

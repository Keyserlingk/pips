import type { Cell } from '../model/types';
import { type Rng, pickWeighted } from './rng';

/**
 * Grows a random, always-tileable shape by repeatedly attaching a domino
 * to the existing blob. Returns cells normalised to the top-left corner.
 */
export function randomShape(maxW: number, maxH: number, nCells: number, rng: Rng) {
  const W = maxW;
  const H = maxH;
  const inShape = new Uint8Array(W * H);
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < H && c < W;
  const isIn = (r: number, c: number) => inside(r, c) && inShape[r * W + c] === 1;
  const adj = (r: number, c: number) =>
    +isIn(r + 1, c) + +isIn(r - 1, c) + +isIn(r, c + 1) + +isIn(r, c - 1);

  const r0 = Math.floor(H / 2);
  const c0 = Math.max(0, Math.floor(W / 2) - 1);
  inShape[r0 * W + c0] = inShape[r0 * W + c0 + 1] = 1;
  let count = 2;
  const steps: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  while (count + 2 <= nCells) {
    const cands: [[number, number, number, number], number][] = [];
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        if (inShape[r * W + c] || adj(r, c) === 0) continue;
        for (const [dr, dc] of steps) {
          const r2 = r + dr;
          const c2 = c + dc;
          if (!inside(r2, c2) || isIn(r2, c2)) continue;
          const score = adj(r, c) + adj(r2, c2);
          cands.push([[r, c, r2, c2], score * score]);
        }
      }
    if (!cands.length) break;
    const [r, c, r2, c2] = pickWeighted(rng, cands);
    inShape[r * W + c] = inShape[r2 * W + c2] = 1;
    count += 2;
  }

  const cells: Cell[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (inShape[r * W + c]) cells.push({ r, c });
  const minR = Math.min(...cells.map((x) => x.r));
  const minC = Math.min(...cells.map((x) => x.c));
  const norm = cells.map((x) => ({ r: x.r - minR, c: x.c - minC }));
  return {
    width: Math.max(...norm.map((x) => x.c)) + 1,
    height: Math.max(...norm.map((x) => x.r)) + 1,
    cells: norm,
  };
}

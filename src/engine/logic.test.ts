import { describe, expect, it } from 'vitest';
import { EXTRA_KINDS } from '../model/types';
import { key } from '../model/cells';
import { quickPuzzle } from './generator';
import { gradeLogic } from './logic';

describe('logic grader', () => {
  it('only deduces the true solution', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const)
      for (const extras of [[], EXTRA_KINDS.map((k) => k.id)])
        for (let seed = 1; seed <= 2; seed++) {
          const q = quickPuzzle({ difficulty, maxPip: 6, allowDuplicates: false, requireUnique: true, extras, seed });
          if (!q.ok) throw new Error(q.error);
          const W = q.width;
          const cells = q.cells.map((c) => c.r * W + c.c);
          const regionOf = new Array(W * q.height).fill(-1);
          q.regions.forEach((r, i) => r.cells.forEach((c) => (regionOf[c.r * W + c.c] = i)));
          const res = gradeLogic({
            width: W,
            height: q.height,
            cells,
            regionOf,
            constraints: q.regions.map((r) => r.constraint),
            dominoes: q.dominoes,
          });
          const truth = new Map<string, number>();
          for (const p of q.solution) {
            truth.set(key(p.a), p.pips[0]);
            truth.set(key(p.b), p.pips[1]);
          }
          // Every deduced number is right, and a solved grid is complete.
          q.cells.forEach((c, i) => {
            if (res.values[i] >= 0) expect(res.values[i]).toBe(truth.get(key(c)));
          });
          if (res.solved) expect(res.values.every((v) => v >= 0)).toBe(true);
          expect(res.grade).toBe(q.stats.rating);
        }
  }, 120_000);

  it('grades a tiny forced puzzle as easy', () => {
    // 2x1 board, one region "sum = 4", tray [3,4]: the left cell must be 4... and is.
    const res = gradeLogic({
      width: 2,
      height: 1,
      cells: [0, 1],
      regionOf: [0, -1],
      constraints: [{ kind: 'sum', op: '=', value: 4 }],
      dominoes: [[3, 4]],
    });
    expect(res).toMatchObject({ solved: true, level: 1, grade: 'easy', values: [4, 3] });
  });
});

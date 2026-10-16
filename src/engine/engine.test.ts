import { describe, expect, it } from 'vitest';
import type { Puzzle } from '../model/types';
import { evaluate, key } from '../model/cells';
import { findDominoes, generate, quickPuzzle, validateLayout, verify } from './generator';
import { mulberry32 } from './rng';
import { randomShape } from './shape';
import { solve } from './solver';
import { randomTiling, tileability } from './tiling';

const rect = (w: number, h: number) =>
  Array.from({ length: w * h }, (_, i) => ({ r: Math.floor(i / w), c: i % w }));

function checkSolution(p: Pick<Puzzle, 'cells' | 'regions' | 'dominoes' | 'solution'>) {
  const values = new Map<string, number>();
  for (const pl of p.solution!) {
    values.set(key(pl.a), pl.pips[0]);
    values.set(key(pl.b), pl.pips[1]);
  }
  const sorted = (ds: number[][]) => ds.map(([a, b]) => `${Math.min(a, b)}${Math.max(a, b)}`).sort();
  expect(sorted(p.solution!.map((s) => s.pips))).toEqual(sorted(p.dominoes));
  return evaluate(p as Puzzle, values).solved;
}

describe('tiling', () => {
  it('detects untileable shapes', () => {
    expect(tileability(3, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8]).ok).toBe(false);
    // 2x2 minus opposite corners: even count, but both removed are same colour
    expect(tileability(3, 3, [1, 2, 3, 4, 5, 6, 7].filter((c) => c !== 4)).ok).toBe(false);
    expect(tileability(4, 2, [0, 1, 2, 3, 4, 5, 6, 7]).ok).toBe(true);
  });
  it('finds a random tiling', () => {
    const t = randomTiling(4, 4, [...Array(16).keys()], mulberry32(1));
    expect(t).toHaveLength(8);
  });
  it('random shapes are tileable', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const s = randomShape(8, 8, 20, rng);
      expect(validateLayout({ ...s, regions: [] }, { maxPip: 6, allowDuplicates: false, requireUnique: true })).toBeNull();
    }
  });
});

describe('solver', () => {
  it('solves a tiny puzzle uniquely', () => {
    // 2x1 board, region sum 7 over both cells, tray [3,4]
    const res = solve(
      {
        width: 2,
        height: 1,
        cells: [0, 1],
        regionOf: [0, -1],
        constraints: [{ kind: 'sum', op: '=', value: 4 }],
        types: [[3, 4]],
        counts: [1],
        maxPip: 6,
      },
      { limit: 2 },
    );
    expect(res.solutions).toHaveLength(1);
    expect(res.solutions[0].values).toEqual([4, 3]);
  });
});

describe('generator', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    it(`auto-generates a unique ${difficulty} puzzle`, () => {
      const res = generate(
        { width: 4, height: 4, cells: rect(4, 4), regions: [] },
        { mode: 'auto', difficulty, maxPip: 6, allowDuplicates: false, requireUnique: true, seed: 42 },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.stats.solutions).toBe(1);
      expect(checkSolution({ cells: rect(4, 4), ...res })).toBe(true);
    });
  }

  it('supports double-nine with duplicates', () => {
    const res = generate(
      { width: 6, height: 4, cells: rect(6, 4), regions: [] },
      { mode: 'auto', difficulty: 'medium', maxPip: 9, allowDuplicates: true, requireUnique: false, seed: 3 },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(checkSolution({ cells: rect(6, 4), ...res })).toBe(true);
  });

  it('finds dominoes for manual constraints', () => {
    const cells = rect(4, 2);
    const res = findDominoes(
      {
        width: 4,
        height: 2,
        cells,
        regions: [
          { id: 'a', color: 0, cells: cells.slice(0, 4), constraint: { kind: 'sum', op: '=', value: 10 } },
          { id: 'b', color: 1, cells: cells.slice(4), constraint: { kind: 'equal' } },
        ],
      },
      { mode: 'manual', difficulty: 'easy', maxPip: 6, allowDuplicates: false, requireUnique: false, seed: 9 },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(checkSolution({ cells, ...res })).toBe(true);
      const again = verify({ width: 4, height: 2, cells, regions: res.regions }, res.dominoes, 6);
      expect(again.ok && again.stats.solutions).toBeGreaterThan(0);
    }
  });

  it('reports impossible manual constraints', () => {
    const cells = rect(2, 1);
    const res = findDominoes(
      { width: 2, height: 1, cells, regions: [{ id: 'a', color: 0, cells, constraint: { kind: 'sum', op: '>', value: 12 } }] },
      { mode: 'manual', difficulty: 'easy', maxPip: 6, allowDuplicates: false, requireUnique: false, seed: 1 },
    );
    expect(res.ok).toBe(false);
  });

  it('quick puzzles work for all difficulties', () => {
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
      const q = quickPuzzle({ difficulty, maxPip: 6, allowDuplicates: false, requireUnique: true, seed: 11 });
      expect(q.ok).toBe(true);
    }
  }, 30_000);
});

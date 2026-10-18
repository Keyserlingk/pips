import { describe, expect, it } from 'vitest';
import type { Cell, Constraint } from '../model/types';
import { EXTRA_KINDS } from '../model/types';
import { satisfies } from '../model/cells';
import { generate, verify } from './generator';
import { type Rng, mulberry32, randInt, shuffle } from './rng';
import { solve } from './solver';

const line = (n: number): Cell[] => Array.from({ length: n }, (_, c) => ({ r: 0, c }));

describe('satisfies (extra constraints)', () => {
  it('step', () => {
    expect(satisfies({ kind: 'step', max: 1 }, [2, 3, 2], line(3))).toBe(true);
    expect(satisfies({ kind: 'step', max: 1 }, [2, 4, 2], line(3))).toBe(false);
    // Not adjacent: (0,0) and (0,2) may differ freely
    expect(satisfies({ kind: 'step', max: 1 }, [0, 6], [{ r: 0, c: 0 }, { r: 0, c: 2 }])).toBe(true);
  });
  it('product', () => {
    expect(satisfies({ kind: 'product', value: 12 }, [2, 6])).toBe(true);
    expect(satisfies({ kind: 'product', value: 0 }, [5, 0, 3])).toBe(true);
    expect(satisfies({ kind: 'product', value: 12 }, [3, 3])).toBe(false);
  });
  it('max / min', () => {
    expect(satisfies({ kind: 'extreme', which: 'max', value: 5 }, [1, 5, 3])).toBe(true);
    expect(satisfies({ kind: 'extreme', which: 'max', value: 5 }, [1, 4])).toBe(false);
    expect(satisfies({ kind: 'extreme', which: 'min', value: 1 }, [1, 5, 3])).toBe(true);
  });
  it('sum parity', () => {
    expect(satisfies({ kind: 'sumParity', even: true }, [1, 3])).toBe(true);
    expect(satisfies({ kind: 'sumParity', even: false }, [1, 3])).toBe(false);
  });
});

/** Every solution by brute force: all tilings × all tray assignments. */
function bruteForce(W: number, H: number, regions: { cells: number[]; con: Constraint }[], tray: [number, number][]) {
  const N = W * H;
  const found = new Set<string>();
  const partner = new Array(N).fill(-1);
  const tilings: number[][] = [];
  const tile = () => {
    const c = partner.indexOf(-1);
    if (c < 0) return void tilings.push(partner.slice());
    for (const n of [c + 1, c + W])
      if (n < N && partner[n] === -1 && (n === c + W || c % W !== W - 1)) {
        partner[c] = n;
        partner[n] = c;
        tile();
        partner[c] = partner[n] = -1;
      }
  };
  tile();
  const perms = (xs: number[]): number[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  for (const t of tilings) {
    const pairs = [...Array(N).keys()].filter((c) => t[c] > c).map((c) => [c, t[c]]);
    for (const perm of perms(tray.map((_, i) => i)))
      for (let mask = 0; mask < 1 << pairs.length; mask++) {
        const values = new Array(N);
        pairs.forEach(([a, b], i) => {
          const [x, y] = tray[perm[i]];
          [values[a], values[b]] = mask & (1 << i) ? [y, x] : [x, y];
        });
        const ok = regions.every((r) =>
          satisfies(r.con, r.cells.map((c) => values[c]), r.cells.map((c) => ({ r: Math.floor(c / W), c: c % W }))),
        );
        if (ok) found.add(values.join(',') + '|' + t.join(','));
      }
  }
  return found.size;
}

function randomConstraint(rng: Rng): Constraint {
  switch (randInt(rng, 0, 4)) {
    case 0:
      return { kind: 'step', max: randInt(rng, 0, 3) };
    case 1:
      return { kind: 'product', value: [0, 1, 2, 4, 6, 8, 12, 18, 24][randInt(rng, 0, 8)] };
    case 2:
      return { kind: 'extreme', which: rng() < 0.5 ? 'max' : 'min', value: randInt(rng, 0, 6) };
    case 3:
      return { kind: 'sumParity', even: rng() < 0.5 };
    default:
      return { kind: 'sum', op: '=', value: randInt(rng, 0, 18) };
  }
}

describe('solver pruning is sound for extra constraints', () => {
  it('matches brute force on random small puzzles', () => {
    const rng = mulberry32(2024);
    const W = 3;
    const H = 2;
    const all: [number, number][] = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) all.push([a, b]);
    for (let trial = 0; trial < 150; trial++) {
      const tray = shuffle(rng, all.slice()).slice(0, 3);
      const cells = shuffle(rng, [0, 1, 2, 3, 4, 5]);
      const cut = randInt(rng, 2, 4);
      const regions = [
        { cells: cells.slice(0, cut), con: randomConstraint(rng) },
        { cells: cells.slice(cut), con: randomConstraint(rng) },
      ];
      const regionOf = new Array(6).fill(-1);
      regions.forEach((r, i) => r.cells.forEach((c) => (regionOf[c] = i)));
      const res = solve(
        {
          width: W,
          height: H,
          cells: [0, 1, 2, 3, 4, 5],
          regionOf,
          constraints: regions.map((r) => r.con),
          types: tray,
          counts: [1, 1, 1],
          maxPip: 6,
        },
        { limit: 10_000 },
      );
      expect(res.solutions.length, JSON.stringify({ tray, regions })).toBe(bruteForce(W, H, regions, tray));
    }
  });
});

describe('generator with extras', () => {
  const rect = (w: number, h: number) => Array.from({ length: w * h }, (_, i) => ({ r: Math.floor(i / w), c: i % w }));
  it('produces unique, solvable puzzles that use the extra kinds', () => {
    const kinds = new Set<string>();
    let made = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const cells = rect(4, 4);
      const res = generate(
        { width: 4, height: 4, cells, regions: [] },
        {
          mode: 'auto',
          difficulty: 'easy',
          maxPip: 6,
          allowDuplicates: false,
          requireUnique: true,
          extras: EXTRA_KINDS.map((k) => k.id),
          seed,
        },
      );
      // Generation runs against a clock; an occasional miss on a slow run is fine.
      if (!res.ok) continue;
      made++;
      expect(res.stats.solutions).toBe(1);
      res.regions.forEach((r) => kinds.add(r.constraint.kind));
      const check = verify({ width: 4, height: 4, cells, regions: res.regions }, res.dominoes, 6);
      expect(check.ok && check.stats.solutions).toBe(1);
    }
    expect(made).toBeGreaterThanOrEqual(20);
    for (const k of ['step', 'product', 'extreme', 'sumParity']) expect(kinds.has(k), k).toBe(true);
  }, 120_000);
});

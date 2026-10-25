import { describe, expect, it } from 'vitest';
import { gameGhosts, levelsFor, standings, type SeriesRun } from './series';

const run = (name: string, times: (number | null)[]): SeriesRun => ({ name, times, steps: times.map(() => []) });

describe('series levels', () => {
  it('same, increasing and mixed', () => {
    expect(levelsFor('same', 'hard', 3)).toEqual(['hard', 'hard', 'hard']);
    expect(levelsFor('increasing', 'easy', 4)).toEqual(['easy', 'medium', 'hard', 'expert']);
    expect(levelsFor('increasing', 'easy', 3)).toEqual(['easy', 'hard', 'expert']);
    expect(levelsFor('increasing', 'medium', 1)).toEqual(['medium']);
    expect(levelsFor('increasing', 'expert', 3)).toEqual(['expert', 'expert', 'expert']);
    const mixed = levelsFor('mixed', 'easy', 20);
    expect(mixed).toHaveLength(20);
    expect(mixed.every((d) => ['easy', 'medium', 'hard', 'expert'].includes(d))).toBe(true);
  });
});

describe('series standings', () => {
  // Alice wins games 1 and 2; Bob wins game 3 by a lot, so Bob has the lower total.
  const alice = run('Alice', [10_000, 20_000, 90_000]);
  const bob = run('Bob', [11_000, 21_000, 30_000]);
  const carol = run('Carol', [9_000, null, 25_000]); // gave up game 2

  it('most wins', () => {
    const s = standings([alice, bob], 'wins');
    expect(s.map((x) => [x.run.name, x.wins])).toEqual([['Alice', 2], ['Bob', 1]]);
  });
  it('shortest total time', () => {
    const s = standings([alice, bob], 'time');
    expect(s.map((x) => [x.run.name, x.total])).toEqual([['Bob', 62_000], ['Alice', 120_000]]);
  });
  it('giving up: no total, ranked last on time but games won still count', () => {
    const t = standings([alice, bob, carol], 'time');
    expect(t.map((x) => x.run.name)).toEqual(['Bob', 'Alice', 'Carol']);
    expect(t[2].total).toBeNull();
    const w = standings([alice, bob, carol], 'wins');
    // Carol wins games 1 and 3, Alice game 2.
    expect(w.map((x) => [x.run.name, x.wins])).toEqual([['Carol', 2], ['Alice', 1], ['Bob', 0]]);
  });
  it('ties give both players the win', () => {
    const s = standings([run('A', [5000]), run('B', [5000])], 'wins');
    expect(s.map((x) => x.wins)).toEqual([1, 1]);
  });
  it('ghosts for a game skip those who gave up', () => {
    expect(gameGhosts([alice, carol], 1).map((g) => g.name)).toEqual(['Alice']);
  });
});

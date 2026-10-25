import { describe, expect, it } from 'vitest';
import { EXTRA_KINDS } from './types';
import { quickPuzzle } from '../engine/generator';
import { decodeGhost, decodeShare, encodeGhost, encodeShare, ghostPlaced, samePuzzle } from './serialize';

describe('share links', () => {
  it('round-trips a puzzle without its solution, and is short', async () => {
    const q = quickPuzzle({ difficulty: 'medium', maxPip: 6, allowDuplicates: false, requireUnique: true, extras: EXTRA_KINDS.map((k) => k.id), seed: 5 });
    if (!q.ok) throw new Error(q.error);
    const p = {
      version: 1 as const,
      id: 'abc123',
      title: 'Tricky one ✨',
      author: 'Erik',
      difficulty: q.stats.rating,
      width: q.width,
      height: q.height,
      cells: q.cells,
      regions: q.regions,
      dominoes: q.dominoes,
      solution: q.solution,
      options: { maxPip: 6 as const, allowDuplicates: false, requireUnique: true, extras: EXTRA_KINDS.map((k) => k.id) },
    };
    const code = await encodeShare(p);
    const back = await decodeShare(code);
    expect(back).not.toBeNull();
    expect(samePuzzle(back!, p)).toBe(true);
    expect(back!.solution).toBeUndefined();
    expect(back!.options).toEqual(p.options);
    const legacyLength = Math.ceil((new TextEncoder().encode(JSON.stringify(p)).length * 4) / 3);
    console.log(`SHARE ${p.cells.length} cells: new ${code.length} chars, old ${legacyLength} chars`);
    expect(code.length).toBeLessThan(legacyLength / 3);
  }, 30_000);

  it('rejects garbage', async () => {
    expect(await decodeShare('zNOTVALID')).toBeNull();
    expect(await decodeShare('')).toBeNull();
  });
});

describe('ghost links', () => {
  const puzzle = {
    version: 1 as const,
    id: 'g1',
    title: 'Ghost test',
    width: 2,
    height: 1,
    cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }],
    regions: [],
    dominoes: [[1, 2]] as [number, number][],
    solution: [{ a: { r: 0, c: 0 }, b: { r: 0, c: 1 }, pips: [1, 2] as [number, number] }],
    options: { maxPip: 6 as const, allowDuplicates: false, requireUnique: true },
  };
  const steps = (ms: number) => [[0, 0], [1234, 1], [ms, 2]] as [number, number][];
  const run = (name: string, ...times: (number | null)[]) => ({ name, times, steps: times.map((t) => (t ? steps(t) : [])) });

  it('round-trips a series without solutions, keeping the 5 best players', async () => {
    const runs = [run('A', 9000, 1000), run('B', 4000, 1000), run('C', 7000, 1000), run('D', 5000, 1000), run('E', 8000, 1000), run('F', 6000, null)];
    const back = await decodeGhost(await encodeGhost({ puzzles: [puzzle, puzzle], scoring: 'time', runs }));
    expect(back).not.toBeNull();
    expect(back!.puzzles).toHaveLength(2);
    expect(back!.puzzles[0].solution).toBeUndefined();
    expect(back!.scoring).toBe('time');
    // F gave up a game (no total), so it is the one dropped.
    expect(back!.runs.map((r) => r.name)).toEqual(['B', 'D', 'C', 'E', 'A']);
    // Steps are stored to the tenth of a second.
    expect(back!.runs[0].steps[0]).toEqual([[0, 0], [1200, 1], [4000, 2]]);
  });

  it('keeps "gave up" and the winner rule', async () => {
    const back = await decodeGhost(await encodeGhost({ puzzles: [puzzle, puzzle], scoring: 'wins', runs: [run('A', 3000, null)] }));
    expect(back!.scoring).toBe('wins');
    expect(back!.runs[0].times).toEqual([3000, null]);
  });

  it('still opens links from the single-game version', async () => {
    const compact = { i: 'g1', t: 'Old', w: 2, h: 1, c: [0, 1], r: [], m: [1, 2], o: [6, 0, 1] };
    const json = JSON.stringify({ p: compact, r: [['Alice', 2600, [0, 0, 26, 2]]] });
    const code = 'j' + btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = await decodeGhost(code);
    expect(back!.puzzles).toHaveLength(1);
    expect(back!.runs[0]).toMatchObject({ name: 'Alice', times: [2600] });
  });

  it('tells how many pieces a ghost had placed at a moment', () => {
    const r = { name: 'A', ms: 5000, steps: steps(5000) };
    expect([0, 1000, 1300, 4999, 5000].map((t) => ghostPlaced(r, t))).toEqual([0, 0, 1, 1, 2]);
  });

  it('rejects broken links', async () => {
    expect(await decodeGhost('zBROKEN')).toBeNull();
    expect(await decodeGhost(await encodeGhost({ puzzles: [puzzle], scoring: 'time', runs: [] }))).toBeNull();
  });
});

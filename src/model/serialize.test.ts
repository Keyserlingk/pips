import { describe, expect, it } from 'vitest';
import { EXTRA_KINDS } from './types';
import { quickPuzzle } from '../engine/generator';
import { decodeShare, encodeShare, samePuzzle } from './serialize';

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

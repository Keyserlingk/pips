import { describe, expect, it } from 'vitest';
import { quickPuzzle } from '../engine/generator';
import { GENERATOR_VERSION } from '../engine/version';
import { canShareSeed, decodeSeed, encodeSeed, fingerprint, randomPuzzle, seedOptions } from './seedLink';
import type { SeedOrigin } from './types';

const recipe = { v: GENERATOR_VERSION, level: 'hard' as const, seed: 3_000_000_123, extras: true };

describe('seed links', () => {
  it('round-trip, and stay short', () => {
    const o: SeedOrigin = { ...recipe, fp: 'abc12' };
    const code = encodeSeed(o);
    expect(code).toBe('1.hc.1dm4ewr.abc12');
    expect(decodeSeed(code)).toEqual(o);
  });

  it('reject broken codes', () => {
    for (const bad of ['', '1.h.zz', '1.q.abc.def', 'x.h.abc.def', '1.h.zzzzzzz.abc', '1.h.abc.def.ghi']) expect(decodeSeed(bad)).toBeNull();
  });

  it('regenerate into the same puzzle', () => {
    const make = () => {
      const q = quickPuzzle(seedOptions(recipe));
      if (!q.ok) throw new Error(q.error);
      return randomPuzzle(q, recipe);
    };
    const sent = make();
    const link = decodeSeed(encodeSeed(sent.origin!))!;
    const received = make();
    expect(received.origin!.fp).toBe(link.fp);
    expect(received.id).toBe(sent.id);
  }, 60_000);

  it('are only offered while the puzzle is unchanged', () => {
    const q = quickPuzzle(seedOptions({ ...recipe, level: 'easy' }));
    if (!q.ok) throw new Error(q.error);
    const p = randomPuzzle(q, { ...recipe, level: 'easy' });
    expect(canShareSeed(p, GENERATOR_VERSION)).toBe(true);
    expect(canShareSeed(p, GENERATOR_VERSION + 1)).toBe(false);
    expect(canShareSeed({ ...p, dominoes: p.dominoes.slice(1) }, GENERATOR_VERSION)).toBe(false);
    expect(canShareSeed({ ...p, origin: undefined }, GENERATOR_VERSION)).toBe(false);
  });

  // Old seed links must keep opening the same puzzle. If this fails, the generator now makes
  // different puzzles from the same seed: bump GENERATOR_VERSION (src/engine/version.ts) and
  // update these values.
  it.each([
    ['easy', false, '1dhj6pm'],
    ['medium', false, '1yf7lde'],
    ['hard', false, '5k6cj4'],
    ['expert', false, 'mwa6fb'],
    ['medium', true, '1extq1v'],
  ] as const)(`version ${GENERATOR_VERSION}: %s (extras %s) from seed 42 is unchanged`, (level, extras, fp) => {
    expect(GENERATOR_VERSION).toBe(1);
    const q = quickPuzzle(seedOptions({ level, seed: 42, extras }));
    expect(q.ok && fingerprint(q)).toBe(fp);
  }, 60_000);
});

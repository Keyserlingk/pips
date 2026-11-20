import type { Difficulty, Puzzle } from '../../model/types';
import { saveProgress, saveQuick } from '../../model/storage';
import { runEngine } from '../../engine/client';
import { randomSeed } from '../../engine/rng';
import { GENERATOR_VERSION } from '../../engine/version';
import { randomPuzzle, seedOptions } from '../../model/seedLink';

/**
 * Generates a random puzzle and makes it the current quick puzzle (#/play/quick). It is made
 * from a recorded seed without time limits, so it can be shared as a short seed link.
 */
export async function newRandomPuzzle(level: Difficulty, extras: boolean): Promise<Puzzle> {
  const recipe = { v: GENERATOR_VERSION, level, seed: randomSeed(), extras };
  const res = await runEngine('quick', seedOptions(recipe)).promise;
  if (!res.ok) throw new Error(res.error);
  const p = randomPuzzle(res, recipe);
  saveQuick(p);
  saveProgress(p.id, null);
  return p;
}

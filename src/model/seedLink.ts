import type { Difficulty, Puzzle, SeedOrigin } from './types';
import { DEFAULT_OPTIONS, EXTRA_KINDS } from './types';
import { levelLabel } from './levels';
import { pageUrl } from './site';

/*
 * Seed links: a random puzzle shared as the recipe that made it (generator
 * version, level, seed) instead of the whole puzzle. The receiver regenerates
 * it in deterministic mode, which gives the same puzzle on every device. A
 * fingerprint of the puzzle travels along, so a link that regenerates into
 * something else (a different generator) is caught instead of shown.
 *
 * Code: <version>.<level><c if extras>.<seed base36>.<fingerprint>, e.g. 1.h.2k9f8a.1x7k2q
 */

const LEVEL_CODES: Record<Difficulty, string> = { easy: 'e', medium: 'm', hard: 'h', expert: 'x', rachel: 'r' };

/** The generator options a recipe stands for. Changing them changes the puzzles: bump GENERATOR_VERSION. */
export const seedOptions = (o: Pick<SeedOrigin, 'level' | 'seed' | 'extras'>) => ({
  ...DEFAULT_OPTIONS,
  maxPip: 6 as const,
  extras: o.extras ? EXTRA_KINDS.map((k) => k.id) : [],
  difficulty: o.level,
  seed: o.seed,
  deterministic: true,
});

/** Short hash of what a player sees: board, regions with their rules, and the tray. */
export function fingerprint(p: Pick<Puzzle, 'width' | 'height' | 'cells' | 'regions' | 'dominoes'>): string {
  const view = JSON.stringify([p.width, p.height, p.cells, p.regions.map((r) => [r.cells, r.constraint]), p.dominoes]);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    h ^= view.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const encodeSeed = (o: SeedOrigin) =>
  `${o.v}.${LEVEL_CODES[o.level]}${o.extras ? 'c' : ''}.${o.seed.toString(36)}.${o.fp}`;

export function decodeSeed(code: string): SeedOrigin | null {
  const m = /^(\d+)\.([a-z])(c?)\.([0-9a-z]{1,7})\.([0-9a-z]{1,7})$/.exec(code);
  if (!m) return null;
  const level = (Object.keys(LEVEL_CODES) as Difficulty[]).find((l) => LEVEL_CODES[l] === m[2]);
  const seed = parseInt(m[4], 36);
  if (!level || seed >= 2 ** 32) return null;
  return { v: Number(m[1]), level, seed, extras: m[3] === 'c', fp: m[5] };
}

/** Can this puzzle go out as a seed link? Not once it has been changed since it was generated. */
export const canShareSeed = (p: Puzzle, version: number) => !!p.origin && p.origin.v === version && fingerprint(p) === p.origin.fp;

export const seedUrl = (o: SeedOrigin) => `${pageUrl()}#/s/${encodeSeed(o)}`;

/** A generated random puzzle, remembering its recipe. The id comes from the recipe, so progress survives reloads. */
export function randomPuzzle(
  res: Pick<Puzzle, 'width' | 'height' | 'cells' | 'regions' | 'dominoes' | 'solution'>,
  recipe: Pick<SeedOrigin, 'v' | 'level' | 'seed' | 'extras'>,
): Puzzle {
  const { maxPip, allowDuplicates, requireUnique, extras } = seedOptions(recipe);
  const origin: SeedOrigin = { ...recipe, fp: fingerprint(res) };
  return {
    version: 1,
    id: `random-${encodeSeed(origin).split('.').slice(0, 3).join('-')}`,
    title: `Random ${levelLabel(recipe.level)}`,
    difficulty: recipe.level,
    width: res.width,
    height: res.height,
    cells: res.cells,
    regions: res.regions,
    dominoes: res.dominoes,
    solution: res.solution,
    options: { maxPip, allowDuplicates, requireUnique, extras },
    origin,
  };
}

import type { Puzzle } from '../model/types';
import { DIRS, add, evaluate, key } from '../model/cells';
import type { Placed } from './protocol';

/**
 * Checks a claimed finish from the domino placements themselves: every
 * domino used once, every cell covered once, and every region's rule met.
 */
export function validFinish(puzzle: Puzzle, placed: Placed): boolean {
  if (!placed || typeof placed !== 'object') return false;
  const active = new Set(puzzle.cells.map(key));
  const values = new Map<string, number>();
  const entries = Object.entries(placed);
  if (entries.length !== puzzle.dominoes.length) return false;
  for (const [i, p] of entries) {
    const d = puzzle.dominoes[Number(i)];
    const dir = DIRS[p?.orient];
    if (!d || !dir || typeof p.anchor?.r !== 'number' || typeof p.anchor?.c !== 'number') return false;
    const a = p.anchor;
    const b = add(a, dir);
    for (const [cell, v] of [[a, d[0]], [b, d[1]]] as const) {
      const k = key(cell);
      if (!active.has(k) || values.has(k)) return false;
      values.set(k, v);
    }
  }
  return values.size === puzzle.cells.length && evaluate(puzzle, values).solved;
}

import type { Difficulty } from './types';

/**
 * Levels offered in menus. The engine's top level ('rachel') is hidden: it was
 * too hard. Its code stays, so it can come back.
 */
export const PLAYABLE_LEVELS: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

/**
 * Names shown to players. 'expert' is presented as "Rachel"; a puzzle that
 * happens to grade above it (the hidden level) is shown with the same name.
 */
export function levelLabel(d: Difficulty): string {
  if (d === 'expert' || d === 'rachel') return 'Rachel';
  return d[0].toUpperCase() + d.slice(1);
}

/** CSS class for level pills and cards (the hidden level looks like the top one). */
export const levelClass = (d: Difficulty) => (d === 'rachel' ? 'expert' : d);

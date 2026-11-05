import type { Difficulty, Puzzle } from './types';
import { levelLabel } from './levels';

/*
 * The "you solved it" message and the result line players copy to share,
 * e.g. "erkpips 5/11/26 daily easy in 3min 44s 🟢" (only daily puzzles are dated).
 */

/** The name the shared result starts with. */
export const SHARE_NAME = 'erkpips';

const PRAISE = ['Good job!', 'Well done!', 'Nicely done!', 'Great solve!'];
export const praise = (pick = Math.random()) => PRAISE[Math.floor(pick * PRAISE.length) % PRAISE.length];

/** One emoji per level, matching the level cards' colours. */
const LEVEL_EMOJI: Record<Difficulty, string> = { easy: '🟢', medium: '🟠', hard: '🔴', expert: '⚫', rachel: '⚫' };

const DAILY_ID = /^daily-(\d{4})-(\d{2})-(\d{2})-/;

/** 224 → "3 min 44 s" (spaced, for reading) or "3min 44s" (compact, for sharing). */
export function duration(seconds: number, compact = false) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const [min, sec] = compact ? ['min', 's'] : [' min', ' s'];
  return m ? `${m}${min} ${s}${sec}` : `${s}${sec}`;
}

/** "the Easy puzzle", "today's Easy puzzle" or a puzzle's own name. */
export function puzzleName(p: Puzzle): string {
  const level = p.difficulty ? levelLabel(p.difficulty) : '';
  if (DAILY_ID.test(p.id)) return `the daily ${level} puzzle`;
  if (p.origin) return `the ${level} puzzle`;
  return p.title ? `“${p.title}”` : 'the puzzle';
}

/** The shared result line, plus a link to the puzzle on the next line when there is one. */
export function resultText(p: Puzzle, seconds: number, link: string | null): string {
  const daily = DAILY_ID.exec(p.id);
  // Only a daily puzzle is dated (by its own day): it is the one friends can compare on.
  const date = daily ? ` ${Number(daily[3])}/${Number(daily[2])}/${daily[1].slice(-2)}` : '';
  const level = p.difficulty ? levelLabel(p.difficulty).toLowerCase() : '';
  const what = [daily ? 'daily' : '', level].filter(Boolean).join(' ') || p.title || 'puzzle';
  const emoji = p.difficulty ? ` ${LEVEL_EMOJI[p.difficulty]}` : '';
  const line = `${SHARE_NAME}${date} ${what} in ${duration(seconds, true)}${emoji}`;
  return link ? `${line}\n${link}` : line;
}

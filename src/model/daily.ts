import type { Difficulty } from './types';

/*
 * Daily puzzles: one per level, the same for everyone on a given date. The
 * puzzle is generated on the player's device from a seed made of the date and
 * the level, in deterministic mode (no time limits), so every device gets the
 * same result. Bump DAILY_VERSION to deliberately give everyone new puzzles
 * (for example after a generator change, which would alter them anyway).
 */
export const DAILY_VERSION = 1;

const pad = (n: number) => String(n).padStart(2, '0');

/** The player's local date, YYYY-MM-DD: daily puzzles change at local midnight. */
export const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const isDateKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** FNV-1a hash of version, date and level: the generator's seed. */
export function dailySeed(date: string, level: Difficulty): number {
  let h = 0x811c9dc5;
  for (const ch of `pips-daily-v${DAILY_VERSION}|${date}|${level}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export const dailyId = (date: string, level: Difficulty) => `daily-${date}-${level}`;

/** "Sun 25 Oct" */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

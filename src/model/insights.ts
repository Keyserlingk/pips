import type { Difficulty } from './types';
import { type HistoryEntry, dayKey } from './history';
import { PLAYABLE_LEVELS } from './levels';

/*
 * Statistics over the history of solved games, for the Insights page.
 * Everything here is worked out from the history alone (on this device).
 */

/**
 * The level a game was played at: the level asked for (a daily puzzle's or a random
 * puzzle's), else the grade the puzzle got. The hidden top level counts as the top one.
 */
export function levelOf(e: HistoryEntry): Difficulty | undefined {
  const l = e.ref.kind === 'daily' ? e.ref.level : e.ref.kind === 'seed' ? e.ref.origin.level : e.difficulty;
  return l === 'rachel' ? 'expert' : l;
}

export const isDaily = (e: HistoryEntry) => e.ref.kind === 'daily';

/** Games solved at or after `since` (ms since epoch); all of them for null. */
export const since = (history: HistoryEntry[], from: number | null) => (from === null ? history : history.filter((e) => e.solvedAt >= from));

export interface SolvePoint {
  at: number;
  seconds: number;
  daily: boolean;
  title: string;
}

/** Each solve of a level, oldest first. */
export function solveTimes(history: HistoryEntry[], level: Difficulty, dailyOnly = false): SolvePoint[] {
  return history
    .filter((e) => levelOf(e) === level && (!dailyOnly || isDaily(e)))
    .map((e) => ({ at: e.solvedAt, seconds: e.elapsed, daily: isDaily(e), title: e.title }))
    .sort((a, b) => a.at - b.at);
}

/** The average of each value and the ones before it, `n` at most: the trend through noisy times. */
export function rollingAverage(values: number[], n = 5): number[] {
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - n + 1), i + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
}

export interface DayTotal {
  /** The daily puzzles' date (YYYY-MM-DD), not when they were played. */
  date: string;
  /** Seconds over the levels solved. */
  total: number;
  levels: Partial<Record<Difficulty, number>>;
  /** Every level solved. */
  complete: boolean;
}

/** Time spent on each date's daily puzzles, oldest date first. */
export function dailyTotals(history: HistoryEntry[]): DayTotal[] {
  const days = new Map<string, Partial<Record<Difficulty, number>>>();
  // Oldest first, so a puzzle somehow recorded twice counts its first solve.
  for (const e of [...history].sort((a, b) => a.solvedAt - b.solvedAt)) {
    if (e.ref.kind !== 'daily') continue;
    const levels = days.get(e.ref.date) ?? {};
    const level = levelOf(e)!;
    if (levels[level] === undefined) levels[level] = e.elapsed;
    days.set(e.ref.date, levels);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, levels]) => ({
      date,
      levels,
      total: Object.values(levels).reduce((a, b) => a + b, 0),
      complete: PLAYABLE_LEVELS.every((l) => levels[l] !== undefined),
    }));
}

/** Games solved in each hour of the day (local time), 0–23. */
export function hourCounts(history: HistoryEntry[]): number[] {
  const hours = Array<number>(24).fill(0);
  for (const e of history) hours[new Date(e.solvedAt).getHours()]++;
  return hours;
}

/** Days in a row, up to today, with a daily puzzle solved. Today not played yet doesn't break it. */
export function dailyStreak(history: HistoryEntry[], today = new Date()): number {
  const days = new Set(history.filter(isDaily).map((e) => (e.ref as { date: string }).date));
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export interface LevelStats {
  level: Difficulty;
  count: number;
  best: number | null;
  average: number | null;
}

/** Solves, best and average time for each level. */
export function levelStats(history: HistoryEntry[]): LevelStats[] {
  return PLAYABLE_LEVELS.map((level) => {
    const times = history.filter((e) => levelOf(e) === level).map((e) => e.elapsed);
    return {
      level,
      count: times.length,
      best: times.length ? Math.min(...times) : null,
      average: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    };
  });
}

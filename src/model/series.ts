import type { Difficulty } from './types';
import { PLAYABLE_LEVELS } from './levels';

/*
 * Ghost series: one or more puzzles played in a row. Each player's attempt is
 * a SeriesRun; the winner is whoever won most games, or had the shortest total
 * time, as the challenger chose.
 */

export type Scoring = 'wins' | 'time';
export type LevelPlan = 'same' | 'increasing' | 'mixed';

/** One player's attempt at a whole series. */
export interface SeriesRun {
  name: string;
  /** Time per game in ms; null = gave up that game. */
  times: (number | null)[];
  /** Per game: [ms since start, pieces on the board] each time the count changed. */
  steps: [number, number][][];
}

export interface Standing {
  run: SeriesRun;
  /** Games where this player was fastest (ties count for everyone tied). */
  wins: number;
  /** Sum of all times, or null if any game was given up. */
  total: number | null;
}

export const SCORING_LABEL: Record<Scoring, string> = { wins: 'Most games won', time: 'Shortest total time' };
export const PLAN_LABEL: Record<LevelPlan, string> = {
  same: 'Same level',
  increasing: 'Increasing',
  mixed: 'Mixed',
};

/** The level of each game. "Increasing" climbs from `start` to the top level. */
export function levelsFor(plan: LevelPlan, start: Difficulty, games: number, rng = Math.random): Difficulty[] {
  const all = PLAYABLE_LEVELS;
  const from = Math.max(0, all.indexOf(start));
  return Array.from({ length: games }, (_, i) => {
    if (plan === 'same') return all[from];
    if (plan === 'mixed') return all[Math.floor(rng() * all.length)];
    const top = all.length - 1;
    return all[games === 1 ? from : from + Math.round((i * (top - from)) / (games - 1))];
  });
}

export function standings(runs: SeriesRun[], scoring: Scoring): Standing[] {
  const games = Math.max(0, ...runs.map((r) => r.times.length));
  const best = Array.from({ length: games }, (_, g) =>
    Math.min(...runs.map((r) => r.times[g] ?? Infinity)),
  );
  const rows: Standing[] = runs.map((run) => ({
    run,
    wins: best.filter((b, g) => b !== Infinity && run.times[g] === b).length,
    total: run.times.length === games && run.times.every((t) => t !== null) ? run.times.reduce<number>((a, t) => a + (t ?? 0), 0) : null,
  }));
  const byTime = (a: Standing, b: Standing) => (a.total ?? Infinity) - (b.total ?? Infinity);
  return rows.sort((a, b) => (scoring === 'wins' ? b.wins - a.wins || byTime(a, b) : byTime(a, b) || b.wins - a.wins));
}

/** Everyone who finished game `g`, as ghosts to race. */
export const gameGhosts = (runs: SeriesRun[], g: number) =>
  runs.flatMap((r) => (r.times[g] != null ? [{ name: r.name, ms: r.times[g]!, steps: r.steps[g] ?? [] }] : []));

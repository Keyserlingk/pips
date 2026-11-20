import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from './history';
import { dailyStreak, dailyTotals, hourCounts, levelOf, levelStats, rollingAverage, solveTimes } from './insights';
import type { Difficulty } from './types';

let n = 0;
const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();
const daily = (date: string, level: Difficulty, elapsed: number, solvedAt = at(date)): HistoryEntry => ({
  id: `e${n++}`,
  puzzleId: `daily-${date}-${level}`,
  title: 'Daily',
  difficulty: 'hard',
  ref: { kind: 'daily', date, level },
  solvedAt,
  elapsed,
});
const random = (level: Difficulty, elapsed: number, solvedAt: number): HistoryEntry => ({
  id: `e${n++}`,
  puzzleId: `r${n}`,
  title: 'Random',
  difficulty: 'easy',
  ref: { kind: 'seed', origin: { v: 1, level, seed: 1, extras: false, fp: 'x' } },
  solvedAt,
  elapsed,
});

describe('insights', () => {
  it('uses the level asked for, and shows the hidden level as the top one', () => {
    expect(levelOf(daily('2026-11-01', 'medium', 10))).toBe('medium');
    expect(levelOf(random('rachel', 10, 0))).toBe('expert');
  });

  it('lists solve times oldest first, dailies only on request', () => {
    const h = [random('easy', 30, at('2026-11-03')), daily('2026-11-01', 'easy', 50), daily('2026-11-02', 'medium', 70)];
    expect(solveTimes(h, 'easy').map((p) => p.seconds)).toEqual([50, 30]);
    expect(solveTimes(h, 'easy', true).map((p) => p.seconds)).toEqual([50]);
  });

  it('averages over a sliding window', () => {
    expect(rollingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });

  it('adds up each date of daily puzzles, by the puzzles’ date', () => {
    const h = [
      daily('2026-11-02', 'easy', 60),
      daily('2026-11-01', 'easy', 10, at('2026-11-02')),
      daily('2026-11-01', 'medium', 20),
      daily('2026-11-01', 'hard', 30),
      daily('2026-11-01', 'expert', 40),
    ];
    const t = dailyTotals(h);
    expect(t.map((d) => [d.date, d.total, d.complete])).toEqual([
      ['2026-11-01', 100, true],
      ['2026-11-02', 60, false],
    ]);
  });

  it('counts solves per hour', () => {
    const c = hourCounts([random('easy', 1, at('2026-11-01', 7)), random('easy', 1, at('2026-11-02', 7)), random('easy', 1, at('2026-11-02', 22))]);
    expect(c[7]).toBe(2);
    expect(c[22]).toBe(1);
  });

  it('counts the daily streak, not broken by today being unplayed', () => {
    const h = ['2026-11-17', '2026-11-18', '2026-11-19'].map((d) => daily(d, 'easy', 5));
    expect(dailyStreak(h, new Date(2026, 10, 20))).toBe(3);
    expect(dailyStreak(h, new Date(2026, 10, 19))).toBe(3);
    expect(dailyStreak(h, new Date(2026, 10, 21))).toBe(0);
  });

  it('gives best and average per level', () => {
    const s = levelStats([random('easy', 30, 0), random('easy', 61, 0)]);
    expect(s[0]).toEqual({ level: 'easy', count: 2, best: 30, average: 46 });
    expect(s[1].best).toBeNull();
  });
});

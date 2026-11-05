import { beforeEach, describe, expect, it } from 'vitest';
import { addTodo, calendarWeeks, countByDay, dayKey, intensity, isTodo, rateSolve, recordSolve, refFor } from './history';
import { loadHistory, loadTodo } from './storage';
import { DEFAULT_OPTIONS, type Puzzle } from './types';

// A minimal in-memory localStorage for the storage helpers.
beforeEach(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
});

const puzzle = (id: string): Puzzle => ({
  version: 1,
  id,
  title: 'Mine',
  width: 2,
  height: 1,
  cells: [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
  ],
  regions: [],
  dominoes: [[1, 2]],
  options: DEFAULT_OPTIONS,
});

describe('history', () => {
  it('keeps the smallest way back to a puzzle', async () => {
    expect(await refFor(puzzle('daily-2026-11-05-hard'))).toEqual({ kind: 'daily', date: '2026-11-05', level: 'hard' });
    expect((await refFor(puzzle('custom'))).kind).toBe('puzzle');
  });

  it('records solves newest first, and takes them off the to-do list', async () => {
    await addTodo(puzzle('a'));
    await addTodo(puzzle('a')); // only once
    expect(loadTodo()).toHaveLength(1);
    await recordSolve(puzzle('b'), 30, 1000);
    const id = await recordSolve(puzzle('a'), 75, 2000);
    expect(isTodo('a')).toBe(false);
    expect(loadHistory().map((e) => [e.puzzleId, e.elapsed])).toEqual([
      ['a', 75],
      ['b', 30],
    ]);
    rateSolve(id, 4);
    expect(loadHistory()[0].rating).toBe(4);
  });

  it('counts games per local day', () => {
    const noon = new Date(2026, 10, 5, 12).getTime();
    const counts = countByDay([{ solvedAt: noon }, { solvedAt: noon + 3600e3 }, { solvedAt: noon + 86400e3 }] as never);
    expect(counts.get('2026-11-05')).toBe(2);
    expect(counts.get('2026-11-06')).toBe(1);
    expect(dayKey(noon)).toBe('2026-11-05');
  });

  it('lays out whole weeks, Monday first, ending this week', () => {
    const weeks = calendarWeeks(new Date(2026, 10, 5), 53); // a Thursday
    expect(weeks).toHaveLength(53);
    expect(weeks[52]).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', null, null, null]);
    expect(weeks[0][0]).toBe('2025-11-03');
    expect(weeks.flat().filter(Boolean)).toHaveLength(52 * 7 + 4);
  });

  it('shades busier days darker', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(intensity)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});

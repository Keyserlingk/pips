import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYABLE_LEVELS } from '../model/levels';
import { quickPuzzle } from './generator';

const daily = (difficulty: (typeof PLAYABLE_LEVELS)[number], seed: number) =>
  quickPuzzle({ difficulty, seed, deterministic: true, maxPip: 6, allowDuplicates: false, requireUnique: true, extras: [] });

/** What a player sees: shape, regions with rules, tray. */
const view = (q: ReturnType<typeof daily>) =>
  q.ok ? JSON.stringify([q.width, q.height, q.cells, q.regions.map((r) => [r.cells, r.constraint]), q.dominoes]) : 'FAIL';

describe('deterministic generation', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(PLAYABLE_LEVELS)('%s: same seed gives the same puzzle whatever the clock does', (level) => {
    const t0 = performance.now();
    const normal = daily(level, 20261025);
    const ms = performance.now() - t0;
    // A "device" whose clock races ahead in big, uneven jumps: any time-based
    // decision would now go differently.
    let fake = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (fake += 7919 + (fake % 13) * 1000));
    const chaotic = daily(level, 20261025);
    vi.restoreAllMocks();
    console.log(`TIME ${level} ${Math.round(ms)} ms, ${normal.ok ? normal.stats.rating : 'fail'}`);
    expect(normal.ok).toBe(true);
    expect(view(chaotic)).toBe(view(normal));
  }, 120_000);

  it('different dates give different puzzles', () => {
    expect(view(daily('easy', 1))).not.toBe(view(daily('easy', 2)));
  });
});

describe('daily seeds', () => {
  it('differ by date and level, and are stable', async () => {
    const { dailySeed, todayKey } = await import('../model/daily');
    expect(dailySeed('2026-10-25', 'easy')).toBe(dailySeed('2026-10-25', 'easy'));
    expect(dailySeed('2026-10-25', 'easy')).not.toBe(dailySeed('2026-10-26', 'easy'));
    expect(dailySeed('2026-10-25', 'easy')).not.toBe(dailySeed('2026-10-25', 'hard'));
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

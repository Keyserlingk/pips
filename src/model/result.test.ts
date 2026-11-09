import { describe, expect, it } from 'vitest';
import { dayResultText, duration, praise, puzzleName, resultText } from './result';
import { DEFAULT_OPTIONS, type Difficulty, type Puzzle } from './types';

const puzzle = (over: Partial<Puzzle>): Puzzle => ({
  version: 1,
  id: 'x',
  title: 'Random Easy',
  width: 1,
  height: 1,
  cells: [],
  regions: [],
  dominoes: [],
  options: DEFAULT_OPTIONS,
  ...over,
});
const seeded = puzzle({ difficulty: 'easy', origin: { v: 1, level: 'easy', seed: 1, extras: false, fp: 'a' } });

describe('result', () => {
  it('writes durations for reading and for sharing', () => {
    expect(duration(224)).toBe('3 min 44 s');
    expect(duration(224, true)).toBe('3min 44s');
    expect(duration(44, true)).toBe('44s');
  });

  it('shares a random puzzle with its level, time, emoji and link, but no date', () => {
    expect(resultText(seeded, 224, 'https://x/#/s/1')).toBe('erkpips easy in 3min 44s 🟢\nhttps://x/#/s/1');
  });

  it('dates a daily puzzle by its own day, and says it is the daily', () => {
    const daily = puzzle({ id: 'daily-2026-11-05-expert', difficulty: 'expert' });
    expect(resultText(daily, 61, null)).toBe('erkpips 5/11/26 daily rachel in 1min 1s ⚫');
  });

  it('shares a whole day of daily puzzles with the total and each level', () => {
    const times: [Difficulty, number][] = [['easy', 62], ['medium', 123], ['hard', 240], ['expert', 301]];
    expect(dayResultText('2026-11-05', times, 'https://x/')).toBe(
      'erkpips 5/11/26 daily all 4 in 12min 6s\n🟢 1min 2s · 🟠 2min 3s · 🔴 4min 0s · ⚫ 5min 1s\nhttps://x/',
    );
  });

  it('names the puzzle in the message', () => {
    expect(puzzleName(seeded)).toBe('the Easy puzzle');
    expect(puzzleName(puzzle({ id: 'daily-2026-11-05-hard', difficulty: 'hard' }))).toBe('the daily Hard puzzle');
    expect(puzzleName(puzzle({ title: 'My test puzzle' }))).toBe('“My test puzzle”');
  });

  it('praises in a few ways', () => {
    expect(new Set([0, 0.3, 0.6, 0.99].map(praise)).size).toBe(4);
  });
});

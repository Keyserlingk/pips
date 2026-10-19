import { describe, expect, it } from 'vitest';
import type { Puzzle } from '../model/types';
import { isHost, normaliseCode, parseMsg, randomCode } from './protocol';
import { validFinish } from './referee';

// 2x2 board, one region "sum = 5" over the top row; tray [2,3] and [4,4].
const puzzle: Puzzle = {
  version: 1,
  id: 't',
  title: 't',
  width: 2,
  height: 2,
  cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 }, { r: 1, c: 1 }],
  regions: [{ id: 'a', color: 0, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }], constraint: { kind: 'sum', op: '=', value: 5 } }],
  dominoes: [[2, 3], [4, 4]],
  options: { maxPip: 6, allowDuplicates: false, requireUnique: true },
};

describe('duel referee', () => {
  it('accepts a correct finish', () => {
    expect(validFinish(puzzle, { 0: { anchor: { r: 0, c: 0 }, orient: 0 }, 1: { anchor: { r: 1, c: 0 }, orient: 0 } })).toBe(true);
  });
  it('rejects rule violations, overlaps, missing pieces and junk', () => {
    // 4+4 on top: sum 8, not 5
    expect(validFinish(puzzle, { 1: { anchor: { r: 0, c: 0 }, orient: 0 }, 0: { anchor: { r: 1, c: 0 }, orient: 0 } })).toBe(false);
    // overlapping
    expect(validFinish(puzzle, { 0: { anchor: { r: 0, c: 0 }, orient: 0 }, 1: { anchor: { r: 0, c: 0 }, orient: 1 } })).toBe(false);
    // one piece missing
    expect(validFinish(puzzle, { 0: { anchor: { r: 0, c: 0 }, orient: 0 } })).toBe(false);
    // off the board / garbage
    expect(validFinish(puzzle, { 0: { anchor: { r: 0, c: 1 }, orient: 0 }, 1: { anchor: { r: 1, c: 0 }, orient: 0 } })).toBe(false);
    expect(validFinish(puzzle, { 0: { orient: 9 } } as never)).toBe(false);
  });
});

describe('duel protocol', () => {
  it('room codes round-trip and reject typos', () => {
    const code = randomCode();
    expect(normaliseCode(code.toLowerCase())).toBe(code);
    expect(normaliseCode(' ab-cd ')).toBe('ABCD');
    expect(normaliseCode('AB1D')).toBeNull(); // 1 is not used
    expect(normaliseCode('ABC')).toBeNull();
  });
  it('picks exactly one host', () => {
    expect(isHost(true, false, 'b', 'a')).toBe(true);
    expect(isHost(false, true, 'a', 'b')).toBe(false);
    expect(isHost(true, true, 'a', 'b') !== isHost(true, true, 'b', 'a')).toBe(true);
    expect(isHost(false, false, 'a', 'b') !== isHost(false, false, 'b', 'a')).toBe(true);
  });
  it('ignores unknown messages', () => {
    expect(parseMsg('{"t":"hello","name":"x","host":true,"paired":false,"v":1}')).toMatchObject({ t: 'hello' });
    expect(parseMsg('{"t":"hack"}')).toBeNull();
    expect(parseMsg('not json')).toBeNull();
  });
});

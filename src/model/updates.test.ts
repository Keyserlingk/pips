import { describe, expect, it } from 'vitest';
import { isNewer, parseVersion, pendingUpdate } from './updates';

const DAY = 24 * 60 * 60 * 1000;
const v = (s: string) => parseVersion(s)!;

describe('update check', () => {
  it('reads release versions, not development builds', () => {
    expect(parseVersion('v1.2')).toEqual([1, 2]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('dev-1eb970e')).toBeNull();
  });

  it('compares versions by number', () => {
    expect(isNewer(v('1.10'), v('1.9'))).toBe(true);
    expect(isNewer(v('1.2'), v('1.2.0'))).toBe(false);
    expect(isNewer(v('2'), v('1.9.9'))).toBe(true);
    expect(isNewer(v('1.0'), v('1.1'))).toBe(false);
  });

  it('offers a newer release, and waits a day after "Later"', () => {
    const latest = { version: '1.2', url: 'https://github.com/Keyserlingk/pips/releases/tag/v1.2' };
    const now = 10 * DAY;
    expect(pendingUpdate({ checkedAt: now, latest }, '1.1', now)).toEqual(latest);
    expect(pendingUpdate({ checkedAt: now, latest }, '1.2', now)).toBeNull();
    expect(pendingUpdate({ checkedAt: now, latest }, 'dev-abc', now)).toBeNull();
    expect(pendingUpdate({ checkedAt: now, latest, dismissedAt: now - DAY / 2 }, '1.1', now)).toBeNull();
    expect(pendingUpdate({ checkedAt: now, latest, dismissedAt: now - DAY }, '1.1', now)).toEqual(latest);
    expect(pendingUpdate(null, '1.1', now)).toBeNull();
  });
});

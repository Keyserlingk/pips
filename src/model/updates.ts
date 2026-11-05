import { type UpdateState, loadUpdateState, saveUpdateState } from './storage';

/*
 * Update check for the Android app: at most once a day it asks GitHub for the
 * latest release and compares its tag (v1.2) with the installed version.
 * The website needs none of this: it is always the latest.
 */

const LATEST_RELEASE = 'https://api.github.com/repos/Keyserlingk/pips/releases/latest';
const DAY = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** "1.2" or "v1.2.3" → [1, 2] / [1, 2, 3]; anything else (a "dev-…" build) → null. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)$/.exec(v.trim());
  return m ? m[1].split('.').map(Number) : null;
}

/** Is version `a` newer than `b`? 1.10 is newer than 1.9; 1.2 and 1.2.0 are the same. */
export function isNewer(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** What to offer: a newer release, unless the player said "Later" within the last day. */
export function pendingUpdate(state: UpdateState | null, current: string, now: number) {
  const installed = parseVersion(current);
  const latest = state?.latest;
  const version = latest && parseVersion(latest.version);
  if (!installed || !latest || !version || !isNewer(version, installed)) return null;
  if (state.dismissedAt && now - state.dismissedAt < DAY) return null;
  return latest;
}

/** Asks GitHub if a day has passed since the last time; quietly gives up when offline. */
export async function checkForUpdate(current: string, now = Date.now()) {
  if (!parseVersion(current)) return null; // development builds don't update
  let state = loadUpdateState();
  if (!state || now - state.checkedAt >= DAY) {
    try {
      const res = await fetch(LATEST_RELEASE, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const r = (await res.json()) as { tag_name: string; html_url: string };
        state = { ...state, checkedAt: now, latest: { version: r.tag_name.replace(/^v/, ''), url: r.html_url } };
        saveUpdateState(state);
      }
    } catch {
      // Offline or GitHub unreachable: try again next start.
    }
  }
  return pendingUpdate(state, current, now);
}

export function dismissUpdate(now = Date.now()) {
  const state = loadUpdateState();
  if (state) saveUpdateState({ ...state, dismissedAt: now });
}

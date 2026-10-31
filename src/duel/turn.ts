/*
 * TURN relay logins for duels, fetched from our Cloudflare Worker
 * (turn-worker/). The relay is only used when the two browsers can't reach
 * each other directly. If the Worker isn't configured or doesn't answer in
 * time, duels go ahead without it, direct connections only.
 */

export interface TurnServer {
  urls: string | string[];
  username: string;
  credential: string;
}

const TURN_URL: string | undefined = import.meta.env.VITE_TURN_URL;
/** Give up on the Worker after this long so joining a room is never held up for long. */
const FETCH_TIMEOUT_MS = 4000;
/** Fetch fresh logins once this much of their lifetime has passed. */
const REFRESH_FRACTION = 0.5;

let cached: { servers: TurnServer[]; freshUntil: number } | null = null;
let pending: Promise<TurnServer[]> | null = null;

export function getTurnServers(): Promise<TurnServer[]> {
  if (!TURN_URL) return Promise.resolve([]);
  if (cached && Date.now() < cached.freshUntil) return Promise.resolve(cached.servers);
  pending ??= fetchServers(TURN_URL).finally(() => (pending = null));
  return pending;
}

async function fetchServers(url: string): Promise<TurnServer[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = (await res.json()) as { iceServers?: TurnServer[]; ttl?: number };
    const servers = Array.isArray(data.iceServers) ? data.iceServers : [];
    cached = { servers, freshUntil: Date.now() + (data.ttl ?? 0) * 1000 * REFRESH_FRACTION };
    return servers;
  } catch {
    return [];
  }
}

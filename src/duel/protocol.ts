import type { Difficulty } from '../model/types';
import type { PlayState } from '../model/storage';

/** Bump when messages change incompatibly; mismatched players are told to reload. */
export const PROTOCOL = 1;

export type Placed = PlayState['placed'];

/** Messages between the two players. The host is the referee. */
export type DuelMsg =
  /** `paired`: the sender already has an opponent (a newcomer then knows the room is full). */
  | { t: 'hello'; name: string; host: boolean; paired: boolean; v: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'level'; difficulty: Difficulty }
  | { t: 'lobby' }
  | { t: 'generating'; round: number }
  | { t: 'puzzle'; round: number; code: string }
  | { t: 'loaded'; round: number }
  | { t: 'go'; round: number; inMs: number }
  | { t: 'progress'; round: number; placed: number }
  | { t: 'finished'; round: number; ms: number; placed: Placed }
  | { t: 'result'; round: number; winner: 'host' | 'guest'; hostMs: number | null; guestMs: number | null }
  | { t: 'emoji'; e: string }
  | { t: 'leave' };

/** The only reactions players can send (anything else is dropped): trash talk only. */
export const EMOJIS = ['🌶️', '🔥', '😈', '😏', '😤', '💀', '🥵', '👀'] as const;

const TYPES = new Set([
  'hello', 'ready', 'level', 'lobby', 'generating', 'puzzle', 'loaded', 'go', 'progress', 'finished', 'result', 'emoji', 'leave',
]);

export function parseMsg(raw: unknown): DuelMsg | null {
  try {
    const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return msg && typeof msg === 'object' && TYPES.has(msg.t) ? (msg as DuelMsg) : null;
  } catch {
    return null;
  }
}

// Room codes: no 0/O, 1/I/L, so they are easy to read out loud.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function normaliseCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_CHARS.includes(ch)) ? code : null;
}

/**
 * Who referees: the one who created the room. If both or neither claim it
 * (two people opened the same kind of link), the lower peer id does.
 */
export function isHost(iClaim: boolean, theyClaim: boolean, myId: string, theirId: string): boolean {
  if (iClaim !== theyClaim) return iClaim;
  return myId < theirId;
}

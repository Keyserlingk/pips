import type { Difficulty, Puzzle, SeedOrigin } from './types';
import { loadHistory, loadTodo, saveHistory, saveTodo } from './storage';
import { canShareSeed } from './seedLink';
import { encodeShare } from './serialize';
import { GENERATOR_VERSION } from '../engine/version';
import { newId } from './cells';

/*
 * History of solved games, and the to-do list of puzzles set aside to finish
 * later. Each entry keeps how to bring its puzzle back, as small as possible:
 * a random puzzle's seed, a daily puzzle's date and level, or else the whole
 * puzzle (compressed, as in share links).
 */

export type PuzzleRef =
  | { kind: 'seed'; origin: SeedOrigin }
  | { kind: 'daily'; date: string; level: Difficulty }
  | { kind: 'puzzle'; code: string };

interface Entry {
  id: string;
  puzzleId: string;
  title: string;
  difficulty?: Difficulty;
  ref: PuzzleRef;
}

export interface HistoryEntry extends Entry {
  /** When it was solved (ms since epoch). */
  solvedAt: number;
  /** Seconds taken. */
  elapsed: number;
  /** The player's rating, 1–5 stars. */
  rating?: number;
}

export interface TodoEntry extends Entry {
  addedAt: number;
}

const DAILY_ID = /^daily-(\d{4}-\d{2}-\d{2})-([a-z]+)$/;

export async function refFor(p: Puzzle): Promise<PuzzleRef> {
  const daily = DAILY_ID.exec(p.id);
  if (daily) return { kind: 'daily', date: daily[1], level: daily[2] as Difficulty };
  if (canShareSeed(p, GENERATOR_VERSION)) return { kind: 'seed', origin: p.origin! };
  // No solution in the stored copy: it is the player's own record, and Reveal can work it out again.
  return { kind: 'puzzle', code: await encodeShare({ ...p, solution: undefined }) };
}

const entryFor = async (p: Puzzle): Promise<Entry> => ({
  id: newId(),
  puzzleId: p.id,
  title: p.title || 'Untitled',
  difficulty: p.difficulty,
  ref: await refFor(p),
});

/** Records a solve (newest first) and takes the puzzle off the to-do list. Returns the entry's id. */
export async function recordSolve(p: Puzzle, elapsed: number, now = Date.now()): Promise<string> {
  const entry: HistoryEntry = { ...(await entryFor(p)), solvedAt: now, elapsed };
  saveHistory([entry, ...loadHistory()]);
  removeTodo(p.id);
  return entry.id;
}

export function rateSolve(id: string, rating: number | undefined) {
  saveHistory(loadHistory().map((e) => (e.id === id ? { ...e, rating } : e)));
}

export function deleteSolve(id: string) {
  saveHistory(loadHistory().filter((e) => e.id !== id));
}

export const isTodo = (puzzleId: string) => loadTodo().some((t) => t.puzzleId === puzzleId);

export async function addTodo(p: Puzzle, now = Date.now()) {
  if (isTodo(p.id)) return;
  saveTodo([{ ...(await entryFor(p)), addedAt: now }, ...loadTodo()]);
}

export function removeTodo(puzzleId: string) {
  const todo = loadTodo();
  if (todo.some((t) => t.puzzleId === puzzleId)) saveTodo(todo.filter((t) => t.puzzleId !== puzzleId));
}

/** Local date (YYYY-MM-DD) of a moment: calendar days follow the player's clock. */
export function dayKey(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Games solved per local day. */
export function countByDay(history: HistoryEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of history) counts.set(dayKey(e.solvedAt), (counts.get(dayKey(e.solvedAt)) ?? 0) + 1);
  return counts;
}

/**
 * The calendar's columns: whole weeks (Monday first) ending with the current
 * one, `weeks` of them. Days after today are null.
 */
export function calendarWeeks(today: Date, weeks: number): (string | null)[][] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 7 * (weeks - 1));
  const end = dayKey(today.getTime());
  const out: (string | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: (string | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const key = dayKey(day.getTime());
      col.push(key <= end ? key : null);
    }
    out.push(col);
  }
  return out;
}

/** Colour step 0–4 for a day's count, like GitHub's contribution graph. */
export const intensity = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4);

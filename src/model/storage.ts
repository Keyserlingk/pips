import type { Cell, Puzzle } from './types';

const LIB = 'pips.library';
const QUICK = 'pips.quick';
const REMIX = 'pips.remix';
const PROGRESS = 'pips.progress.';
const THEME = 'pips.theme';

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const loadLibrary = (): Puzzle[] => read<Puzzle[]>(LIB) ?? [];
export const getPuzzle = (id: string) => loadLibrary().find((p) => p.id === id) ?? null;
export function savePuzzle(p: Puzzle) {
  const lib = loadLibrary();
  const i = lib.findIndex((x) => x.id === p.id);
  if (i >= 0) lib[i] = p;
  else lib.unshift(p);
  write(LIB, lib);
}
export function deletePuzzle(id: string) {
  write(LIB, loadLibrary().filter((p) => p.id !== id));
  write(PROGRESS + id, null);
}

export const loadQuick = () => read<Puzzle>(QUICK);
export const saveQuick = (p: Puzzle) => write(QUICK, p);

/** A puzzle handed to the editor as the starting point for a copy. */
export const loadRemix = () => read<Puzzle>(REMIX);
export const saveRemix = (p: Puzzle) => write(REMIX, p);

export type Orient = 0 | 1 | 2 | 3;
export interface PlayState {
  placed: Record<number, { anchor: Cell; orient: Orient }>;
  tray: Record<number, Orient>;
  elapsed: number;
  solved: boolean;
  /** Saved board setups the player can go back to (missing in older saves). */
  snapshots?: Snapshot[];
}

export interface Snapshot {
  id: string;
  /** Timer value (seconds) when it was taken. */
  at: number;
  placed: PlayState['placed'];
  tray: PlayState['tray'];
}
export const loadProgress = (id: string) => read<PlayState>(PROGRESS + id);
export const saveProgress = (id: string, s: PlayState | null) => write(PROGRESS + id, s);

// Daily puzzles, cached per device so each is generated once.
const DAILY = 'pips.daily.';
const DAILY_KEEP_DAYS = 14;
export const loadDaily = (date: string, level: string) => read<Puzzle>(`${DAILY}${date}.${level}`);
export function saveDaily(date: string, level: string, p: Puzzle) {
  write(`${DAILY}${date}.${level}`, p);
  try {
    // Forget cached daily puzzles older than two weeks.
    const cutoff = new Date(Date.now() - DAILY_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const k of Object.keys(localStorage))
      if (k.startsWith(DAILY) && k.slice(DAILY.length, DAILY.length + 10) < cutoff) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

/** The name shown to duel opponents. */
export const loadName = () => read<string>('pips.name') ?? '';
export const saveName = (name: string) => write('pips.name', name);

export const loadTheme = () => read<string>(THEME) ?? 'classic';
export const saveTheme = (t: string) => write(THEME, t);

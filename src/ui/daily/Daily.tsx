import { useEffect, useState } from 'react';
import type { Difficulty, Puzzle } from '../../model/types';
import { DEFAULT_OPTIONS } from '../../model/types';
import { dailyId, dailySeed, formatDay, todayKey } from '../../model/daily';
import { PLAYABLE_LEVELS, levelLabel } from '../../model/levels';
import { loadDaily, loadProgress, saveDaily } from '../../model/storage';
import { runEngine } from '../../engine/client';
import { Play } from '../play/Play';

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Generation keeps running when you leave the Daily page, and is never started
// twice for the same puzzle.
const inflight = new Map<string, Promise<Puzzle>>();

/** Today's (or any date's) puzzle for a level: from the device cache, or generated once. */
export function dailyPuzzle(date: string, level: Difficulty): Promise<Puzzle> {
  const cached = loadDaily(date, level);
  if (cached) return Promise.resolve(cached);
  const key = `${date}.${level}`;
  let job = inflight.get(key);
  if (!job) {
    job = runEngine('quick', {
      ...DEFAULT_OPTIONS,
      extras: [],
      difficulty: level,
      seed: dailySeed(date, level),
      deterministic: true,
    }).promise.then((q) => {
      if (!q.ok) throw new Error(q.error);
      const puzzle: Puzzle = {
        version: 1,
        id: dailyId(date, level),
        title: `Daily ${levelLabel(level)} · ${formatDay(date)}`,
        difficulty: q.stats.rating,
        width: q.width,
        height: q.height,
        cells: q.cells,
        regions: q.regions,
        dominoes: q.dominoes,
        options: { ...DEFAULT_OPTIONS },
      };
      saveDaily(date, level, puzzle);
      return puzzle;
    });
    job.finally(() => inflight.delete(key)).catch(() => {});
    inflight.set(key, job);
  }
  return job;
}

/** How far the player got with a daily puzzle on this device. */
export function dailyStatus(date: string, level: Difficulty) {
  const p = loadProgress(dailyId(date, level));
  if (!p) return { state: 'new' as const, elapsed: 0 };
  return { state: p.solved ? ('solved' as const) : ('started' as const), elapsed: p.elapsed };
}

export const solvedToday = () => PLAYABLE_LEVELS.filter((l) => dailyStatus(todayKey(), l).state === 'solved').length;

// ------------------------------------------------------------- #/daily

export function DailyHome({ go }: { go: (hash: string) => void }) {
  const date = todayKey();
  const [ready, setReady] = useState<Partial<Record<Difficulty, Puzzle | 'error'>>>(() =>
    Object.fromEntries(PLAYABLE_LEVELS.map((l) => [l, loadDaily(date, l) ?? undefined])),
  );

  // Prepare all four at once (each in its own worker): the wait is the slowest one, not the sum.
  useEffect(() => {
    let live = true;
    for (const level of PLAYABLE_LEVELS)
      dailyPuzzle(date, level).then(
        (p) => live && setReady((r) => ({ ...r, [level]: p })),
        () => live && setReady((r) => ({ ...r, [level]: 'error' })),
      );
    return () => {
      live = false;
    };
  }, [date]);

  return (
    <div className="daily">
      <section className="hero">
        <h1>📅 Daily puzzles</h1>
        <p className="muted">
          {formatDay(date)} · the same four puzzles for everyone today. New ones at midnight.
        </p>
      </section>
      <div className="quick">
        {PLAYABLE_LEVELS.map((level) => {
          const p = ready[level];
          const status = dailyStatus(date, level);
          return (
            <button
              key={level}
              className={`quick-card ${level} ${status.state === 'solved' ? 'solved' : ''}`}
              disabled={!p || p === 'error'}
              onClick={() => go(`#/daily/${date}/${level}`)}
            >
              <span className="quick-label">{levelLabel(level)}</span>
              <span className="muted small">
                {p === 'error'
                  ? 'Could not prepare'
                  : !p
                    ? 'Preparing…'
                    : status.state === 'solved'
                      ? `✓ ${formatTime(status.elapsed)}`
                      : status.state === 'started'
                        ? `In progress · ${formatTime(status.elapsed)}`
                        : 'Play'}
              </span>
            </button>
          );
        })}
      </div>
      <p className="muted small center">
        Puzzles are prepared on your device the first time you open them today (Rachel can take a little while on a
        phone).
      </p>
      <div className="row center">
        <button className="btn ghost" onClick={() => go('#/')}>
          Home
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------- #/daily/<date>/<level>

export function DailyPlay({ date, level, go }: { date: string; level: Difficulty; go: (hash: string) => void }) {
  const [puzzle, setPuzzle] = useState<Puzzle | null | 'error'>(() => loadDaily(date, level));
  useEffect(() => {
    if (puzzle) return;
    let live = true;
    dailyPuzzle(date, level).then(
      (p) => live && setPuzzle(p),
      () => live && setPuzzle('error'),
    );
    return () => {
      live = false;
    };
  }, [date, level, puzzle]);

  if (puzzle === 'error')
    return (
      <section className="panel">
        <p>Could not prepare this puzzle.</p>
        <button className="btn" onClick={() => go('#/daily')}>
          Back
        </button>
      </section>
    );
  if (!puzzle)
    return (
      <section className="panel center">
        <span className="spinner" /> Preparing the daily {levelLabel(level)} puzzle…
      </section>
    );
  return <Play key={puzzle.id} puzzle={puzzle} source="daily" onHome={() => go('#/daily')} />;
}

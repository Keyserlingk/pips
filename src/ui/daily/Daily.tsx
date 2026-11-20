import { useEffect, useRef, useState } from 'react';
import type { Difficulty, Puzzle } from '../../model/types';
import { DEFAULT_OPTIONS } from '../../model/types';
import { dailyId, dailySeed, formatDay, solvedDayTimes, todayKey } from '../../model/daily';
import { dayResultText } from '../../model/result';
import { pageUrl } from '../../model/site';
import { PLAYABLE_LEVELS, levelClass, levelLabel } from '../../model/levels';
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

/** Seconds spent on today's daily puzzles so far, solved or not. */
export const dailyTimeToday = () => PLAYABLE_LEVELS.reduce((sum, l) => sum + dailyStatus(todayKey(), l).elapsed, 0);

// ------------------------------------------------------------- #/daily

/** Total time on today's four puzzles; shown once one has been started. */
function DailyTotal() {
  const [copied, setCopied] = useState<string | null>(null);
  const solved = solvedToday();
  const seconds = dailyTimeToday();
  if (!seconds) return null;
  const all = solved === PLAYABLE_LEVELS.length;
  const shareDay = async () => {
    try {
      const times = solvedDayTimes(todayKey());
      await navigator.clipboard.writeText(dayResultText(todayKey(), times, PLAYABLE_LEVELS.length, pageUrl()));
      setCopied('Result copied');
    } catch {
      setCopied('Could not copy the result');
    }
    setTimeout(() => setCopied(null), 1800);
  };
  return (
    <p className="daily-total center">
      {all ? 'All four solved in ' : 'Total today: '}
      <strong>{formatTime(seconds)}</strong>
      {!all && <span className="muted"> · {solved}/{PLAYABLE_LEVELS.length} solved</span>}
      {solved > 0 && (
        <>
          <br />
          <button className="btn share-day" onClick={shareDay}>
            {copied ?? '📋 Share result'}
          </button>
        </>
      )}
    </p>
  );
}

/** The start page: today's four daily puzzles, and the way to everything else. */
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
        <h1>Today's puzzles</h1>
        <p className="muted">{formatDay(date).replace(',', '')} · New ones at midnight!</p>
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
      <DailyTotal />
      <div className="row center more-entry">
        <button className="btn" onClick={() => go('#/more')}>
          🎲 More ways to play
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------- #/daily/<date>/<level>

/** Which way the last switch between a day's puzzles went, so the new one slides in from that side. */
let slideFrom: 'left' | 'right' | null = null;

/** A sideways swipe on the play screen, not a domino drag or a vertical scroll. */
function useSwipe(ref: React.RefObject<HTMLElement>, onSwipe: (dir: 'left' | 'right') => void) {
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      // Play cancels touches that start on a domino on the board (they are drags), so does the tray.
      const target = e.target as Element;
      start =
        e.touches.length === 1 && !e.defaultPrevented && !target.closest('.tray-domino, .parked, .menu, .modal-backdrop, .snapshots')
          ? { x: t.clientX, y: t.clientY, t: Date.now() }
          : null;
    };
    const up = (e: TouchEvent) => {
      if (!start || document.querySelector('.drag-ghost')) return (start = null);
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const quick = Date.now() - start.t < 700;
      start = null;
      if (quick && Math.abs(dx) > 60 && Math.abs(dx) > 1.8 * Math.abs(dy)) cb.current(dx < 0 ? 'left' : 'right');
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchend', up, { passive: true });
    el.addEventListener('touchcancel', () => (start = null));
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchend', up);
    };
  }, [ref]);
}

/** The day's levels as dots: shows where you are, and taps through to the others. */
function LevelStrip({ date, level, open }: { date: string; level: Difficulty; open: (l: Difficulty) => void }) {
  const i = PLAYABLE_LEVELS.indexOf(level);
  const prev = PLAYABLE_LEVELS[i - 1];
  const nextLevel = PLAYABLE_LEVELS[i + 1];
  return (
    <nav className="level-strip" aria-label="Today's puzzles">
      <button className="link-arrow" disabled={!prev} onClick={() => prev && open(prev)} aria-label={prev ? `Previous: ${levelLabel(prev)}` : undefined}>
        ‹
      </button>
      {PLAYABLE_LEVELS.map((l) => {
        const status = dailyStatus(date, l).state;
        return (
          <button
            key={l}
            className={`level-dot ${levelClass(l)}${l === level ? ' on' : ''}${status === 'solved' ? ' solved' : ''}`}
            onClick={() => l !== level && open(l)}
            aria-current={l === level ? 'page' : undefined}
          >
            {status === 'solved' ? '✓ ' : ''}
            {levelLabel(l)}
          </button>
        );
      })}
      <button className="link-arrow" disabled={!nextLevel} onClick={() => nextLevel && open(nextLevel)} aria-label={nextLevel ? `Next: ${levelLabel(nextLevel)}` : undefined}>
        ›
      </button>
    </nav>
  );
}

export function DailyPlay({ date, level, go }: { date: string; level: Difficulty; go: (hash: string) => void }) {
  const [puzzle, setPuzzle] = useState<Puzzle | null | 'error'>(() => loadDaily(date, level));
  const [slide] = useState(() => {
    const s = slideFrom;
    slideFrom = null;
    return s;
  });
  const wrapRef = useRef<HTMLDivElement>(null);
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

  // Switching between a day's puzzles replaces the page, so Back still goes to the start page.
  const open = (l: Difficulty) => {
    slideFrom = PLAYABLE_LEVELS.indexOf(l) > PLAYABLE_LEVELS.indexOf(level) ? 'right' : 'left';
    location.replace(`#/daily/${date}/${l}`);
  };
  const i = PLAYABLE_LEVELS.indexOf(level);
  useSwipe(wrapRef, (dir) => {
    const to = PLAYABLE_LEVELS[dir === 'left' ? i + 1 : i - 1];
    if (to) open(to);
  });

  // After a solve: the easiest of the day's puzzles still to do, or the celebration once they are all done.
  const remaining = PLAYABLE_LEVELS.filter((l) => l !== level && dailyStatus(date, l).state !== 'solved');
  const nextLevel = remaining[0];

  let body: JSX.Element;
  if (puzzle === 'error')
    body = (
      <section className="panel">
        <p>Could not prepare this puzzle.</p>
        <button className="btn" onClick={() => go('#/daily')}>
          Back
        </button>
      </section>
    );
  else if (!puzzle)
    body = (
      <section className="panel center">
        <span className="spinner" /> Preparing the daily {levelLabel(level)} puzzle…
      </section>
    );
  else
    body = (
      <Play
        key={puzzle.id}
        puzzle={puzzle}
        source="daily"
        onHome={() => go('#/')}
        next={nextLevel ? { label: `Next: ${levelLabel(nextLevel)} →`, run: () => open(nextLevel) } : null}
        dayComplete={!nextLevel}
      />
    );
  return (
    <div ref={wrapRef} className={`daily-play${slide ? ` slide-from-${slide}` : ''}`}>
      <LevelStrip date={date} level={level} open={open} />
      {body}
    </div>
  );
}

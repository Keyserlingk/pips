import { useEffect, useMemo, useState } from 'react';
import type { Puzzle } from '../../model/types';
import {
  type HistoryEntry,
  type PuzzleRef,
  calendarWeeks,
  countByDay,
  dayKey,
  intensity,
  rateSolve,
  removeTodo,
} from '../../model/history';
import { loadHistory, loadProgress, loadTodo } from '../../model/storage';
import { decodeShare } from '../../model/serialize';
import { randomPuzzle, seedOptions } from '../../model/seedLink';
import { formatDay } from '../../model/daily';
import { levelClass, levelLabel } from '../../model/levels';
import { runEngine } from '../../engine/client';
import { dailyPuzzle } from '../daily/Daily';
import { Play } from '../play/Play';
import { Stars } from './Stars';

const WEEKS = 53;
const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Brings a stored puzzle back: regenerated from its seed or date, or decoded. */
export async function resolveRef(ref: PuzzleRef): Promise<Puzzle | null> {
  if (ref.kind === 'daily') return dailyPuzzle(ref.date, ref.level);
  if (ref.kind === 'puzzle') return decodeShare(ref.code);
  const res = await runEngine('quick', seedOptions(ref.origin)).promise;
  if (!res.ok) return null;
  const p = randomPuzzle(res, ref.origin);
  return p.origin!.fp === ref.origin.fp ? p : null;
}

function Tabs({ tab, go }: { tab: 'history' | 'todo'; go: (h: string) => void }) {
  const todo = loadTodo().length;
  return (
    <div className="play-bar">
      <button className="btn ghost" onClick={() => go('#/')}>
        ← Back
      </button>
      <div className="seg history-tabs">
        <button className={tab === 'history' ? 'on' : ''} onClick={() => go('#/history')}>
          History
        </button>
        <button className={tab === 'todo' ? 'on' : ''} onClick={() => go('#/todo')}>
          To do{todo ? ` (${todo})` : ''}
        </button>
      </div>
      <span />
    </div>
  );
}

function Calendar({ counts, selected, onSelect }: { counts: Map<string, number>; selected: string | null; onSelect: (d: string | null) => void }) {
  const weeks = useMemo(() => calendarWeeks(new Date(), WEEKS), []);
  // A month's name above the first week that starts in it.
  const months = weeks.map((w, i) => {
    const first = w.find(Boolean);
    const prev = i > 0 ? weeks[i - 1].find(Boolean) : null;
    return first && (!prev || first.slice(5, 7) !== prev.slice(5, 7)) && first.slice(8) <= '07'
      ? new Date(first).toLocaleDateString('en-GB', { month: 'short' })
      : '';
  });
  return (
    <div className="calendar-wrap" ref={(el) => el && (el.scrollLeft = el.scrollWidth)}>
      <div className="calendar" style={{ gridTemplateColumns: `repeat(${WEEKS}, var(--day))` }}>
        {months.map((m, i) => (
          <span key={`m${i}`} className="calendar-month" style={{ gridColumn: i + 1, gridRow: 1 }}>
            {m}
          </span>
        ))}
        {weeks.map((w, i) =>
          w.map((d, j) =>
            d ? (
              <button
                key={d}
                className={`day l${intensity(counts.get(d) ?? 0)}${selected === d ? ' sel' : ''}`}
                style={{ gridColumn: i + 1, gridRow: j + 2 }}
                title={`${formatDay(d)}: ${counts.get(d) ?? 0} solved`}
                aria-label={`${formatDay(d)}: ${counts.get(d) ?? 0} solved`}
                onClick={() => onSelect(selected === d ? null : d)}
              />
            ) : null,
          ),
        )}
      </div>
    </div>
  );
}

export function HistoryPage({ go }: { go: (h: string) => void }) {
  const [history, setHistory] = useState(loadHistory);
  const [day, setDay] = useState<string | null>(null);
  const counts = useMemo(() => countByDay(history), [history]);
  const shown = day ? history.filter((e) => dayKey(e.solvedAt) === day) : history;

  // Newest first, under a heading per day.
  const groups: [string, HistoryEntry[]][] = [];
  for (const e of shown) {
    const k = dayKey(e.solvedAt);
    const last = groups[groups.length - 1];
    if (last?.[0] === k) last[1].push(e);
    else groups.push([k, [e]]);
  }

  const rate = (id: string, n: number | undefined) => {
    rateSolve(id, n);
    setHistory(loadHistory());
  };

  return (
    <div className="history">
      <Tabs tab="history" go={go} />
      <section className="panel">
        <p className="muted small history-total">
          {history.length} {history.length === 1 ? 'game' : 'games'} solved
          {day && (
            <>
              {' '}
              · showing {formatDay(day)}{' '}
              <button className="link" onClick={() => setDay(null)}>
                show all
              </button>
            </>
          )}
        </p>
        <Calendar counts={counts} selected={day} onSelect={setDay} />
        <div className="calendar-legend muted small">
          Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`day l${l}`} />)} More
        </div>
      </section>
      {groups.length === 0 ? (
        <p className="muted center">{day ? 'Nothing solved that day.' : 'Solved puzzles show up here.'}</p>
      ) : (
        groups.map(([d, entries]) => (
          <section key={d} className="history-day">
            <h4>{formatDay(d)}</h4>
            <ul className="history-list">
              {entries.map((e) => (
                <li key={e.id} className="panel history-item">
                  <div>
                    <strong>{e.title}</strong>{' '}
                    {e.difficulty && <span className={`pill ${levelClass(e.difficulty)}`}>{levelLabel(e.difficulty)}</span>}
                    <div className="muted small">
                      {formatTime(e.elapsed)} ·{' '}
                      {new Date(e.solvedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <Stars value={e.rating} onChange={(n) => rate(e.id, n)} />
                  <button className="btn ghost" onClick={() => go(`#/history/${e.id}`)}>
                    Revisit
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

export function TodoPage({ go }: { go: (h: string) => void }) {
  const [todo, setTodo] = useState(loadTodo);
  return (
    <div className="history">
      <Tabs tab="todo" go={go} />
      {todo.length === 0 ? (
        <p className="muted center">Puzzles you add to your to-do list (📌 in a puzzle) wait here until you solve them.</p>
      ) : (
        <ul className="history-list">
          {todo.map((t) => {
            const progress = loadProgress(t.puzzleId);
            const placed = progress ? Object.keys(progress.placed).length : 0;
            return (
              <li key={t.id} className="panel history-item">
                <div>
                  <strong>{t.title}</strong>{' '}
                  {t.difficulty && <span className={`pill ${levelClass(t.difficulty)}`}>{levelLabel(t.difficulty)}</span>}
                  <div className="muted small">
                    {progress ? `${formatTime(progress.elapsed)} played · ${placed} placed` : 'Not started'} · added{' '}
                    {formatDay(dayKey(t.addedAt))}
                  </div>
                </div>
                <button className="btn" onClick={() => go(`#/todo/${t.id}`)}>
                  Continue
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    removeTodo(t.puzzleId);
                    setTodo(loadTodo());
                  }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A history or to-do entry's puzzle, brought back and opened where it was left. */
export function SavedPlay({ list, id, go }: { list: 'history' | 'todo'; id: string; go: (h: string) => void }) {
  const entry = (list === 'history' ? loadHistory() : loadTodo()).find((e) => e.id === id);
  const [puzzle, setPuzzle] = useState<Puzzle | null | undefined>(undefined);
  useEffect(() => {
    if (!entry) return setPuzzle(null);
    let live = true;
    resolveRef(entry.ref).then(
      (p) => live && setPuzzle(p),
      () => live && setPuzzle(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const back = () => go(list === 'history' ? '#/history' : '#/todo');
  if (puzzle === undefined) return <p className="muted">Opening puzzle…</p>;
  if (!puzzle)
    return (
      <div className="panel">
        <p>This puzzle can't be opened any more.</p>
        <button className="btn" onClick={back}>
          Back
        </button>
      </div>
    );
  return <Play key={puzzle.id} puzzle={puzzle} source={entry!.ref.kind === 'daily' ? 'daily' : 'shared'} onHome={back} />;
}

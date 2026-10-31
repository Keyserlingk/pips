import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Cell, Puzzle } from '../../model/types';
import { DIRS, add, constraintRule, evaluate, key, newId, ruleKey, sameCell } from '../../model/cells';
import { type Orient, type PlayState, type Snapshot, getPuzzle, loadProgress, savePuzzle, saveProgress } from '../../model/storage';
import { samePuzzle, shareUrl } from '../../model/serialize';
import { runEngine } from '../../engine/client';
import { levelClass, levelLabel } from '../../model/levels';
import { Board, type BoardDomino, boardFrame, boardPoint, cellAt, cellPixels } from '../board/Board';
import { DominoShape, S } from '../board/DominoShape';
import { type Parked, type Rect, dropRect, findSpot, inside, parkedRect, turned, within } from './parking';

const fresh = (): PlayState => ({ placed: {}, tray: {}, elapsed: 0, solved: false });

/** Oldest snapshots are dropped beyond this. */
const MAX_SNAPSHOTS = 12;

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Which half is drawn left/top for a given orientation. */
const firstHalf = (o: Orient): 0 | 1 => (o < 2 ? 0 : 1);
const isHorizontal = (o: Orient) => o % 2 === 0;

type Source = 'tray' | 'board' | 'parked';

/** The board's position inside the table around it, and the table's extent in cells. */
interface TableFrame {
  ox: number;
  oy: number;
  px: number;
  bounds: Rect;
}

interface DragInfo {
  idx: number;
  half: 0 | 1;
  orient: Orient;
  from: Source;
  startX: number;
  startY: number;
  moved: boolean;
}

type SavedState = 'none' | 'saved' | 'changed';

/** Hooks for a race (live race or ghost race): the race screen owns the clock and the result. */
export interface RaceHooks {
  /** When this round started (local clock, ms since epoch). */
  startAt: number;
  /** No more moves (the round is over). */
  locked: boolean;
  onProgress: (placed: number) => void;
  /** Called once, with the final placements (checked by the referee) and the time taken. */
  onSolved: (placed: PlayState['placed'], ms: number) => void;
}

/** Is this puzzle in the library, and is the stored copy the same as this one? */
function libraryState(puzzle: Puzzle): SavedState {
  const stored = getPuzzle(puzzle.id);
  return !stored ? 'none' : samePuzzle(stored, puzzle) ? 'saved' : 'changed';
}

export function Play({
  puzzle,
  source,
  onHome,
  onEdit,
  onRemix,
  race,
}: {
  puzzle: Puzzle;
  /** Where the puzzle came from: the library, a random puzzle, a share link, or the daily set. */
  source: 'local' | 'quick' | 'shared' | 'daily';
  onHome: () => void;
  onEdit?: () => void;
  onRemix?: () => void;
  /** Present during a race: no saving, sharing or revealing, and a shared clock. */
  race?: RaceHooks;
}) {
  const [savedState, setSavedState] = useState<SavedState>(() => libraryState(puzzle));
  const [solution, setSolution] = useState(puzzle.solution);
  const [st, setSt] = useState<PlayState>(() => (race ? null : loadProgress(puzzle.id)) ?? fresh());
  const [drag, setDrag] = useState<{ idx: number; half: 0 | 1; orient: Orient; x: number; y: number; px: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<TableFrame | null>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const active = useMemo(() => new Set(puzzle.cells.map(key)), [puzzle]);

  const raceRef = useRef(race);
  raceRef.current = race;
  const startAt = race?.startAt;

  useEffect(() => {
    if (!raceRef.current) saveProgress(puzzle.id, st);
  }, [puzzle.id, st]);

  // Timer. In a race it follows the shared start time, so it can't drift or pause.
  useEffect(() => {
    if (st.solved) return;
    const t = setInterval(() => {
      if (startAt !== undefined) setSt((s) => ({ ...s, elapsed: Math.max(0, Math.floor((Date.now() - startAt) / 1000)) }));
      else if (!document.hidden) setSt((s) => ({ ...s, elapsed: s.elapsed + 1 }));
    }, startAt !== undefined ? 250 : 1000);
    return () => clearInterval(t);
  }, [st.solved, startAt]);

  const cellsOf = (p: { anchor: Cell; orient: Orient }) => [p.anchor, add(p.anchor, DIRS[p.orient])] as const;

  const measure = (): TableFrame | null => {
    const table = tableRef.current?.getBoundingClientRect();
    const f = boardFrame(svgRef.current, puzzle.width, puzzle.height);
    if (!table || !f) return null;
    const bounds = { x: (table.left - f.left) / f.px, y: (table.top - f.top) / f.px, w: table.width / f.px, h: table.height / f.px };
    return { ox: f.left - table.left, oy: f.top - table.top, px: f.px, bounds };
  };

  // Parked dominoes are drawn over the table in cells, so follow the board's size.
  useLayoutEffect(() => {
    const update = () => setFrame(measure());
    update();
    const ro = new ResizeObserver(update);
    if (tableRef.current) ro.observe(tableRef.current);
    if (svgRef.current) ro.observe(svgRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle]);

  // Parked dominoes may not overlap the board's squares or each other.
  const cellRects = useMemo(() => puzzle.cells.map((c) => ({ x: c.c, y: c.r, w: 1, h: 1 })), [puzzle]);
  const blockedFor = (s: PlayState, idx: number) => [
    ...cellRects,
    ...Object.entries(s.parked ?? {})
      .filter(([j]) => Number(j) !== idx)
      .map(([, p]) => parkedRect(p)),
  ];

  const { values, occupant } = useMemo(() => {
    const values = new Map<string, number>();
    const occupant = new Map<string, number>();
    for (const [i, p] of Object.entries(st.placed)) {
      const idx = Number(i);
      const [a, b] = cellsOf(p);
      values.set(key(a), puzzle.dominoes[idx][0]);
      values.set(key(b), puzzle.dominoes[idx][1]);
      occupant.set(key(a), idx);
      occupant.set(key(b), idx);
    }
    return { values, occupant };
  }, [st.placed, puzzle]);

  const rules = useMemo(() => {
    const seen = new Map<string, string>();
    for (const reg of puzzle.regions) if (reg.constraint.kind !== 'none') seen.set(ruleKey(reg.constraint), constraintRule(reg.constraint));
    return [...seen.values()];
  }, [puzzle]);

  const evaluation = useMemo(() => evaluate(puzzle, values), [puzzle, values]);

  useEffect(() => {
    if (!evaluation.solved || st.solved) return;
    setSt((s) => ({ ...s, solved: true }));
    const d = raceRef.current;
    if (d) d.onSolved(st.placed, Date.now() - d.startAt);
  }, [evaluation.solved, st.solved, st.placed]);

  const placedTotal = Object.keys(st.placed).length;
  useEffect(() => {
    raceRef.current?.onProgress(placedTotal);
  }, [placedTotal]);

  const fits = (s: PlayState, idx: number, anchor: Cell, orient: Orient) => {
    const cells = [anchor, add(anchor, DIRS[orient])];
    return cells.every((c) => {
      if (!active.has(key(c))) return false;
      for (const [j, p] of Object.entries(s.placed)) {
        if (Number(j) === idx) continue;
        if (cellsOf(p).some((x) => sameCell(x, c))) return false;
      }
      return true;
    });
  };

  const rotate = (idx: number, from: Source) => {
    const f = measure();
    setSt((s) => {
      if (from === 'tray') return { ...s, tray: { ...s.tray, [idx]: (((s.tray[idx] ?? 0) + 1) % 4) as Orient } };
      if (from === 'parked') {
        const p = s.parked?.[idx];
        if (!p || !f) return s;
        for (let k = 1; k < 4; k++) {
          const o = ((p.orient + k) % 4) as Orient;
          const spot = findSpot(turned(p, o), blockedFor(s, idx), f.bounds);
          if (spot) return { ...s, parked: { ...s.parked, [idx]: { ...spot, orient: o } } };
        }
        return s;
      }
      const p = s.placed[idx];
      for (let k = 1; k < 4; k++) {
        const o = ((p.orient + k) % 4) as Orient;
        if (fits(s, idx, p.anchor, o)) return { ...s, placed: { ...s.placed, [idx]: { anchor: p.anchor, orient: o } } };
      }
      return s;
    });
  };

  const drop = (idx: number, half: 0 | 1, orient: Orient, x: number, y: number) => {
    const g = cellAt(svgRef.current, puzzle.width, puzzle.height, x, y);
    const at = boardPoint(svgRef.current, puzzle.width, puzzle.height, x, y);
    const f = measure();
    setSt((s) => {
      const placed = { ...s.placed };
      const parked = { ...s.parked };
      // On the board: snap to the squares.
      if (g && active.has(key(g))) {
        const anchor = half === 0 ? g : add(g, { r: -DIRS[orient].r, c: -DIRS[orient].c });
        if (!fits(s, idx, anchor, orient)) return s; // invalid spot: leave it where it came from
        placed[idx] = { anchor, orient };
        delete parked[idx];
        return { ...s, placed, parked };
      }
      delete placed[idx];
      delete parked[idx];
      // Around the board: set it down right there, nudged clear of anything it would overlap.
      if (at && f && inside(at, f.bounds)) {
        const visual = firstHalf(orient) === 0 ? half : ((1 - half) as 0 | 1);
        const spot = findSpot(dropRect(at, visual, orient), blockedFor(s, idx), f.bounds);
        if (!spot) return s; // no room there: leave it where it came from
        parked[idx] = { ...spot, orient };
        return { ...s, placed, parked };
      }
      return { ...s, placed, parked, tray: { ...s.tray, [idx]: orient } };
    });
  };

  const startDrag = (e: React.PointerEvent, idx: number, half: 0 | 1, orient: Orient, from: Source) => {
    if (st.solved || race?.locked) return;
    e.preventDefault();
    dragRef.current = { idx, half, orient, from, startX: e.clientX, startY: e.clientY, moved: false };
    const px = cellPixels(svgRef.current, puzzle.width, puzzle.height);
    const move = (ev: PointerEvent) => {
      const d = dragRef.current!;
      if (!d.moved && Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 6) return;
      d.moved = true;
      setDrag({ idx, half, orient, x: ev.clientX, y: ev.clientY, px });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current!;
      dragRef.current = null;
      setDrag(null);
      if (d.moved) drop(idx, half, orient, ev.clientX, ev.clientY);
      else rotate(idx, from);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onBoardDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const c = cellAt(svgRef.current, puzzle.width, puzzle.height, e.clientX, e.clientY);
    if (!c) return;
    const idx = occupant.get(key(c));
    if (idx === undefined) return;
    const p = st.placed[idx];
    startDrag(e, idx, sameCell(p.anchor, c) ? 0 : 1, p.orient, 'board');
  };

  /** A domino in the tray or parked by the board: which half was grabbed? */
  const onLooseDown = (e: React.PointerEvent<Element>, idx: number, o: Orient, from: 'tray' | 'parked') => {
    const rect = e.currentTarget.getBoundingClientRect();
    const second = isHorizontal(o) ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
    const visual = second ? 1 : 0;
    const half = (firstHalf(o) === 0 ? visual : 1 - visual) as 0 | 1;
    startDrag(e, idx, half, o, from);
  };

  const boardDominoes: BoardDomino[] = Object.entries(st.placed)
    .filter(([i]) => !(drag && drag.idx === Number(i)))
    .map(([i, p]) => {
      const [a, b] = cellsOf(p);
      return { id: i, a, b, pips: puzzle.dominoes[Number(i)] };
    });

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 1800);
  };

  const reveal = async () => {
    if (confirm('Reveal the solution?')) await revealNow();
  };

  const revealNow = async () => {
    let sol = solution;
    if (!sol) {
      // Shared links carry no answer; work it out here.
      setToast('Working out the answer…');
      try {
        const res = await runEngine('verify', puzzle, puzzle.dominoes, puzzle.options.maxPip).promise;
        sol = res.ok && res.solution.length ? res.solution : undefined;
      } catch {
        sol = undefined;
      }
      setToast(null);
      if (!sol) return flash('Could not find the answer');
      setSolution(sol);
    }
    const used = new Set<number>();
    const placed: PlayState['placed'] = {};
    for (const sol1 of sol) {
      const idx = puzzle.dominoes.findIndex(
        (d, i) => !used.has(i) && ((d[0] === sol1.pips[0] && d[1] === sol1.pips[1]) || (d[0] === sol1.pips[1] && d[1] === sol1.pips[0])),
      );
      if (idx < 0) continue;
      used.add(idx);
      const [anchor, other] = puzzle.dominoes[idx][0] === sol1.pips[0] ? [sol1.a, sol1.b] : [sol1.b, sol1.a];
      const orient = DIRS.findIndex((d) => sameCell(add(anchor, d), other)) as Orient;
      placed[idx] = { anchor, orient };
    }
    setSt((s) => ({ ...s, placed, parked: {} }));
  };

  // Development builds only: lets automated browser tests finish a puzzle.
  const revealRef = useRef(revealNow);
  revealRef.current = revealNow;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __pipsSolve?: () => Promise<void> };
    w.__pipsSolve = () => revealRef.current();
    return () => {
      delete w.__pipsSolve;
    };
  }, []);

  const snapshots = st.snapshots ?? [];
  const placedCount = Object.keys(st.placed).length;
  // A parked domino that no longer fits the table (a narrower screen) goes back to the tray.
  const shownParked: [number, Parked][] = frame
    ? Object.entries(st.parked ?? {})
        .filter(([, p]) => within(parkedRect(p), frame.bounds))
        .map(([i, p]) => [Number(i), p])
    : [];
  const shownSet = new Set(shownParked.map(([i]) => i));

  const takeSnapshot = () => {
    if (!placedCount && !shownSet.size) return flash('Place some dominoes first');
    const snap: Snapshot = { id: newId(), at: st.elapsed, placed: { ...st.placed }, tray: { ...st.tray }, parked: { ...st.parked } };
    setSt((s) => ({ ...s, snapshots: [...(s.snapshots ?? []), snap].slice(-MAX_SNAPSHOTS) }));
    flash('Snapshot saved');
  };

  /** Puts a snapshot's board back; the timer keeps running. */
  const restore = (snap: Snapshot) => setSt((s) => ({ ...s, placed: { ...snap.placed }, tray: { ...snap.tray }, parked: { ...snap.parked } }));

  const dropSnapshot = (id: string) => setSt((s) => ({ ...s, snapshots: (s.snapshots ?? []).filter((x) => x.id !== id) }));

  /** Puts every domino back in the tray; the timer and snapshots stay. */
  const clear = () => setSt((s) => ({ ...s, placed: {}, parked: {} }));

  const reset = () => {
    // Start over, but keep snapshots: they are only removed with their × button.
    setSt((s) => ({ ...fresh(), snapshots: s.snapshots }));
    setDismissed(false);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(await shareUrl(puzzle));
      flash('Link copied');
    } catch {
      flash('Could not copy link');
    }
  };

  const save = () => {
    if (savedState === 'changed' && !confirm('Your saved copy of this puzzle is different. Replace it with this version?')) return;
    // Keep a solution the stored copy already had (share links carry none).
    savePuzzle({ ...puzzle, solution: solution ?? getPuzzle(puzzle.id)?.solution });
    setSavedState('saved');
    flash('Saved to My puzzles');
  };

  return (
    <div className="play">
      <div className="play-bar">
        {race ? (
          <span className="timer" />
        ) : (
          <button className="btn ghost" onClick={onHome}>
            ← Back
          </button>
        )}
        <div className="play-title">
          <strong>{puzzle.title || 'Untitled'}</strong>
          {puzzle.difficulty && <span className={`pill ${levelClass(puzzle.difficulty)}`}>{levelLabel(puzzle.difficulty)}</span>}
        </div>
        <span className="timer">{formatTime(st.elapsed)}</span>
      </div>
      <div className="play-actions">
        <button className="btn ghost" onClick={takeSnapshot} disabled={st.solved || race?.locked} title="Save the current board so you can come back to it">
          Snapshot
        </button>
        <button className="btn ghost" onClick={clear} disabled={st.solved || race?.locked || (!placedCount && !shownSet.size)} title="Put all dominoes back in the tray (the timer keeps running)">
          Clear
        </button>
        {!race && (
          <>
            {/* Daily puzzles are the same for everyone: no revealing the answer. */}
            {source !== 'daily' && (
              <button className="btn ghost" onClick={reveal}>
                Reveal
              </button>
            )}
            <button className="btn ghost" onClick={share}>
              Share
            </button>
            {source !== 'local' && (
              <button className="btn" onClick={save} disabled={savedState === 'saved'}>
                {savedState === 'none' ? 'Save to My puzzles' : savedState === 'changed' ? 'Replace my saved copy' : 'Saved ✓'}
              </button>
            )}
            {onEdit ? (
              <button className="btn ghost" onClick={onEdit}>
                Edit
              </button>
            ) : (
              onRemix && (
                <button className="btn ghost" onClick={onRemix} title="Open a copy in the editor">
                  Remix
                </button>
              )
            )}
          </>
        )}
      </div>

      <div className="play-area">
        <div
          ref={tableRef}
          className={drag ? 'table dragging' : 'table'}
          style={{ '--cell': `${frame?.px ?? 50}px` } as React.CSSProperties}
        >
          <div className="board-wrap">
            <Board
              svgRef={svgRef}
              width={puzzle.width}
              height={puzzle.height}
              cells={puzzle.cells}
              regions={puzzle.regions}
              dominoes={boardDominoes}
              status={evaluation.status}
              onPointerDown={onBoardDown}
            />
          </div>
          {frame &&
            shownParked
              .filter(([i]) => drag?.idx !== i)
              .map(([i, p]) => (
                <LooseDomino
                  key={i}
                  className="parked"
                  left={frame.ox + p.x * frame.px}
                  top={frame.oy + p.y * frame.px}
                  px={frame.px}
                  orient={p.orient}
                  pips={puzzle.dominoes[i]}
                  onPointerDown={(e) => onLooseDown(e, i, p.orient, 'parked')}
                />
              ))}
        </div>

        <div className="tray">
          {puzzle.dominoes.map((d, idx) => {
            const onBoard = idx in st.placed || shownSet.has(idx) || drag?.idx === idx;
            const o = (st.tray[idx] ?? 0) as Orient;
            const h = isHorizontal(o);
            const [first, second] = firstHalf(o) === 0 ? d : [d[1], d[0]];
            return (
              <div key={idx} className="tray-slot">
                {!onBoard && (
                  <div className={`tray-domino ${h ? 'h' : 'v'}`} onPointerDown={(e) => onLooseDown(e, idx, o, 'tray')}>
                    <svg viewBox={h ? `0 0 ${2 * S} ${S}` : `0 0 ${S} ${2 * S}`}>
                      <DominoShape x={0} y={0} horizontal={h} first={first} second={second} />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {snapshots.length > 0 && (
          <section className="snapshots" aria-label="Snapshots">
            <h4>Snapshots</h4>
            <div className="snapshot-list">
              {snapshots.map((snap, i) => (
                <div key={snap.id} className="snapshot">
                  <button
                    className="snapshot-board"
                    onClick={() => restore(snap)}
                    disabled={st.solved}
                    title="Go back to this board (the timer keeps running)"
                  >
                    <Board
                      width={puzzle.width}
                      height={puzzle.height}
                      cells={puzzle.cells}
                      regions={puzzle.regions}
                      dominoes={Object.entries(snap.placed).map(([d, p]) => {
                        const [a, b] = cellsOf(p);
                        return { id: d, a, b, pips: puzzle.dominoes[Number(d)] };
                      })}
                    />
                  </button>
                  <div className="snapshot-meta">
                    <span>
                      #{i + 1} · {formatTime(snap.at)} · {Object.keys(snap.placed).length}/{puzzle.dominoes.length}
                    </span>
                    <button className="snapshot-delete" onClick={() => dropSnapshot(snap.id)} aria-label={`Delete snapshot ${i + 1}`}>
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        <p className="hint">Drag dominoes onto the board, or set them down anywhere around it. Tap a domino to rotate it.</p>
        {rules.length > 0 && (
          <details className="legend">
            <summary>Rules</summary>
            <ul>
              {rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {drag && <DragGhost {...drag} dominoes={puzzle.dominoes} />}
      {toast && <div className="toast">{toast}</div>}

      {st.solved && !dismissed && !race && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Solved!</h2>
            <p>
              You finished in <strong>{formatTime(st.elapsed)}</strong>.
            </p>
            <div className="row">
              <button className="btn" onClick={onHome}>
                Home
              </button>
              {/* A daily puzzle counts once: no replaying it for a better time. */}
              {source !== 'daily' && (
                <button className="btn ghost" onClick={reset}>
                  Play again
                </button>
              )}
              <button className="btn ghost" onClick={() => setDismissed(true)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DragGhost({
  idx,
  half,
  orient,
  x,
  y,
  px,
  dominoes,
}: {
  idx: number;
  half: 0 | 1;
  orient: Orient;
  x: number;
  y: number;
  px: number;
  dominoes: Puzzle['dominoes'];
}) {
  const visual = firstHalf(orient) === 0 ? half : 1 - half;
  const h = isHorizontal(orient);
  const left = h ? x - px * (visual + 0.5) : x - px / 2;
  const top = h ? y - px / 2 : y - px * (visual + 0.5);
  return <LooseDomino className="drag-ghost" left={left} top={top} px={px} orient={orient} pips={dominoes[idx]} />;
}

/** A domino drawn at a pixel position: the drag ghost, or one parked by the board. */
function LooseDomino({
  className,
  left,
  top,
  px,
  orient,
  pips,
  onPointerDown,
}: {
  className: string;
  left: number;
  top: number;
  px: number;
  orient: Orient;
  pips: Puzzle['dominoes'][number];
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void;
}) {
  const h = isHorizontal(orient);
  const [first, second] = firstHalf(orient) === 0 ? pips : [pips[1], pips[0]];
  return (
    <svg
      className={className}
      style={{ left, top, width: h ? 2 * px : px, height: h ? px : 2 * px }}
      viewBox={h ? `0 0 ${2 * S} ${S}` : `0 0 ${S} ${2 * S}`}
      onPointerDown={onPointerDown}
    >
      <DominoShape x={0} y={0} horizontal={h} first={first} second={second} />
    </svg>
  );
}

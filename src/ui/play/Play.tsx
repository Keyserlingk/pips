import { useEffect, useMemo, useRef, useState } from 'react';
import type { Cell, Puzzle } from '../../model/types';
import { DIRS, add, constraintRule, evaluate, key, newId, ruleKey, sameCell } from '../../model/cells';
import { type Orient, type PlayState, type Snapshot, getPuzzle, loadProgress, savePuzzle, saveProgress } from '../../model/storage';
import { samePuzzle, shareUrl } from '../../model/serialize';
import { runEngine } from '../../engine/client';
import { Board, type BoardDomino, cellAt, cellPixels } from '../board/Board';
import { DominoShape, S } from '../board/DominoShape';

const fresh = (): PlayState => ({ placed: {}, tray: {}, elapsed: 0, solved: false });

/** Oldest snapshots are dropped beyond this. */
const MAX_SNAPSHOTS = 12;

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Which half is drawn left/top for a given orientation. */
const firstHalf = (o: Orient): 0 | 1 => (o < 2 ? 0 : 1);
const isHorizontal = (o: Orient) => o % 2 === 0;

interface DragInfo {
  idx: number;
  half: 0 | 1;
  orient: Orient;
  from: 'tray' | 'board';
  startX: number;
  startY: number;
  moved: boolean;
}

type SavedState = 'none' | 'saved' | 'changed';

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
}: {
  puzzle: Puzzle;
  /** Where the puzzle came from: the library, a random puzzle, or a share link. */
  source: 'local' | 'quick' | 'shared';
  onHome: () => void;
  onEdit?: () => void;
  onRemix?: () => void;
}) {
  const [savedState, setSavedState] = useState<SavedState>(() => libraryState(puzzle));
  const [solution, setSolution] = useState(puzzle.solution);
  const [st, setSt] = useState<PlayState>(() => loadProgress(puzzle.id) ?? fresh());
  const [drag, setDrag] = useState<{ idx: number; half: 0 | 1; orient: Orient; x: number; y: number; px: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const active = useMemo(() => new Set(puzzle.cells.map(key)), [puzzle]);

  useEffect(() => saveProgress(puzzle.id, st), [puzzle.id, st]);

  // Timer
  useEffect(() => {
    if (st.solved) return;
    const t = setInterval(() => {
      if (!document.hidden) setSt((s) => ({ ...s, elapsed: s.elapsed + 1 }));
    }, 1000);
    return () => clearInterval(t);
  }, [st.solved]);

  const cellsOf = (p: { anchor: Cell; orient: Orient }) => [p.anchor, add(p.anchor, DIRS[p.orient])] as const;

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
    if (evaluation.solved && !st.solved) setSt((s) => ({ ...s, solved: true }));
  }, [evaluation.solved, st.solved]);

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

  const rotate = (idx: number, from: 'tray' | 'board') => {
    setSt((s) => {
      if (from === 'tray') return { ...s, tray: { ...s.tray, [idx]: (((s.tray[idx] ?? 0) + 1) % 4) as Orient } };
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
    setSt((s) => {
      const placed = { ...s.placed };
      if (g) {
        const anchor = half === 0 ? g : add(g, { r: -DIRS[orient].r, c: -DIRS[orient].c });
        if (fits(s, idx, anchor, orient)) {
          placed[idx] = { anchor, orient };
          return { ...s, placed };
        }
        return s; // invalid spot: leave it where it came from
      }
      delete placed[idx];
      return { ...s, placed, tray: { ...s.tray, [idx]: orient } };
    });
  };

  const startDrag = (e: React.PointerEvent, idx: number, half: 0 | 1, orient: Orient, from: 'tray' | 'board') => {
    if (st.solved) return;
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

  const onTrayDown = (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
    const o = (st.tray[idx] ?? 0) as Orient;
    const rect = e.currentTarget.getBoundingClientRect();
    const second = isHorizontal(o) ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
    const visual = second ? 1 : 0;
    const half = (firstHalf(o) === 0 ? visual : 1 - visual) as 0 | 1;
    startDrag(e, idx, half, o, 'tray');
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
    if (!confirm('Reveal the solution?')) return;
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
    setSt((s) => ({ ...s, placed }));
  };

  const snapshots = st.snapshots ?? [];
  const placedCount = Object.keys(st.placed).length;

  const takeSnapshot = () => {
    if (!placedCount) return flash('Place some dominoes first');
    const snap: Snapshot = { id: newId(), at: st.elapsed, placed: { ...st.placed }, tray: { ...st.tray } };
    setSt((s) => ({ ...s, snapshots: [...(s.snapshots ?? []), snap].slice(-MAX_SNAPSHOTS) }));
    flash('Snapshot saved');
  };

  /** Puts a snapshot's board back; the timer keeps running. */
  const restore = (snap: Snapshot) => setSt((s) => ({ ...s, placed: { ...snap.placed }, tray: { ...snap.tray } }));

  const dropSnapshot = (id: string) => setSt((s) => ({ ...s, snapshots: (s.snapshots ?? []).filter((x) => x.id !== id) }));

  /** Takes every domino off the board; the timer and snapshots stay. */
  const clear = () => setSt((s) => ({ ...s, placed: {} }));

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
        <button className="btn ghost" onClick={onHome}>
          ← Back
        </button>
        <div className="play-title">
          <strong>{puzzle.title || 'Untitled'}</strong>
          {puzzle.difficulty && <span className={`pill ${puzzle.difficulty}`}>{puzzle.difficulty}</span>}
        </div>
        <span className="timer">{formatTime(st.elapsed)}</span>
      </div>
      <div className="play-actions">
        <button className="btn ghost" onClick={takeSnapshot} disabled={st.solved} title="Save the current board so you can come back to it">
          Snapshot
        </button>
        <button className="btn ghost" onClick={clear} disabled={st.solved || !placedCount} title="Take all dominoes off the board (the timer keeps running)">
          Clear
        </button>
        <button className="btn ghost" onClick={reset} title="Start over: empty board and timer back to 0:00">
          Reset
        </button>
        <button className="btn ghost" onClick={reveal}>
          Reveal
        </button>
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
      </div>

      <div className="play-area">
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

        <div className="tray">
          {puzzle.dominoes.map((d, idx) => {
            const onBoard = idx in st.placed || drag?.idx === idx;
            const o = (st.tray[idx] ?? 0) as Orient;
            const h = isHorizontal(o);
            const [first, second] = firstHalf(o) === 0 ? d : [d[1], d[0]];
            return (
              <div key={idx} className="tray-slot">
                {!onBoard && (
                  <div className={`tray-domino ${h ? 'h' : 'v'}`} onPointerDown={(e) => onTrayDown(e, idx)}>
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
        <p className="hint">Drag dominoes onto the board. Tap a domino to rotate it.</p>
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

      {st.solved && !dismissed && (
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
              <button className="btn ghost" onClick={reset}>
                Play again
              </button>
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
  const h = isHorizontal(orient);
  const d = dominoes[idx];
  const [first, second] = firstHalf(orient) === 0 ? d : [d[1], d[0]];
  const visual = firstHalf(orient) === 0 ? half : 1 - half;
  const left = h ? x - px * (visual + 0.5) : x - px / 2;
  const top = h ? y - px / 2 : y - px * (visual + 0.5);
  return (
    <svg
      className="drag-ghost"
      style={{ left, top, width: h ? 2 * px : px, height: h ? px : 2 * px }}
      viewBox={h ? `0 0 ${2 * S} ${S}` : `0 0 ${S} ${2 * S}`}
    >
      <DominoShape x={0} y={0} horizontal={h} first={first} second={second} />
    </svg>
  );
}

import { useMemo, useRef, useState } from 'react';
import type { Cell, Constraint, Difficulty, ExtraKind, Puzzle, Region } from '../../model/types';
import { DEFAULT_OPTIONS, EXTRA_KINDS, NUM_REGION_COLORS } from '../../model/types';
import { DIRS, add, constraintLabel, key, newId, sameCell, setSize, toIdx } from '../../model/cells';
import { getPuzzle, loadRemix, savePuzzle, saveProgress } from '../../model/storage';
import { shareUrl } from '../../model/serialize';
import { runEngine } from '../../engine/client';
import type { GenMode, GenStats } from '../../engine/generator';
import { validateLayout } from '../../engine/generator';
import { levelLabel } from '../../model/levels';
import { mulberry32, randomSeed } from '../../engine/rng';
import { randomShape } from '../../engine/shape';
import { tileability } from '../../engine/tiling';
import { Board, cellAt } from '../board/Board';

type Tool = 'cells' | 'region' | 'select';

function blankPuzzle(): Puzzle {
  const W = 7;
  const H = 7;
  const shape = randomShape(W, H, 16, mulberry32(randomSeed()));
  const dr = Math.floor((H - shape.height) / 2);
  const dc = Math.floor((W - shape.width) / 2);
  return {
    version: 1,
    id: newId(),
    title: 'My puzzle',
    width: W,
    height: H,
    cells: shape.cells.map((c) => ({ r: c.r + dr, c: c.c + dc })),
    regions: [],
    dominoes: [],
    options: { ...DEFAULT_OPTIONS },
  };
}

const MODES: { id: GenMode; label: string; help: string }[] = [
  { id: 'auto', label: 'Everything automatic', help: 'Generates regions, constraints and dominoes for your board shape.' },
  { id: 'regions', label: 'My regions, auto constraints', help: 'Keeps your regions and picks constraints and dominoes.' },
  { id: 'manual', label: 'My regions & constraints', help: 'Keeps everything you made and searches for dominoes that fit.' },
];

const KINDS: { label: string; title: string; extra?: ExtraKind; is: (c: Constraint) => boolean; make: (v: number) => Constraint }[] = [
  { label: '–', title: 'No constraint', is: (c) => c.kind === 'none', make: () => ({ kind: 'none' }) },
  { label: 'Σ', title: 'Sum equals', is: (c) => c.kind === 'sum' && c.op === '=', make: (v) => ({ kind: 'sum', op: '=', value: v }) },
  { label: '<', title: 'Sum less than', is: (c) => c.kind === 'sum' && c.op === '<', make: (v) => ({ kind: 'sum', op: '<', value: v }) },
  { label: '>', title: 'Sum greater than', is: (c) => c.kind === 'sum' && c.op === '>', make: (v) => ({ kind: 'sum', op: '>', value: v }) },
  { label: '=', title: 'All equal', is: (c) => c.kind === 'equal', make: () => ({ kind: 'equal' }) },
  { label: '≠', title: 'All different', is: (c) => c.kind === 'distinct', make: () => ({ kind: 'distinct' }) },
  { label: 'Δ', title: 'Max step between neighbours', extra: 'step', is: (c) => c.kind === 'step', make: (v) => ({ kind: 'step', max: Math.min(v, 2) }) },
  { label: '×', title: 'Product equals', extra: 'product', is: (c) => c.kind === 'product', make: (v) => ({ kind: 'product', value: v }) },
  {
    label: 'max',
    title: 'Largest value equals',
    extra: 'extreme',
    is: (c) => c.kind === 'extreme' && c.which === 'max',
    make: (v) => ({ kind: 'extreme', which: 'max', value: Math.min(v, 6) }),
  },
  {
    label: 'min',
    title: 'Smallest value equals',
    extra: 'extreme',
    is: (c) => c.kind === 'extreme' && c.which === 'min',
    make: (v) => ({ kind: 'extreme', which: 'min', value: Math.min(v, 6) }),
  },
  { label: 'Σ even', title: 'Sum is even', extra: 'sumParity', is: (c) => c.kind === 'sumParity' && c.even, make: () => ({ kind: 'sumParity', even: true }) },
  { label: 'Σ odd', title: 'Sum is odd', extra: 'sumParity', is: (c) => c.kind === 'sumParity' && !c.even, make: () => ({ kind: 'sumParity', even: false }) },
];

/** The number a constraint carries (sum/product/extreme value, or the max step), if any. */
const numberOf = (c: Constraint): number | null =>
  c.kind === 'sum' || c.kind === 'product' || c.kind === 'extreme' ? c.value : c.kind === 'step' ? c.max : null;

const withNumber = (c: Constraint, v: number): Constraint =>
  c.kind === 'step' ? { ...c, max: v } : c.kind === 'sum' || c.kind === 'product' || c.kind === 'extreme' ? { ...c, value: v } : c;

export function Editor({ id, onHome, onPlay }: { id: string; onHome: () => void; onPlay: (id: string) => void }) {
  const [draft, setDraft] = useState<Puzzle>(() => {
    if (id === 'remix') {
      const src = loadRemix();
      if (src) return { ...src, id: newId(), title: `${src.title} (remix)` };
    }
    return (id !== 'new' && getPuzzle(id)) || blankPuzzle();
  });
  const [tool, setTool] = useState<Tool>('cells');
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<GenMode>('auto');
  const [difficulty, setDifficulty] = useState<Difficulty>(draft.difficulty ?? 'medium');
  const [busy, setBusy] = useState<{ cancel: () => void; label: string } | null>(null);
  const [stats, setStats] = useState<GenStats | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [showSolution, setShowSolution] = useState(false);
  const [saved, setSaved] = useState(id !== 'new' && id !== 'remix');
  const [shapeSize, setShapeSize] = useState(16);
  const svgRef = useRef<SVGSVGElement>(null);
  const paint = useRef<{ mode: 'add' | 'remove'; last: string; regionId?: string } | null>(null);

  const active = useMemo(() => new Set(draft.cells.map(key)), [draft.cells]);
  const selected = draft.regions.find((r) => r.id === sel) ?? null;
  const extras = draft.options.extras ?? [];
  const layout = { width: draft.width, height: draft.height, cells: draft.cells, regions: draft.regions };
  const layoutError = validateLayout(layout, draft.options);
  const badCells = useMemo(() => {
    const res = tileability(draft.width, draft.height, draft.cells.map((c) => toIdx(c, draft.width)));
    return new Set(res.badCells.map((i) => `${Math.floor(i / draft.width)},${i % draft.width}`));
  }, [draft.cells, draft.width, draft.height]);

  /** Applies an edit. Layout edits drop the tray; other edits only drop the stored solution. */
  const update = (fn: (p: Puzzle) => Puzzle, layoutChange = false) => {
    setDraft((p) => {
      let n = fn(p);
      n = { ...n, regions: n.regions.filter((r) => r.cells.length) };
      if (layoutChange) n = { ...n, dominoes: [], solution: undefined };
      else if (n.regions !== p.regions || n.options !== p.options) n = { ...n, solution: undefined };
      return n;
    });
    setStats(null);
    setSaved(false);
    setMessage(null);
  };

  const nextColor = (p: Puzzle, cell: Cell) => {
    const near = new Set<number>();
    for (const reg of p.regions)
      if (reg.cells.some((c) => DIRS.some((d) => sameCell(add(cell, d), c)))) near.add(reg.color);
    const used = new Array(NUM_REGION_COLORS).fill(0);
    p.regions.forEach((r) => used[r.color]++);
    let best = 0;
    for (let k = 0; k < NUM_REGION_COLORS; k++)
      if (!near.has(k) && (near.has(best) || used[k] < used[best])) best = k;
    return best;
  };

  const apply = (cell: Cell) => {
    const p = paint.current!;
    const k = key(cell);
    if (tool === 'cells') {
      if (p.mode === 'add' && !active.has(k)) update((d) => ({ ...d, cells: [...d.cells, cell] }), true);
      if (p.mode === 'remove' && active.has(k))
        update(
          (d) => ({
            ...d,
            cells: d.cells.filter((c) => !sameCell(c, cell)),
            regions: d.regions.map((r) => ({ ...r, cells: r.cells.filter((c) => !sameCell(c, cell)) })),
          }),
          true,
        );
      return;
    }
    if (!active.has(k)) return;
    const rid = p.regionId!;
    update((d) => {
      let regions = d.regions;
      if (p.mode === 'add') {
        regions = regions.map((r) => ({ ...r, cells: r.cells.filter((c) => !sameCell(c, cell)) }));
        const existing = regions.find((r) => r.id === rid);
        if (existing) regions = regions.map((r) => (r.id === rid ? { ...r, cells: [...r.cells, cell] } : r));
        else regions = [...regions, { id: rid, cells: [cell], constraint: { kind: 'none' }, color: nextColor(d, cell) }];
      } else {
        regions = regions.map((r) => (r.id === rid ? { ...r, cells: r.cells.filter((c) => !sameCell(c, cell)) } : r));
      }
      return { ...d, regions };
    });
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const cell = cellAt(svgRef.current, draft.width, draft.height, e.clientX, e.clientY);
    if (!cell || busy) return;
    const k = key(cell);
    const owner = draft.regions.find((r) => r.cells.some((c) => sameCell(c, cell)));
    if (tool === 'select') {
      setSel(owner?.id ?? null);
      return;
    }
    if (tool === 'region' && !active.has(k)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'cells') {
      paint.current = { mode: active.has(k) ? 'remove' : 'add', last: k };
    } else {
      const rid = selected ? selected.id : newId();
      setSel(rid);
      paint.current = { mode: owner && owner.id === rid ? 'remove' : 'add', last: k, regionId: rid };
    }
    apply(cell);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!paint.current) return;
    const cell = cellAt(svgRef.current, draft.width, draft.height, e.clientX, e.clientY);
    if (!cell || key(cell) === paint.current.last) return;
    paint.current.last = key(cell);
    apply(cell);
  };

  const resize = (w: number, h: number) => {
    w = Math.max(2, Math.min(12, w || 2));
    h = Math.max(2, Math.min(12, h || 2));
    const inside = (c: Cell) => c.r < h && c.c < w;
    update(
      (d) => ({
        ...d,
        width: w,
        height: h,
        cells: d.cells.filter(inside),
        regions: d.regions.map((r) => ({ ...r, cells: r.cells.filter(inside) })),
      }),
      true,
    );
  };

  const randomBoard = () => {
    const n = Math.min(shapeSize - (shapeSize % 2), draft.width * draft.height - ((draft.width * draft.height) % 2));
    const s = randomShape(draft.width, draft.height, n, mulberry32(randomSeed()));
    const dr = Math.floor((draft.height - s.height) / 2);
    const dc = Math.floor((draft.width - s.width) / 2);
    update((d) => ({ ...d, cells: s.cells.map((c) => ({ r: c.r + dr, c: c.c + dc })), regions: [] }), true);
    setSel(null);
  };

  const setConstraint = (reg: Region, con: Constraint) =>
    update((d) => ({ ...d, regions: d.regions.map((r) => (r.id === reg.id ? { ...r, constraint: con } : r)) }));

  const run = <T,>(label: string, job: { promise: Promise<T>; cancel: () => void }, done: (r: T) => void) => {
    setBusy({ cancel: job.cancel, label });
    setMessage(null);
    job.promise
      .then(done)
      .catch((err: Error) => err.message !== 'cancelled' && setMessage({ kind: 'error', text: err.message }))
      .finally(() => setBusy(null));
  };

  const generateNow = () => {
    if (layoutError) return setMessage({ kind: 'error', text: layoutError });
    if (mode !== 'auto' && !draft.regions.length)
      return setMessage({ kind: 'error', text: 'Paint some regions first, or choose "Everything automatic".' });
    const job = runEngine('generate', layout, { ...draft.options, mode, difficulty, seed: randomSeed() });
    run('Generating…', job, (res) => {
      if (!res.ok) return setMessage({ kind: 'error', text: res.error });
      setDraft((d) => ({ ...d, regions: res.regions, dominoes: res.dominoes, solution: res.solution, difficulty: res.stats.rating }));
      setStats(res.stats);
      setSaved(false);
      if (!res.regions.some((r) => r.id === sel)) setSel(null);
    });
  };

  const verifyNow = () => {
    const job = runEngine('verify', layout, draft.dominoes, draft.options.maxPip);
    run('Checking…', job, (res) => {
      if (!res.ok) return;
      setStats(res.stats);
      setDraft((d) => ({
        ...d,
        solution: res.solution.length ? res.solution : undefined,
        difficulty: res.stats.solutions === 1 ? res.stats.rating : d.difficulty,
      }));
    });
  };

  const playable = draft.dominoes.length * 2 === draft.cells.length && draft.cells.length > 0;

  const save = () => {
    if (!playable) {
      setMessage({ kind: 'error', text: 'Generate dominoes before saving.' });
      return false;
    }
    savePuzzle(draft);
    saveProgress(draft.id, null);
    setSaved(true);
    if (id === 'new' || id === 'remix') history.replaceState(null, '', `#/edit/${draft.id}`);
    return true;
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(draft.title || 'puzzle').replace(/[^\w-]+/g, '_')}.pips.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copyLink = async () => {
    if (!playable) return setMessage({ kind: 'error', text: 'Generate dominoes first.' });
    try {
      await navigator.clipboard.writeText(await shareUrl(draft));
      setMessage({ kind: 'info', text: 'Share link copied.' });
    } catch {
      setMessage({ kind: 'error', text: 'Could not copy to the clipboard.' });
    }
  };

  const solutionDominoes =
    showSolution && draft.solution
      ? draft.solution.map((s, i) => ({ id: `s${i}`, a: s.a, b: s.b, pips: s.pips, faded: true }))
      : [];

  return (
    <div className="editor">
      <div className="play-bar">
        <button className="btn ghost" onClick={() => (saved || confirm('Leave without saving?')) && onHome()}>
          ← Back
        </button>
        <input
          className="title-input"
          value={draft.title}
          onChange={(e) => {
            setDraft({ ...draft, title: e.target.value });
            setSaved(false);
          }}
          aria-label="Puzzle title"
        />
        <span className="muted small">{saved ? 'Saved' : 'Unsaved'}</span>
      </div>

      <div className="editor-grid">
        <div>
          <div className="tools" role="toolbar">
            {(
              [
                ['cells', 'Board cells'],
                ['region', 'Paint region'],
                ['select', 'Select region'],
              ] as [Tool, string][]
            ).map(([t, label]) => (
              <button key={t} className={`btn tool ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)}>
                {label}
              </button>
            ))}
          </div>
          <div className="board-wrap editor-board">
            <Board
              svgRef={svgRef}
              width={draft.width}
              height={draft.height}
              cells={draft.cells}
              regions={draft.regions}
              dominoes={solutionDominoes}
              showInactive
              selectedRegion={sel}
              highlight={badCells}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={() => (paint.current = null)}
            />
          </div>
          <p className="hint">
            {tool === 'cells' && 'Click or drag to add and remove board cells.'}
            {tool === 'region' &&
              (selected
                ? 'Drag to paint cells into the selected region; drag over its own cells to remove them.'
                : 'Drag to paint a new region.')}
            {tool === 'select' && 'Click a region to select it and edit its constraint.'}
          </p>
        </div>

        <div className="panel-stack">
          <section className="panel">
            <h3>Board</h3>
            <div className="row">
              <label>
                Width
                <input type="number" min={2} max={12} value={draft.width} onChange={(e) => resize(+e.target.value, draft.height)} />
              </label>
              <label>
                Height
                <input type="number" min={2} max={12} value={draft.height} onChange={(e) => resize(draft.width, +e.target.value)} />
              </label>
            </div>
            <div className="row">
              <label>
                Cells
                <input type="number" min={2} max={144} step={2} value={shapeSize} onChange={(e) => setShapeSize(+e.target.value)} />
              </label>
              <button className="btn ghost" onClick={randomBoard}>
                Random shape
              </button>
              <button className="btn ghost" onClick={() => update((d) => ({ ...d, cells: [], regions: [] }), true)}>
                Clear
              </button>
            </div>
            <p className={`small ${layoutError ? 'error' : 'muted'}`}>
              {draft.cells.length} cells · {draft.cells.length / 2} dominoes{layoutError ? ` — ${layoutError}` : ' ✓'}
            </p>
          </section>

          <section className="panel">
            <h3>Regions</h3>
            <div className="chips">
              {draft.regions.map((r) => (
                <button
                  key={r.id}
                  className={`chip ${r.id === sel ? 'on' : ''}`}
                  style={{ background: `var(--region-${r.color}-fill)`, borderColor: `var(--region-${r.color}-stroke)` }}
                  onClick={() => setSel(r.id)}
                >
                  {constraintLabel(r.constraint) || '·'} <span className="muted">({r.cells.length})</span>
                </button>
              ))}
              <button
                className="chip new"
                onClick={() => {
                  setSel(null);
                  setTool('region');
                }}
              >
                + New
              </button>
            </div>
            {selected && (
              <div className="region-editor">
                <div className="seg">
                  {KINDS.filter((k) => !k.extra || extras.includes(k.extra) || k.is(selected.constraint)).map((k) => (
                    <button
                      key={k.title}
                      title={k.title}
                      className={k.is(selected.constraint) ? 'on' : ''}
                      onClick={() => setConstraint(selected, k.make(numberOf(selected.constraint) ?? 6))}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                {numberOf(selected.constraint) !== null && (
                  <label>
                    {selected.constraint.kind === 'step' ? 'Max difference' : 'Value'}
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={numberOf(selected.constraint)!}
                      onChange={(e) => setConstraint(selected, withNumber(selected.constraint, Math.max(0, +e.target.value || 0)))}
                    />
                  </label>
                )}
                <div className="swatches">
                  {Array.from({ length: NUM_REGION_COLORS }, (_, c) => (
                    <button
                      key={c}
                      aria-label={`Colour ${c + 1}`}
                      className={`swatch ${selected.color === c ? 'on' : ''}`}
                      style={{ background: `var(--region-${c}-fill)`, borderColor: `var(--region-${c}-stroke)` }}
                      onClick={() =>
                        setDraft((d) => ({ ...d, regions: d.regions.map((r) => (r.id === selected.id ? { ...r, color: c } : r)) }))
                      }
                    />
                  ))}
                </div>
                <button
                  className="btn ghost danger"
                  onClick={() => {
                    update((d) => ({ ...d, regions: d.regions.filter((r) => r.id !== selected.id) }));
                    setSel(null);
                  }}
                >
                  Delete region
                </button>
              </div>
            )}
          </section>

          <section className="panel">
            <h3>Generate</h3>
            <div className="radio-list">
              {MODES.map((m) => (
                <label key={m.id} className="radio">
                  <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
                  <span>
                    <strong>{m.label}</strong>
                    <span className="muted small"> {m.help}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="row">
              <label>
                Difficulty
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} disabled={mode === 'manual'}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  <option value="expert">Rachel (up to 10 s)</option>
                </select>
              </label>
              <label>
                Domino set
                <select
                  value={draft.options.maxPip}
                  onChange={(e) => update((d) => ({ ...d, options: { ...d.options, maxPip: +e.target.value as 6 | 9 } }))}
                >
                  <option value={6}>Double-six ({setSize(6)})</option>
                  <option value={9}>Double-nine ({setSize(9)})</option>
                </select>
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.options.allowDuplicates}
                onChange={(e) => update((d) => ({ ...d, options: { ...d.options, allowDuplicates: e.target.checked } }))}
              />
              Allow duplicate dominoes
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.options.requireUnique}
                onChange={(e) => update((d) => ({ ...d, options: { ...d.options, requireUnique: e.target.checked } }))}
              />
              Require a unique solution
            </label>
            <details className="extras" open={extras.length > 0}>
              <summary>Extra constraints</summary>
              <p className="muted small">New rule types for the generator and the region editor. Off by default.</p>
              {EXTRA_KINDS.map((k) => (
                <label key={k.id} className="check">
                  <input
                    type="checkbox"
                    checked={extras.includes(k.id)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...extras, k.id] : extras.filter((x) => x !== k.id);
                      setDraft((d) => ({ ...d, options: { ...d.options, extras: next } }));
                      setSaved(false);
                    }}
                  />
                  {k.name}
                </label>
              ))}
            </details>
            <div className="row">
              {busy ? (
                <>
                  <span className="spinner" /> {busy.label}
                  <button className="btn ghost" onClick={busy.cancel}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={generateNow}>
                    {draft.dominoes.length ? 'Re-generate' : 'Generate'}
                  </button>
                  {playable && (
                    <button className="btn ghost" onClick={verifyNow}>
                      Verify
                    </button>
                  )}
                </>
              )}
            </div>
            {message && <p className={`small ${message.kind === 'error' ? 'error' : 'muted'}`}>{message.text}</p>}
            {stats && (
              <p className="small">
                {stats.solutions === 1 && <span className="ok">Unique solution ✓</span>}
                {stats.solutions === 2 && <span className="warn">More than one solution</span>}
                {stats.solutions === 0 && <span className="error">{stats.aborted ? 'Search limit reached' : 'No solution'}</span>}
                {stats.solutions > 0 && stats.aborted && <span className="muted"> (search limit reached)</span>}
                <span className="muted">
                  {' '}
                  · rated <strong>{levelLabel(stats.rating)}</strong>
                  {stats.entryPoints !== undefined &&
                    ` · ${stats.entryPoints} starting point${stats.entryPoints === 1 ? '' : 's'}`}
                  {' '}· {stats.nodes.toLocaleString()} search steps
                </span>
              </p>
            )}
            {playable && (
              <>
                <div className="mini-tray">
                  {draft.dominoes.map((d, i) => (
                    <span key={i} className="mini-domino">
                      {d[0]}|{d[1]}
                    </span>
                  ))}
                </div>
                {draft.solution && (
                  <label className="check">
                    <input type="checkbox" checked={showSolution} onChange={(e) => setShowSolution(e.target.checked)} />
                    Show solution on the board
                  </label>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h3>Puzzle</h3>
            <label>
              Author
              <input
                value={draft.author ?? ''}
                onChange={(e) => {
                  setDraft({ ...draft, author: e.target.value });
                  setSaved(false);
                }}
              />
            </label>
            <div className="row">
              <button className="btn" onClick={save} disabled={!playable}>
                Save
              </button>
              <button className="btn ghost" onClick={() => save() && onPlay(draft.id)} disabled={!playable}>
                Playtest
              </button>
              <button className="btn ghost" onClick={copyLink} disabled={!playable}>
                Copy link
              </button>
              <button className="btn ghost" onClick={exportJson}>
                Export JSON
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

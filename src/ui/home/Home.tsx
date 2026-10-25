import { useRef, useState } from 'react';
import type { Difficulty, Puzzle } from '../../model/types';
import { DEFAULT_OPTIONS, EXTRA_KINDS } from '../../model/types';
import { PLAYABLE_LEVELS, levelClass, levelLabel } from '../../model/levels';
import { solvedToday } from '../daily/Daily';
import { deletePuzzle, loadLibrary, saveProgress, savePuzzle, saveQuick } from '../../model/storage';
import { isPuzzle, shareUrl } from '../../model/serialize';
import { newId } from '../../model/cells';
import { runEngine } from '../../engine/client';
import { randomSeed } from '../../engine/rng';

/** Shown while the slower levels generate. */
const WAIT: Partial<Record<Difficulty, string>> = { expert: ' (up to 10 s)' };

export function Home({ go }: { go: (hash: string) => void }) {
  const [library, setLibrary] = useState<Puzzle[]>(loadLibrary);
  const [busy, setBusy] = useState<Difficulty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withExtras, setWithExtras] = useState(false);
  const options = { ...DEFAULT_OPTIONS, extras: withExtras ? EXTRA_KINDS.map((k) => k.id) : [] };
  const fileRef = useRef<HTMLInputElement>(null);

  const quick = (difficulty: Difficulty) => {
    setBusy(difficulty);
    setError(null);
    const opts = { ...options, maxPip: 6 as const };
    runEngine('quick', { ...opts, difficulty, seed: randomSeed() })
      .promise.then((res) => {
        if (!res.ok) return setError(res.error);
        const p: Puzzle = {
          version: 1,
          id: `quick-${newId()}`,
          title: `Random ${levelLabel(difficulty)}`,
          difficulty,
          width: res.width,
          height: res.height,
          cells: res.cells,
          regions: res.regions,
          dominoes: res.dominoes,
          solution: res.solution,
          options: opts,
        };
        saveQuick(p);
        saveProgress(p.id, null);
        go('#/play/quick');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  const importFile = async (file: File) => {
    try {
      const p = JSON.parse(await file.text());
      if (!isPuzzle(p)) throw new Error();
      if (library.some((x) => x.id === p.id)) p.id = newId();
      savePuzzle(p);
      setLibrary(loadLibrary());
    } catch {
      setError('That file is not a valid puzzle.');
    }
  };

  return (
    <div className="home">
      <section className="hero">
        <h1>Custom Pips</h1>
        <p className="muted">Place every domino so that each coloured region meets its condition.</p>
        <div className="row center daily-entry">
          <button className="btn daily-button" onClick={() => go('#/daily')}>
            📅 Daily <span className="daily-count">{solvedToday()}/4 today</span>
          </button>
        </div>
        <div className="quick">
          {PLAYABLE_LEVELS.map((d) => (
            <button key={d} className={`quick-card ${d}`} onClick={() => quick(d)} disabled={!!busy}>
              <span className="quick-label">{levelLabel(d)}</span>
              <span className="muted small">{busy === d ? `Generating…${WAIT[d] ?? ''}` : 'Random puzzle'}</span>
            </button>
          ))}
        </div>
        <div className="row center duel-entry">
          <button className="btn" onClick={() => go('#/duel')}>
            ⚔ Duel a friend
          </button>
          <button className="btn ghost" onClick={() => go('#/ghost')}>
            👻 Ghost challenge
          </button>
        </div>
        <label className="check extras-toggle">
          <input type="checkbox" checked={withExtras} onChange={(e) => setWithExtras(e.target.checked)} />
          Include extra constraints (max step, product, max/min, sum parity)
        </label>
        {error && <p className="error small">{error}</p>}
      </section>

      <section className="panel">
        <div className="row spread">
          <h3>My puzzles</h3>
          <div className="row">
            <button className="btn" onClick={() => go('#/edit/new')}>
              + Create puzzle
            </button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
          </div>
        </div>
        {library.length === 0 ? (
          <p className="muted">No puzzles yet. Create one, or import a .pips.json file.</p>
        ) : (
          <ul className="library">
            {library.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{p.title || 'Untitled'}</strong>
                  <span className="muted small">
                    {' '}
                    {p.cells.length} cells{p.author ? ` · by ${p.author}` : ''}
                  </span>
                  {p.difficulty && <span className={`pill ${levelClass(p.difficulty)}`}>{levelLabel(p.difficulty)}</span>}
                </div>
                <div className="row">
                  <button className="btn" onClick={() => go(`#/play/local/${p.id}`)}>
                    Play
                  </button>
                  <button className="btn ghost" onClick={() => go(`#/edit/${p.id}`)}>
                    Edit
                  </button>
                  <button className="btn ghost" onClick={async () => navigator.clipboard?.writeText(await shareUrl(p))}>
                    Copy link
                  </button>
                  <button
                    className="btn ghost danger"
                    onClick={() => {
                      if (!confirm(`Delete "${p.title}"?`)) return;
                      deletePuzzle(p.id);
                      setLibrary(loadLibrary());
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

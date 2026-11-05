import { useRef, useState } from 'react';
import type { Difficulty, Puzzle } from '../../model/types';
import { PLAYABLE_LEVELS, levelClass, levelLabel } from '../../model/levels';
import { MenuButton, MenuItem } from '../Menu';
import { deletePuzzle, loadLibrary, loadTodo, saveProgress, savePuzzle, saveQuick } from '../../model/storage';
import { isPuzzle } from '../../model/serialize';
import { QrModal } from '../qr/QrModal';
import { newId } from '../../model/cells';
import { runEngine } from '../../engine/client';
import { randomSeed } from '../../engine/rng';
import { GENERATOR_VERSION } from '../../engine/version';
import { puzzleLink, randomPuzzle, seedOptions } from '../../model/seedLink';

/** Shown while the slower levels generate (no time limit, so they can be shared as seed links). */
export const WAIT: Partial<Record<Difficulty, string>> = { hard: ' (can take a few seconds)', expert: ' (can take up to a minute)' };

/** "More ways to play": random puzzles, friends, history and your own puzzles. The start page is the daily puzzles. */
export function More({ go }: { go: (hash: string) => void }) {
  const [library, setLibrary] = useState<Puzzle[]>(loadLibrary);
  const [busy, setBusy] = useState<Difficulty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withExtras, setWithExtras] = useState(false);
  const [qr, setQr] = useState<{ link: string; title: string } | null>(null);
  const todoCount = loadTodo().length;
  const fileRef = useRef<HTMLInputElement>(null);

  const quick = (difficulty: Difficulty) => {
    setBusy(difficulty);
    setError(null);
    // Generated from a recorded seed without time limits, so it can be shared as a short seed link.
    const recipe = { v: GENERATOR_VERSION, level: difficulty, seed: randomSeed(), extras: withExtras };
    runEngine('quick', seedOptions(recipe))
      .promise.then((res) => {
        if (!res.ok) return setError(res.error);
        const p = randomPuzzle(res, recipe);
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
      <div className="play-bar">
        <button className="btn ghost" onClick={() => go('#/')}>
          ← Today
        </button>
        <strong>More ways to play</strong>
        <span />
      </div>
      <section className="hero">
        <div className="quick">
          {PLAYABLE_LEVELS.map((d) => (
            <button key={d} className={`quick-card ${d}`} onClick={() => quick(d)} disabled={!!busy}>
              <span className="quick-label">{levelLabel(d)}</span>
              <span className="muted small">{busy === d ? `Generating…${WAIT[d] ?? ''}` : 'Random puzzle'}</span>
            </button>
          ))}
        </div>
        <div className="row center duel-entry">
          <MenuButton label="👥 Play with friends ▾" className="btn" align="left">
            <MenuItem onClick={() => go('#/duel')} hint="Race each other live on the same puzzle">
              ⚔ Duel a friend
            </MenuItem>
            <MenuItem onClick={() => go('#/ghost')} hint="Solve puzzles, then send friends a link to race your times">
              👻 Ghost challenge
            </MenuItem>
            <MenuItem onClick={() => go('#/scan')} hint="Open a puzzle from a friend's QR code, no internet needed">
              📷 Scan QR code
            </MenuItem>
          </MenuButton>
          <button className="btn ghost" onClick={() => go('#/history')}>
            📅 History &amp; to do{todoCount ? ` (${todoCount})` : ''}
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
                  <button className="btn ghost" onClick={async () => navigator.clipboard?.writeText(await puzzleLink(p))}>
                    Copy link
                  </button>
                  <button className="btn ghost" onClick={async () => setQr({ link: await puzzleLink(p), title: p.title })}>
                    QR code
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
      {qr && <QrModal link={qr.link} title={qr.title} onClose={() => setQr(null)} />}
    </div>
  );
}

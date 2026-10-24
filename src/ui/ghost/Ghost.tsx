import { useEffect, useRef, useState } from 'react';
import type { Difficulty, Puzzle } from '../../model/types';
import { DEFAULT_OPTIONS } from '../../model/types';
import { loadName, saveName } from '../../model/storage';
import { type GhostRun, decodeGhost, fastestRuns, ghostPlaced, ghostUrl } from '../../model/serialize';
import { newId } from '../../model/cells';
import { runEngine } from '../../engine/client';
import { randomSeed } from '../../engine/rng';
import { Play } from '../play/Play';
import { formatMs } from '../format';

/*
 * Ghost races: play a puzzle (no Reveal) while the number of pieces on the
 * board is recorded over time, then send a link. Whoever opens it races the
 * recorded "ghosts" on the same puzzle and can pass the link on with their own
 * run added. Links never contain the solution, only times and piece counts.
 */

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard', 'expert', 'rachel'];
const COUNTDOWN_MS = 3000;
/** Ghost bars shown during a race (the fastest runs). */
const GHOSTS_SHOWN = 3;

const levelName = (d: Difficulty) => d[0].toUpperCase() + d.slice(1);

// ----------------------------------------------------------------- the race

/** Countdown, then the puzzle with ghost bars; records this run's progress. */
function Race({
  puzzle,
  ghosts,
  name,
  onDone,
}: {
  puzzle: Puzzle;
  ghosts: GhostRun[];
  name: string;
  /** The finished run, or null when the player gives up. */
  onDone: (run: GhostRun | null) => void;
}) {
  const [startAt] = useState(() => Date.now() + COUNTDOWN_MS);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState(false);
  const steps = useRef<[number, number][]>([]);
  const total = puzzle.dominoes.length;

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 150);
    return () => clearInterval(t);
  }, [done]);

  const giveUp = () => {
    if (confirm('Give up this race?')) onDone(null);
  };

  const elapsed = now - startAt;
  if (elapsed < 0) return <div className="duel-countdown">{Math.ceil(-elapsed / 1000)}</div>;

  return (
    <>
      {ghosts.length > 0 && (
        <div className="ghost-bars">
          {fastestRuns(ghosts)
            .slice(0, GHOSTS_SHOWN)
            .map((g, i) => {
              const finished = elapsed >= g.ms;
              const placed = finished ? total : ghostPlaced(g, elapsed);
              return (
                <div key={i} className={`duel-opponent ghost-bar ${finished ? 'finished' : ''}`}>
                  <span>👻 {g.name}</span>
                  <div className="duel-progress">
                    <div style={{ width: `${(100 * placed) / total}%` }} />
                  </div>
                  <span className="muted small">{finished ? `done ${formatMs(g.ms)}` : `${placed}/${total}`}</span>
                </div>
              );
            })}
        </div>
      )}
      <Play
        puzzle={puzzle}
        source="shared"
        onHome={giveUp}
        race={{
          startAt,
          locked: done,
          onProgress: (placed) => {
            const last = steps.current[steps.current.length - 1];
            if (!last || last[1] !== placed) steps.current.push([Math.max(0, Date.now() - startAt), placed]);
          },
          onSolved: (_placed, ms) => {
            setDone(true);
            onDone({ name, ms, steps: [...steps.current, [ms, total]] });
          },
        }}
      />
      {!done && (
        <div className="row center">
          <button className="btn ghost" onClick={giveUp}>
            Give up
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- helpers

function NameField({ name, setName }: { name: string; setName: (n: string) => void }) {
  return (
    <label>
      Your name
      <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Player" />
    </label>
  );
}

/** A link to pass on: shown in full (so it can be copied by hand) with Share/Copy. */
function LinkBox({ url, title }: { url: string; title: string }) {
  const [note, setNote] = useState<string | null>(null);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setNote('Link copied');
      }
    } catch {
      /* cancelled, or no clipboard access: the link is still shown below */
    }
  };
  return (
    <div className="ghost-link">
      <button className="btn" onClick={share}>
        Send to a friend
      </button>
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Challenge link" />
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

function Leaderboard({ runs, mine }: { runs: GhostRun[]; mine?: GhostRun | null }) {
  const all = [...runs, ...(mine ? [mine] : [])].sort((a, b) => a.ms - b.ms);
  return (
    <ol className="ghost-board">
      {all.map((r, i) => (
        <li key={i} className={r === mine ? 'mine' : ''}>
          <span>{r === mine ? `${r.name} (you)` : r.name}</span>
          <strong>{formatMs(r.ms)}</strong>
        </li>
      ))}
    </ol>
  );
}

// -------------------------------------------------------- #/ghost: make one

export function GhostStart({ go }: { go: (hash: string) => void }) {
  const [name, setName] = useState(() => loadName());
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [phase, setPhase] = useState<'setup' | 'making' | 'racing' | 'done'>('setup');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [run, setRun] = useState<GhostRun | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const player = name.trim() || 'Player';

  const start = async () => {
    saveName(name.trim());
    setPhase('making');
    setError(null);
    const maxPip = difficulty === 'rachel' ? 9 : 6;
    try {
      const q = await runEngine('quick', { ...DEFAULT_OPTIONS, maxPip, difficulty, seed: randomSeed() }).promise;
      if (!q.ok) throw new Error(q.error);
      setPuzzle({
        version: 1,
        id: `ghost-${newId()}`,
        title: `${player}'s challenge`,
        difficulty: q.stats.rating,
        width: q.width,
        height: q.height,
        cells: q.cells,
        regions: q.regions,
        dominoes: q.dominoes,
        options: { ...DEFAULT_OPTIONS, maxPip },
      });
      setPhase('racing');
    } catch (e) {
      setError((e as Error).message);
      setPhase('setup');
    }
  };

  const finish = async (r: GhostRun | null) => {
    setRun(r);
    setPhase('done');
    if (r && puzzle) setUrl(await ghostUrl(puzzle, [r]));
  };

  if (phase === 'racing' && puzzle) return <Race puzzle={puzzle} ghosts={[]} name={player} onDone={finish} />;

  return (
    <div className="duel-start">
      <section className="panel">
        {phase === 'done' ? (
          run ? (
            <>
              <h2>Solved in {formatMs(run.ms)}</h2>
              <p className="muted">Send this to a friend: they race your ghost on the same puzzle.</p>
              {url && <LinkBox url={url} title={`Beat my ${formatMs(run.ms)} in Pips`} />}
            </>
          ) : (
            <h2>You gave up</h2>
          )
        ) : (
          <>
            <h2>👻 Ghost challenge</h2>
            <p className="muted">
              Solve a puzzle against the clock (no Reveal). Then send it to a friend: they race your recorded ghost,
              and can pass it on with their own time.
            </p>
            <NameField name={name} setName={setName} />
            <label>
              Level
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                {LEVELS.map((d) => (
                  <option key={d} value={d}>
                    {levelName(d)}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="error small">Could not make a puzzle: {error}</p>}
          </>
        )}
        <div className="row">
          {phase === 'making' ? (
            <span className="muted">
              <span className="spinner" /> Preparing a puzzle…
            </span>
          ) : (
            <button className="btn" onClick={phase === 'done' ? () => setPhase('setup') : start}>
              {phase === 'done' ? 'Make another' : 'Start'}
            </button>
          )}
          <button className="btn ghost" onClick={() => go('#/')}>
            Home
          </button>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------ #/g/<code>: race a ghost

export function GhostChallenge({ code, go }: { code: string; go: (hash: string) => void }) {
  const [data, setData] = useState<{ puzzle: Puzzle; runs: GhostRun[] } | null | undefined>(undefined);
  const [name, setName] = useState(() => loadName());
  const [phase, setPhase] = useState<'intro' | 'racing' | 'done'>('intro');
  const [mine, setMine] = useState<GhostRun | null>(null);
  const [url, setUrl] = useState('');
  const player = name.trim() || 'Player';

  useEffect(() => {
    let live = true;
    decodeGhost(code).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [code]);

  if (data === undefined) return <p className="muted">Loading challenge…</p>;
  if (data === null)
    return (
      <section className="panel">
        <p>That challenge link doesn't work. Ask for a new one.</p>
        <button className="btn" onClick={() => go('#/')}>
          Home
        </button>
      </section>
    );

  const { puzzle, runs } = data;
  const best = fastestRuns(runs)[0];

  const finish = async (r: GhostRun | null) => {
    setMine(r);
    setPhase('done');
    if (r) setUrl(await ghostUrl(puzzle, [...runs, r]));
  };

  if (phase === 'racing') return <Race puzzle={puzzle} ghosts={runs} name={player} onDone={finish} />;

  const verdict = mine
    ? mine.ms < best.ms
      ? `You beat ${best.name} by ${formatMs(best.ms - mine.ms)}!`
      : `${best.name} was faster by ${formatMs(mine.ms - best.ms)}.`
    : null;

  return (
    <div className="duel-start">
      <section className="panel">
        {phase === 'intro' ? (
          <>
            <h2>
              👻 {best.name} challenges you
              {puzzle.difficulty && <span className={`pill ${puzzle.difficulty}`}>{puzzle.difficulty}</span>}
            </h2>
            <p className="muted">
              Race their ghost on the same {puzzle.cells.length}-cell puzzle. It appears when the countdown ends; no
              Reveal.
            </p>
            <h4>Times to beat</h4>
            <Leaderboard runs={runs} />
            <NameField name={name} setName={setName} />
          </>
        ) : (
          <>
            <h2>{mine ? `Solved in ${formatMs(mine.ms)}` : 'You gave up'}</h2>
            {verdict && <p>{verdict}</p>}
            <Leaderboard runs={runs} mine={mine} />
            {mine && url && (
              <>
                <p className="muted">Pass it on: the next player races the fastest ghosts, including yours.</p>
                <LinkBox url={url} title={`Beat my ${formatMs(mine.ms)} in Pips`} />
              </>
            )}
          </>
        )}
        <div className="row">
          {phase === 'intro' && (
            <button
              className="btn"
              onClick={() => {
                saveName(name.trim());
                setPhase('racing');
              }}
            >
              Start
            </button>
          )}
          <button className="btn ghost" onClick={() => go('#/')}>
            Home
          </button>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Difficulty, Puzzle } from '../../model/types';
import { DEFAULT_OPTIONS } from '../../model/types';
import { loadName, saveName } from '../../model/storage';
import { type GhostRun, type GhostSeries, decodeGhost, fastestRuns, ghostPlaced, ghostUrl } from '../../model/serialize';
import {
  type LevelPlan,
  PLAN_LABEL,
  SCORING_LABEL,
  type Scoring,
  type SeriesRun,
  gameGhosts,
  levelsFor,
  standings,
} from '../../model/series';
import { newId } from '../../model/cells';
import { PLAYABLE_LEVELS, levelClass, levelLabel } from '../../model/levels';
import { runEngine } from '../../engine/client';
import { randomSeed } from '../../engine/rng';
import { Play } from '../play/Play';
import { formatMs } from '../format';

/*
 * Ghost races: play one or more puzzles in a row (no Reveal) while the number
 * of pieces on the board is recorded over time, then send a link. Whoever
 * opens it plays the same puzzles against the recorded "ghosts" and can pass
 * the link on with their own run added. The winner is whoever won the most
 * games or had the shortest total time, as the challenger chose. Links never
 * contain solutions, only names, times and piece counts.
 */

const COUNTDOWN_MS = 3000;
/** Ghost bars shown during a race (the fastest runs). */
const GHOSTS_SHOWN = 3;
const GAME_COUNTS = [1, 2, 3, 4, 5, 7];

// ----------------------------------------------------------------- one game

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
    if (confirm('Give up this game?')) onDone(null);
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
            Give up this game
          </button>
        </div>
      )}
    </>
  );
}

// -------------------------------------------------------------- a series

/**
 * Plays the games one after another, with a short summary in between.
 * `puzzles` may still be filling in (later games are generated in the
 * background); a game that isn't ready yet shows a spinner.
 */
function SeriesRace({
  puzzles,
  runs,
  name,
  onComplete,
}: {
  puzzles: (Puzzle | null)[];
  runs: SeriesRun[];
  name: string;
  onComplete: (run: SeriesRun) => void;
}) {
  const [game, setGame] = useState(0);
  const [between, setBetween] = useState(false);
  const [mine, setMine] = useState<SeriesRun>({ name, times: [], steps: [] });
  const count = puzzles.length;
  const puzzle = puzzles[game];

  const finishGame = (r: GhostRun | null) => {
    const next: SeriesRun = { name, times: [...mine.times, r ? r.ms : null], steps: [...mine.steps, r ? r.steps : []] };
    setMine(next);
    if (game + 1 >= count) onComplete(next);
    else setBetween(true);
  };

  if (between) {
    const done = game;
    return (
      <div className="duel-start">
        <section className="panel">
          <h2>
            Game {done + 1} of {count}: {mine.times[done] === null ? 'gave up' : formatMs(mine.times[done]!)}
          </h2>
          <GameTimes runs={runs} mine={mine} game={done} />
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                setGame(done + 1);
                setBetween(false);
              }}
            >
              Next game
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (!puzzle)
    return (
      <section className="panel center">
        <span className="spinner" /> Preparing game {game + 1} of {count}…
      </section>
    );

  return <Race key={game} puzzle={puzzle} ghosts={gameGhosts(runs, game)} name={name} onDone={finishGame} />;
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

const timeOf = (t: number | null | undefined) => (t == null ? 'gave up' : formatMs(t));

/** Everyone's time in one game, fastest first. */
function GameTimes({ runs, mine, game }: { runs: SeriesRun[]; mine: SeriesRun; game: number }) {
  const rows = [...runs, mine].sort((a, b) => (a.times[game] ?? Infinity) - (b.times[game] ?? Infinity));
  return (
    <ol className="ghost-board">
      {rows.map((r, i) => (
        <li key={i} className={r === mine ? 'mine' : ''}>
          <span>{r === mine ? `${r.name} (you)` : r.name}</span>
          <strong>{timeOf(r.times[game])}</strong>
        </li>
      ))}
    </ol>
  );
}

/** Series standings: games won and total time, ranked by the series' rule. */
function Standings({ runs, scoring, mine }: { runs: SeriesRun[]; scoring: Scoring; mine?: SeriesRun | null }) {
  const games = Math.max(...[...runs, ...(mine ? [mine] : [])].map((r) => r.times.length));
  const rows = standings([...runs, ...(mine ? [mine] : [])], scoring);
  return (
    <table className="ghost-standings">
      <thead>
        <tr>
          <th />
          <th>Player</th>
          {games > 1 && <th className={scoring === 'wins' ? 'key' : ''}>Won</th>}
          <th className={scoring === 'time' || games === 1 ? 'key' : ''}>{games > 1 ? 'Total' : 'Time'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          <tr key={i} className={s.run === mine ? 'mine' : ''}>
            <td>{i + 1}.</td>
            <td>{s.run === mine ? `${s.run.name} (you)` : s.run.name}</td>
            {games > 1 && <td>{s.wins}</td>}
            <td>{s.total === null ? (games > 1 ? '—' : 'gave up') : formatMs(s.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const LevelPill = ({ d }: { d: Difficulty }) => <span className={`pill ${levelClass(d)}`}>{levelLabel(d)}</span>;

// -------------------------------------------------------- #/ghost: make one

export function GhostStart({ go }: { go: (hash: string) => void }) {
  const [name, setName] = useState(() => loadName());
  const [games, setGames] = useState(1);
  const [plan, setPlan] = useState<LevelPlan>('same');
  const [level, setLevel] = useState<Difficulty>('medium');
  const [scoring, setScoring] = useState<Scoring>('wins');
  const [phase, setPhase] = useState<'setup' | 'playing' | 'done'>('setup');
  const [puzzles, setPuzzles] = useState<(Puzzle | null)[]>([]);
  const [run, setRun] = useState<SeriesRun | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const player = name.trim() || 'Player';
  // A single game has nothing to tally: its time decides.
  const rule: Scoring = games > 1 ? scoring : 'time';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = () => {
    saveName(name.trim());
    setError(null);
    const levels = levelsFor(plan, level, games);
    setPuzzles(levels.map(() => null));
    setPhase('playing');
    // Generate the games in order, in the background: game 1 is ready first,
    // the rest are made while you play.
    (async () => {
      for (const [i, difficulty] of levels.entries()) {
        try {
          const q = await runEngine('quick', { ...DEFAULT_OPTIONS, maxPip: 6, difficulty, seed: randomSeed() }).promise;
          if (!q.ok) throw new Error(q.error);
          if (!alive.current) return;
          const puzzle: Puzzle = {
            version: 1,
            id: `ghost-${newId()}`,
            title: games > 1 ? `Game ${i + 1} of ${games}` : `${player}'s challenge`,
            difficulty: q.stats.rating,
            width: q.width,
            height: q.height,
            cells: q.cells,
            regions: q.regions,
            dominoes: q.dominoes,
            options: { ...DEFAULT_OPTIONS, maxPip: 6 },
          };
          setPuzzles((ps) => ps.map((p, j) => (j === i ? puzzle : p)));
        } catch (e) {
          if (!alive.current) return;
          setError((e as Error).message);
          setPhase('setup');
          return;
        }
      }
    })();
  };

  const complete = async (r: SeriesRun) => {
    setRun(r);
    setPhase('done');
    const ready = puzzles.filter((p): p is Puzzle => !!p);
    if (r.times.some((t) => t !== null) && ready.length === puzzles.length)
      setUrl(await ghostUrl({ puzzles: ready, scoring: rule, runs: [r] }));
  };

  if (phase === 'playing') return <SeriesRace puzzles={puzzles} runs={[]} name={player} onComplete={complete} />;

  const total = run && run.times.every((t) => t !== null) ? run.times.reduce<number>((a, t) => a + (t ?? 0), 0) : null;

  return (
    <div className="duel-start">
      <section className="panel">
        {phase === 'done' && run ? (
          <>
            <h2>
              {run.times.length > 1
                ? total !== null
                  ? `All ${run.times.length} games in ${formatMs(total)}`
                  : 'Series done'
                : run.times[0] !== null
                  ? `Solved in ${formatMs(run.times[0])}`
                  : 'You gave up'}
            </h2>
            {run.times.length > 1 && (
              <ol className="ghost-board">
                {run.times.map((t, i) => (
                  <li key={i}>
                    <span>
                      Game {i + 1} {puzzles[i]?.difficulty && <LevelPill d={puzzles[i]!.difficulty!} />}
                    </span>
                    <strong>{timeOf(t)}</strong>
                  </li>
                ))}
              </ol>
            )}
            {url ? (
              <>
                <p className="muted">Send this to a friend: they race your ghost on the same puzzles.</p>
                <LinkBox url={url} title={`Beat me in Pips (${SCORING_LABEL[rule].toLowerCase()})`} />
              </>
            ) : (
              <p className="muted">You gave up every game, so there's no ghost to race.</p>
            )}
          </>
        ) : (
          <>
            <h2>👻 Ghost challenge</h2>
            <p className="muted">
              Play against the clock (no Reveal). Then send it to a friend: they race your recorded ghost on the same
              puzzles, and can pass it on with their own times.
            </p>
            <NameField name={name} setName={setName} />
            <div className="row">
              <label>
                Games
                <select value={games} onChange={(e) => setGames(+e.target.value)}>
                  {GAME_COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {games > 1 && (
                <label>
                  Levels
                  <select value={plan} onChange={(e) => setPlan(e.target.value as LevelPlan)}>
                    {(Object.keys(PLAN_LABEL) as LevelPlan[]).map((p) => (
                      <option key={p} value={p}>
                        {PLAN_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!(games > 1 && plan === 'mixed') && (
                <label>
                  {games > 1 && plan === 'increasing' ? 'Start at' : 'Level'}
                  <select value={level} onChange={(e) => setLevel(e.target.value as Difficulty)}>
                    {PLAYABLE_LEVELS.map((d) => (
                      <option key={d} value={d}>
                        {levelLabel(d)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {games > 1 && (
              <label>
                Winner
                <select value={scoring} onChange={(e) => setScoring(e.target.value as Scoring)}>
                  {(Object.keys(SCORING_LABEL) as Scoring[]).map((s) => (
                    <option key={s} value={s}>
                      {SCORING_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {games > 1 && plan !== 'mixed' && (
              <p className="muted small">
                Games:{' '}
                {levelsFor(plan, level, games)
                  .map(levelLabel)
                  .join(' → ')}
              </p>
            )}
            {error && <p className="error small">Could not make a puzzle: {error}</p>}
          </>
        )}
        <div className="row">
          <button
            className="btn"
            onClick={
              phase === 'done'
                ? () => {
                    setPhase('setup');
                    setRun(null);
                    setUrl('');
                  }
                : start
            }
          >
            {phase === 'done' ? 'Make another' : 'Start'}
          </button>
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
  const [data, setData] = useState<GhostSeries | null | undefined>(undefined);
  const [name, setName] = useState(() => loadName());
  const [phase, setPhase] = useState<'intro' | 'playing' | 'done'>('intro');
  const [mine, setMine] = useState<SeriesRun | null>(null);
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

  const { puzzles, runs, scoring } = data;
  const count = puzzles.length;
  const leader = standings(runs, scoring)[0].run;

  const complete = async (r: SeriesRun) => {
    setMine(r);
    setPhase('done');
    if (r.times.some((t) => t !== null)) setUrl(await ghostUrl({ puzzles, scoring, runs: [...runs, r] }));
  };

  if (phase === 'playing') return <SeriesRace puzzles={puzzles} runs={runs} name={player} onComplete={complete} />;

  let verdict: string | null = null;
  if (mine) {
    const final = standings([...runs, mine], scoring);
    const winner = final[0];
    const iWon = winner.run === mine;
    if (count === 1 && mine.times[0] !== null) {
      const best = Math.min(...runs.map((r) => r.times[0] ?? Infinity));
      const bestName = runs.find((r) => r.times[0] === best)?.name ?? leader.name;
      verdict =
        mine.times[0] < best
          ? `You beat ${bestName} by ${formatMs(best - mine.times[0])}!`
          : `${bestName} was faster by ${formatMs(mine.times[0] - best)}.`;
    } else verdict = iWon ? 'You won the series!' : `${winner.run.name} wins the series.`;
  }

  return (
    <div className="duel-start">
      <section className="panel">
        {phase === 'intro' ? (
          <>
            <h2>👻 {leader.name} challenges you</h2>
            <p className="ghost-summary">
              {count === 1 ? '1 puzzle' : `${count} games`}{' '}
              {puzzles.map((p, i) => p.difficulty && <LevelPill key={i} d={p.difficulty} />)}
              {count > 1 && <span className="muted small"> · Winner: {SCORING_LABEL[scoring].toLowerCase()}</span>}
            </p>
            <p className="muted small">Each puzzle appears when its countdown ends. No Reveal.</p>
            <h4>To beat</h4>
            <Standings runs={runs} scoring={scoring} />
            <NameField name={name} setName={setName} />
          </>
        ) : (
          <>
            <h2>{verdict}</h2>
            <Standings runs={runs} scoring={scoring} mine={mine} />
            {mine && url && (
              <>
                <p className="muted">Pass it on: the next player races everyone's ghosts, including yours.</p>
                <LinkBox url={url} title="Beat me in Pips" />
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
                setPhase('playing');
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

import { useEffect, useRef, useState } from 'react';
import type { Difficulty, Puzzle } from '../../model/types';
import { DEFAULT_OPTIONS } from '../../model/types';
import { loadName, saveName } from '../../model/storage';
import { decodeShare, encodeShare } from '../../model/serialize';
import { runEngine } from '../../engine/client';
import { randomSeed } from '../../engine/rng';
import { type DuelNet, openRoom } from '../../duel/net';
import { type DuelMsg, EMOJIS, type Placed, PROTOCOL, isHost, normaliseCode, randomCode } from '../../duel/protocol';
import { validFinish } from '../../duel/referee';
import { Play } from '../play/Play';
import { formatMs } from '../format';

const LEVELS: Difficulty[] = ['easy', 'medium', 'hard', 'expert', 'rachel'];
const COUNTDOWN_MS = 3000;
/** After this long alone in the room, explain what might be wrong. */
const LONELY_HINT_MS = 30_000;
/** How long a reaction stays on screen, and the minimum gap between sending two. */
const REACTION_MS = 2600;
const REACTION_COOLDOWN_MS = 600;

interface Reaction {
  id: number;
  from: 'me' | 'opp';
  e: string;
  /** Horizontal position, % of the screen width. */
  x: number;
}


const inviteUrl = (code: string) => `${location.origin}${location.pathname}#/duel/${code}`;

// ---------------------------------------------------------------- start page

/** #/duel: pick a name, then create a room or join one by code. */
export function DuelStart({ go }: { go: (hash: string) => void }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const valid = normaliseCode(code);
  const keepName = () => saveName(name.trim());
  return (
    <div className="duel-start">
      <section className="panel">
        <h2>Duel a friend</h2>
        <p className="muted">
          Race on the same puzzle in real time. Create a room and send the link, or join with a friend's code. Games go
          directly between your browsers.
        </p>
        <label>
          Your name
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="Player" />
        </label>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              keepName();
              go(`#/duel/${randomCode()}/host`);
            }}
          >
            Create a duel
          </button>
        </div>
        <div className="row">
          <label>
            Room code
            <input
              value={code}
              maxLength={6}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCD"
              className="code-input"
              onKeyDown={(e) => e.key === 'Enter' && valid && (keepName(), go(`#/duel/${valid}`))}
            />
          </label>
          <button
            className="btn ghost"
            disabled={!valid}
            onClick={() => {
              keepName();
              go(`#/duel/${valid}`);
            }}
          >
            Join
          </button>
        </div>
        <p className="muted small">
          No account needed. Works on most home and mobile networks; some company or school networks block direct
          connections between browsers.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- the duel

type Phase = 'lobby' | 'generating' | 'countdown' | 'playing' | 'result';

interface Opponent {
  id: string;
  name: string;
  ready: boolean;
  placed: number;
  connected: boolean;
}

interface Result {
  winner: 'me' | 'opp';
  myMs: number | null;
  oppMs: number | null;
}

interface DuelState {
  phase: Phase;
  opp: Opponent | null;
  host: boolean;
  difficulty: Difficulty;
  round: number;
  puzzle: Puzzle | null;
  startAt: number | null;
  result: Result | null;
  score: { me: number; opp: number };
  /** Round-trip time to the opponent, ms. */
  rtt: number;
  notice: string | null;
  /** Can't continue in this room. */
  fatal: string | null;
}

/** #/duel/<code>[/host]: one room, 1-on-1. The host referees. */
export function Duel({ code, wantHost, go }: { code: string; wantHost: boolean; go: (hash: string) => void }) {
  const [name, setName] = useState(() => loadName() || 'Player');
  const [s, setS] = useState<DuelState>({
    phase: 'lobby',
    opp: null,
    host: wantHost,
    difficulty: 'medium',
    round: 0,
    puzzle: null,
    startAt: null,
    result: null,
    score: { me: 0, opp: 0 },
    rtt: 0,
    notice: null,
    fatal: null,
  });
  const [ready, setReady] = useState(false);
  const [lonely, setLonely] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const lastReaction = useRef(0);
  const sRef = useRef(s);
  sRef.current = s;
  const nameRef = useRef(name);
  nameRef.current = name;
  const netRef = useRef<DuelNet | null>(null);

  const update = (fn: (x: DuelState) => DuelState) =>
    setS((prev) => {
      const next = fn(prev);
      sRef.current = next;
      return next;
    });
  const send = (msg: DuelMsg, to?: string) => netRef.current?.send(msg, to);
  const toOpp = (msg: DuelMsg) => {
    const opp = sRef.current.opp;
    if (opp?.connected) send(msg, opp.id);
  };

  /** Floats an emoji up the screen: yours on the left, the opponent's on the right. */
  const showReaction = (from: Reaction['from'], e: string) => {
    const id = Math.random();
    const x = (from === 'me' ? 12 : 62) + Math.random() * 26;
    setReactions((rs) => [...rs.slice(-11), { id, from, e, x }]);
    setTimeout(() => setReactions((rs) => rs.filter((r) => r.id !== id)), REACTION_MS);
  };

  const react = (e: string) => {
    if (Date.now() - lastReaction.current < REACTION_COOLDOWN_MS) return;
    lastReaction.current = Date.now();
    toOpp({ t: 'emoji', e });
    showReaction('me', e);
  };

  const applyResult = (winner: 'host' | 'guest', hostMs: number | null, guestMs: number | null) =>
    update((x) => {
      const me = x.host ? 'host' : 'guest';
      const result: Result = {
        winner: winner === me ? 'me' : 'opp',
        myMs: x.host ? hostMs : guestMs,
        oppMs: x.host ? guestMs : hostMs,
      };
      const score = { ...x.score };
      score[result.winner]++;
      return { ...x, phase: 'result', result, score };
    });

  /** Host only: announce the round's winner. */
  const declare = (winner: 'host' | 'guest', hostMs: number | null, guestMs: number | null) => {
    const x = sRef.current;
    if (!x.host || x.result) return;
    toOpp({ t: 'result', round: x.round, winner, hostMs, guestMs });
    applyResult(winner, hostMs, guestMs);
  };

  const opponentGone = (message: string) =>
    update((x) => {
      if (!x.opp) return x;
      const midRound = x.phase === 'generating' || x.phase === 'countdown' || x.phase === 'playing';
      return {
        ...x,
        opp: { ...x.opp, connected: false, ready: false },
        phase: midRound ? 'lobby' : x.phase,
        notice: midRound ? `${x.opp.name} left. The round is cancelled.` : message,
      };
    });

  const handle = (msg: DuelMsg, peer: string) => {
    const x = sRef.current;
    const net = netRef.current;
    if (!net) return;
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL) {
        update((y) => ({ ...y, fatal: 'You and your opponent have different versions of the app. Both reload the page.' }));
        return;
      }
      const busy = x.opp && x.opp.id !== peer && x.opp.connected;
      // They're already in a duel with someone else: this room is full for us.
      if (msg.paired && !busy && x.opp?.id !== peer) {
        update((y) => ({ ...y, fatal: 'This duel already has two players. Create a new one instead.' }));
        return;
      }
      // We're already in a duel: ignore newcomers (their hello from us says we're paired).
      if (busy) return;
      const returning = x.opp?.id === peer && x.opp.connected;
      const host = isHost(wantHost, msg.host, net.selfId, peer);
      update((y) => ({
        ...y,
        host,
        opp: returning
          ? { ...y.opp!, name: msg.name || 'Opponent' }
          : { id: peer, name: msg.name || 'Opponent', ready: false, placed: 0, connected: true },
        // A (re)joining opponent always starts from the lobby.
        phase: returning ? y.phase : 'lobby',
        result: returning ? y.result : null,
        notice: returning ? y.notice : null,
      }));
      if (!returning) {
        setReady(false);
        net.ping(peer).then((rtt) => update((y) => ({ ...y, rtt })), () => {});
        if (host) send({ t: 'level', difficulty: sRef.current.difficulty }, peer);
      }
      return;
    }
    // Everything else only from the current opponent.
    if (!x.opp || x.opp.id !== peer) return;
    switch (msg.t) {
      case 'leave':
        opponentGone(`${x.opp.name} left. They can come back with the same code.`);
        break;
      case 'ready':
        update((y) => ({ ...y, opp: y.opp && { ...y.opp, ready: msg.ready } }));
        break;
      case 'level':
        if (!x.host) update((y) => ({ ...y, difficulty: msg.difficulty }));
        break;
      case 'lobby':
        if (!x.host) {
          setReady(false);
          update((y) => ({ ...y, phase: 'lobby', puzzle: null, startAt: null, result: null }));
        }
        break;
      case 'generating':
        if (!x.host) update((y) => ({ ...y, phase: 'generating', round: msg.round, puzzle: null, result: null }));
        break;
      case 'puzzle':
        if (!x.host)
          decodeShare(msg.code).then((p) => {
            if (!p || sRef.current.round !== msg.round) return;
            update((y) => ({ ...y, puzzle: p }));
            send({ t: 'loaded', round: msg.round }, peer);
          });
        break;
      case 'loaded':
        // Both have the puzzle: count down together.
        if (x.host && msg.round === x.round && x.phase === 'generating' && x.puzzle) {
          send({ t: 'go', round: x.round, inMs: COUNTDOWN_MS }, peer);
          update((y) => ({ ...y, phase: 'countdown', startAt: Date.now() + COUNTDOWN_MS }));
        }
        break;
      case 'go':
        // Start when the host does: allow for half the round trip.
        if (!x.host && msg.round === x.round)
          update((y) => ({ ...y, phase: 'countdown', startAt: Date.now() + msg.inMs - y.rtt / 2 }));
        break;
      case 'emoji':
        if ((EMOJIS as readonly string[]).includes(msg.e)) showReaction('opp', msg.e);
        break;
      case 'progress':
        if (msg.round === x.round) update((y) => ({ ...y, opp: y.opp && { ...y.opp, placed: msg.placed } }));
        break;
      case 'finished': {
        // The referee checks the actual placements and times the finish on its own clock.
        if (!x.host || msg.round !== x.round || x.result || !x.puzzle || x.startAt === null) break;
        if (!validFinish(x.puzzle, msg.placed as Placed)) break;
        const measured = Math.max(0, Date.now() - x.startAt - x.rtt / 2);
        declare('guest', null, Math.max(measured, msg.ms));
        break;
      }
      case 'result':
        if (!x.host && msg.round === x.round) applyResult(msg.winner, msg.hostMs, msg.guestMs);
        break;
    }
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  // Join the room for as long as this screen is open.
  useEffect(() => {
    const net = openRoom(code, {
      onJoin: (peer) =>
        net.send({ t: 'hello', name: nameRef.current, host: wantHost, paired: !!sRef.current.opp?.connected, v: PROTOCOL }, peer),
      onLeave: (peer) => {
        const opp = sRef.current.opp;
        if (opp?.id === peer && opp.connected) opponentGone(`${opp.name} disconnected. They can come back with the same code.`);
      },
      onMessage: (msg, peer) => handleRef.current(msg, peer),
      onError: (message) => update((x) => ({ ...x, notice: `Connection problem: ${message}` })),
    });
    netRef.current = net;
    return () => {
      net.send({ t: 'leave' });
      net.leave();
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, wantHost]);

  // Explain if nobody shows up.
  const alone = !s.opp?.connected;
  useEffect(() => {
    setLonely(false);
    if (!alone) return;
    const t = setTimeout(() => setLonely(true), LONELY_HINT_MS);
    return () => clearTimeout(t);
  }, [alone]);

  // Countdown ticks, then play.
  useEffect(() => {
    if (s.phase !== 'countdown' || s.startAt === null) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= (sRef.current.startAt ?? Infinity)) update((x) => (x.phase === 'countdown' ? { ...x, phase: 'playing' } : x));
    }, 100);
    return () => clearInterval(t);
  }, [s.phase, s.startAt]);

  const startRound = async () => {
    const x = sRef.current;
    if (!x.host || !x.opp?.connected || !x.opp.ready) return;
    const round = x.round + 1;
    update((y) => ({ ...y, phase: 'generating', round, puzzle: null, startAt: null, result: null, notice: null }));
    toOpp({ t: 'generating', round });
    const maxPip = x.difficulty === 'rachel' ? 9 : 6;
    try {
      const q = await runEngine('quick', { ...DEFAULT_OPTIONS, maxPip, difficulty: x.difficulty, seed: randomSeed() }).promise;
      if (!q.ok) throw new Error(q.error);
      if (sRef.current.round !== round || sRef.current.phase !== 'generating') return;
      const puzzle: Puzzle = {
        version: 1,
        id: `duel-${code}-${round}`,
        title: `Round ${round}`,
        difficulty: q.stats.rating,
        width: q.width,
        height: q.height,
        cells: q.cells,
        regions: q.regions,
        dominoes: q.dominoes,
        options: { ...DEFAULT_OPTIONS, maxPip },
      };
      update((y) => ({ ...y, puzzle }));
      // The countdown starts once the opponent confirms it has the puzzle.
      toOpp({ t: 'puzzle', round, code: await encodeShare(puzzle) });
    } catch (e) {
      update((y) => ({ ...y, phase: 'lobby', notice: `Could not make a puzzle: ${(e as Error).message}` }));
      toOpp({ t: 'lobby' });
    }
  };

  const backToLobby = () => {
    setReady(false);
    update((x) => ({ ...x, phase: 'lobby', puzzle: null, startAt: null, result: null, opp: x.opp && { ...x.opp, ready: false, placed: 0 } }));
    toOpp({ t: 'lobby' });
  };

  const toggleReady = () => {
    const next = !ready;
    setReady(next);
    toOpp({ t: 'ready', ready: next });
  };

  const changeLevel = (difficulty: Difficulty) => {
    update((x) => ({ ...x, difficulty }));
    toOpp({ t: 'level', difficulty });
  };

  const commitName = () => {
    const clean = name.trim() || 'Player';
    setName(clean);
    saveName(clean);
    const opp = sRef.current.opp;
    if (opp?.connected) send({ t: 'hello', name: clean, host: wantHost, paired: true, v: PROTOCOL }, opp.id);
  };

  const onSolved = (placed: Placed, ms: number) => {
    const x = sRef.current;
    if (x.host) declare('host', ms, null);
    else toOpp({ t: 'finished', round: x.round, ms, placed });
  };

  const leave = () => {
    if (s.phase === 'playing' && !confirm('Leave the duel? The round will be cancelled.')) return;
    go('#/');
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      update((x) => ({ ...x, notice: 'Invite link copied' }));
    } catch {
      update((x) => ({ ...x, notice: 'Could not copy; share the code instead' }));
    }
  };

  const opp = s.opp;
  const oppName = opp?.name ?? 'Opponent';

  if (s.fatal)
    return (
      <div className="duel">
        <section className="panel">
          <p>{s.fatal}</p>
          <button className="btn" onClick={() => go('#/duel')}>
            Back
          </button>
        </section>
      </div>
    );

  return (
    <div className="duel">
      <div className="duel-bar">
        <button className="btn ghost" onClick={leave}>
          ← Leave
        </button>
        <div className="duel-title">
          Duel <span className="duel-code">{code}</span>
        </div>
        <div className="duel-score" title="Rounds won">
          You {s.score.me} – {s.score.opp} {oppName}
        </div>
      </div>
      {s.notice && <p className="duel-notice">{s.notice}</p>}
      {opp?.connected && (
        <div className="duel-reactions" aria-label="Send a reaction">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => react(e)} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="reaction-layer" aria-live="polite">
        {reactions.map((r) => (
          <div key={r.id} className={`reaction ${r.from}`} style={{ left: `${r.x}%` }}>
            {r.e}
            <span>{r.from === 'me' ? 'You' : oppName}</span>
          </div>
        ))}
      </div>

      {s.phase === 'lobby' && (
        <section className="panel duel-lobby">
          {!opp?.connected && (
            <div className="duel-invite">
              <p>Send this to your opponent:</p>
              <div className="duel-code big">{code}</div>
              <div className="row center">
                <code className="duel-link">{inviteUrl(code)}</code>
                <button className="btn ghost" onClick={copyInvite}>
                  Copy link
                </button>
              </div>
              <p className="muted small">
                <span className="spinner" /> Waiting for your opponent to join…
              </p>
              {lonely && (
                <p className="muted small">
                  Still nobody? Check that your friend opened the link or typed <strong>{code}</strong>. If they did,
                  your networks may block direct connections between browsers (common on company Wi-Fi); try a
                  phone hotspot or home network.
                </p>
              )}
            </div>
          )}
          <div className="duel-players">
            <div className="duel-player">
              <label>
                You {s.host && <span className="pill">host</span>}
                <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onBlur={commitName} />
              </label>
              {!s.host && opp?.connected && (
                <button className={`btn ${ready ? '' : 'ghost'}`} onClick={toggleReady}>
                  {ready ? 'Ready ✓' : "I'm ready"}
                </button>
              )}
            </div>
            <div className="duel-player">
              <strong>{opp?.connected ? opp.name : '—'}</strong>
              <span className="muted small">
                {!opp?.connected ? 'not here yet' : s.host ? (opp.ready ? 'ready ✓' : 'not ready yet') : 'host'}
              </span>
            </div>
          </div>
          <div className="row center">
            <label>
              Level
              <select value={s.difficulty} onChange={(e) => changeLevel(e.target.value as Difficulty)} disabled={!s.host}>
                {LEVELS.map((d) => (
                  <option key={d} value={d}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            {s.host && (
              <button className="btn" onClick={startRound} disabled={!opp?.connected || !opp.ready}>
                {s.round ? 'Start next round' : 'Start'}
              </button>
            )}
          </div>
          <p className="muted small center">
            {s.host
              ? opp?.connected && !opp.ready
                ? `Waiting for ${opp.name} to press "I'm ready".`
                : 'You choose the level and start each round.'
              : opp?.connected
                ? `${opp.name} chooses the level and starts the round.`
                : ''}
          </p>
        </section>
      )}

      {s.phase === 'generating' && (
        <section className="panel center">
          <span className="spinner" /> Preparing a {s.difficulty} puzzle for round {s.round}…
        </section>
      )}

      {s.phase === 'countdown' && s.startAt !== null && (
        <div className="duel-countdown">{Math.max(1, Math.ceil((s.startAt - now) / 1000))}</div>
      )}

      {(s.phase === 'playing' || s.phase === 'result') && s.puzzle && s.startAt !== null && (
        <>
          <div className="duel-opponent">
            <span>{oppName}</span>
            <div className="duel-progress">
              <div style={{ width: `${(100 * (opp?.placed ?? 0)) / s.puzzle.dominoes.length}%` }} />
            </div>
            <span className="muted small">
              {opp?.placed ?? 0}/{s.puzzle.dominoes.length}
            </span>
          </div>
          <Play
            key={s.round}
            puzzle={s.puzzle}
            source="shared"
            onHome={leave}
            race={{
              startAt: s.startAt,
              locked: s.phase === 'result',
              onProgress: (placed) => toOpp({ t: 'progress', round: sRef.current.round, placed }),
              onSolved,
            }}
          />
        </>
      )}

      {s.phase === 'result' && s.result && (
        <div className="duel-result">
          <div className="modal">
            <h2>{s.result.winner === 'me' ? 'You win!' : `${oppName} wins`}</h2>
            <p>
              {s.result.winner === 'me'
                ? `Solved in ${formatMs(s.result.myMs ?? 0)}.`
                : `${oppName} solved it in ${formatMs(s.result.oppMs ?? 0)}.`}
            </p>
            <p className="muted">
              Score: you {s.score.me} – {s.score.opp} {oppName}
            </p>
            <div className="row center">
              {s.host ? (
                <button className="btn" onClick={backToLobby} disabled={!opp?.connected}>
                  Next round
                </button>
              ) : (
                <span className="muted small">Waiting for {oppName} to start the next round…</span>
              )}
              <button className="btn ghost" onClick={() => go('#/')}>
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

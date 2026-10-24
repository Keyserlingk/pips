import type { Constraint, Difficulty, ExtraKind, Puzzle } from './types';

/*
 * Share links: #/p/<code>. The code is a compact JSON form of the puzzle,
 * compressed (deflate) and base64url-encoded. The first character says how:
 *   z = compressed, j = plain (browsers without CompressionStream).
 * The solution is never included; the recipient's app can solve the puzzle
 * itself when Reveal is used.
 *
 * Older links (#/play/s/<code>) hold the full puzzle JSON and still decode.
 */

type Compact = {
  i: string;
  t: string;
  a?: string;
  d?: Difficulty;
  w: number;
  h: number;
  /** Cell indices (r * w + c). */
  c: number[];
  /** Regions: [colour, constraint, cell indices]. */
  r: [number, Constraint, number[]][];
  /** Dominoes, flattened pairs. */
  m: number[];
  /** [maxPip, allowDuplicates, requireUnique, extras]. */
  o: [6 | 9, 0 | 1, 0 | 1, ExtraKind[]?];
};

function toCompact(p: Puzzle): Compact {
  const idx = (c: { r: number; c: number }) => c.r * p.width + c.c;
  return {
    i: p.id,
    t: p.title,
    ...(p.author ? { a: p.author } : {}),
    ...(p.difficulty ? { d: p.difficulty } : {}),
    w: p.width,
    h: p.height,
    c: p.cells.map(idx),
    r: p.regions.map((r) => [r.color, r.constraint, r.cells.map(idx)]),
    m: p.dominoes.flat(),
    o: [
      p.options.maxPip,
      p.options.allowDuplicates ? 1 : 0,
      p.options.requireUnique ? 1 : 0,
      ...(p.options.extras?.length ? [p.options.extras] : []),
    ] as Compact['o'],
  };
}

function fromCompact(x: Compact): Puzzle {
  const cell = (i: number) => ({ r: Math.floor(i / x.w), c: i % x.w });
  const dominoes: [number, number][] = [];
  for (let k = 0; k + 1 < x.m.length; k += 2) dominoes.push([x.m[k], x.m[k + 1]]);
  return {
    version: 1,
    id: x.i,
    title: x.t,
    author: x.a,
    difficulty: x.d,
    width: x.w,
    height: x.h,
    cells: x.c.map(cell),
    regions: x.r.map(([color, constraint, cells], k) => ({ id: `r${k}`, color, constraint, cells: cells.map(cell) })),
    dominoes,
    options: { maxPip: x.o[0], allowDuplicates: !!x.o[1], requireUnique: !!x.o[2], extras: x.o[3] ?? [] },
  };
}

const toBase64Url = (bytes: Uint8Array) => {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== 'undefined';

/** JSON → (compressed) base64url, prefixed z (deflate) or j (plain). */
async function pack(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  if (!canCompress()) return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate')));
}

async function unpack(code: string): Promise<unknown> {
  const bytes = fromBase64Url(code.slice(1));
  const json = code[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate')) : bytes;
  return JSON.parse(new TextDecoder().decode(json));
}

export const encodeShare = (p: Puzzle) => pack(toCompact(p));

export async function decodeShare(code: string): Promise<Puzzle | null> {
  try {
    const p = fromCompact((await unpack(code)) as Compact);
    return isPuzzle(p) ? p : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- ghost links

/** One recorded attempt: who, how long, and how many pieces were placed when. */
export interface GhostRun {
  name: string;
  ms: number;
  /** [ms since start, pieces on the board] each time the count changed. */
  steps: [number, number][];
}

/** Runs carried by a link (the fastest are kept) and recorded steps per run. */
export const MAX_GHOST_RUNS = 5;
const MAX_STEPS = 300;

/** Steps are stored as tenths of a second since the previous step, then the count. */
function packSteps(steps: [number, number][]): number[] {
  // Very long runs: keep an evenly spaced subset (and the last step).
  const every = Math.ceil(steps.length / MAX_STEPS);
  const kept = steps.filter((_, i) => i % every === 0 || i === steps.length - 1);
  const out: number[] = [];
  let prev = 0;
  for (const [ms, count] of kept) {
    const t = Math.round(ms / 100);
    out.push(t - prev, count);
    prev = t;
  }
  return out;
}

function unpackSteps(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  let t = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    t += flat[i];
    out.push([t * 100, flat[i + 1]]);
  }
  return out;
}

export const fastestRuns = (runs: GhostRun[]) => [...runs].sort((a, b) => a.ms - b.ms).slice(0, MAX_GHOST_RUNS);

export const encodeGhost = (puzzle: Puzzle, runs: GhostRun[]) =>
  pack({ p: toCompact(puzzle), r: fastestRuns(runs).map((r) => [r.name.slice(0, 20), Math.round(r.ms), packSteps(r.steps)]) });

export async function decodeGhost(code: string): Promise<{ puzzle: Puzzle; runs: GhostRun[] } | null> {
  try {
    const x = (await unpack(code)) as { p: Compact; r: [string, number, number[]][] };
    const puzzle = fromCompact(x.p);
    if (!isPuzzle(puzzle) || !Array.isArray(x.r)) return null;
    const runs = x.r
      .filter((r) => Array.isArray(r) && typeof r[1] === 'number' && Array.isArray(r[2]))
      .map(([name, ms, steps]) => ({ name: String(name).slice(0, 20) || 'Someone', ms, steps: unpackSteps(steps) }));
    return runs.length ? { puzzle, runs } : null;
  } catch {
    return null;
  }
}

export const ghostUrl = async (puzzle: Puzzle, runs: GhostRun[]) =>
  `${location.origin}${location.pathname}#/g/${await encodeGhost(puzzle, runs)}`;

/** Pieces a ghost had on the board `ms` into its run. */
export function ghostPlaced(run: GhostRun, ms: number): number {
  let placed = 0;
  for (const [t, count] of run.steps) {
    if (t > ms) break;
    placed = count;
  }
  return placed;
}

export const shareUrl = async (p: Puzzle) => `${location.origin}${location.pathname}#/p/${await encodeShare(p)}`;

/** Old-style links (#/play/s/<code>): plain base64url JSON of the whole puzzle. */
export function decodeLegacy(code: string): Puzzle | null {
  try {
    const p = JSON.parse(new TextDecoder().decode(fromBase64Url(code)));
    return isPuzzle(p) ? p : null;
  } catch {
    return null;
  }
}

export function isPuzzle(p: unknown): p is Puzzle {
  const x = p as Puzzle;
  return (
    !!x &&
    x.version === 1 &&
    typeof x.id === 'string' &&
    Array.isArray(x.cells) &&
    Array.isArray(x.regions) &&
    Array.isArray(x.dominoes) &&
    typeof x.width === 'number' &&
    typeof x.height === 'number'
  );
}

/** Compares the parts of two puzzles a player sees (ignores ids, solution and difficulty). */
export function samePuzzle(a: Puzzle, b: Puzzle): boolean {
  const view = (p: Puzzle) =>
    JSON.stringify([p.title, p.author ?? '', p.width, p.height, toCompact(p).c, toCompact(p).r.map(([, k, c]) => [k, c]), p.dominoes]);
  return view(a) === view(b);
}

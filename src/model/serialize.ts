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

export async function encodeShare(p: Puzzle): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toCompact(p)));
  if (!canCompress()) return 'j' + toBase64Url(json);
  return 'z' + toBase64Url(await pipe(json, new CompressionStream('deflate')));
}

export async function decodeShare(code: string): Promise<Puzzle | null> {
  try {
    const bytes = fromBase64Url(code.slice(1));
    const json = code[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate')) : bytes;
    const p = fromCompact(JSON.parse(new TextDecoder().decode(json)));
    return isPuzzle(p) ? p : null;
  } catch {
    return null;
  }
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

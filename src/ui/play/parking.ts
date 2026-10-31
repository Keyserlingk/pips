import type { Orient } from '../../model/storage';

/*
 * Parking: dominoes set down around the board at any position (not snapped
 * to squares), to keep them close to where they might go later. Positions
 * are in cells, measured from the board's top-left square, so they scale
 * with the board. Parked dominoes may not overlap each other or the board's
 * squares.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Parked {
  x: number;
  y: number;
  orient: Orient;
}

/** How far (in cells) a drop may be nudged to find a free spot. */
const NUDGE_RADIUS = 1.5;
const NUDGE_STEP = 0.1;

const horizontal = (o: Orient) => o % 2 === 0;

export const parkedRect = (p: Parked): Rect => ({ x: p.x, y: p.y, ...(horizontal(p.orient) ? { w: 2, h: 1 } : { w: 1, h: 2 }) });

/**
 * Where a dragged domino lands: the grabbed half is centred on the pointer
 * (as the drag ghost draws it). `visual` is 0 when the grabbed half is drawn
 * left/top.
 */
export function dropRect(at: { x: number; y: number }, visual: 0 | 1, orient: Orient): Rect {
  return horizontal(orient)
    ? { x: at.x - visual - 0.5, y: at.y - 0.5, w: 2, h: 1 }
    : { x: at.x - 0.5, y: at.y - visual - 0.5, w: 1, h: 2 };
}

/** Touching edges is fine; only a real overlap counts. */
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Is `r` within `bounds`? Allows rounding error, so a domino set down against the edge stays put. */
export function within(r: Rect, bounds: Rect) {
  const e = 0.01;
  return r.x >= bounds.x - e && r.y >= bounds.y - e && r.x + r.w <= bounds.x + bounds.w + e && r.y + r.h <= bounds.y + bounds.h + e;
}

/**
 * The free spot nearest to `want` (same size) inside `bounds` that overlaps
 * none of `blocked`, or null if there is none within a short nudge.
 */
export function findSpot(want: Rect, blocked: Rect[], bounds: Rect): { x: number; y: number } | null {
  const clampX = (x: number) => Math.min(Math.max(x, bounds.x), bounds.x + bounds.w - want.w);
  const clampY = (y: number) => Math.min(Math.max(y, bounds.y), bounds.y + bounds.h - want.h);
  if (want.w > bounds.w || want.h > bounds.h) return null;
  const n = Math.round(NUDGE_RADIUS / NUDGE_STEP);
  const offsets: [number, number][] = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) if (i * i + j * j <= n * n) offsets.push([i * NUDGE_STEP, j * NUDGE_STEP]);
  offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));
  for (const [dx, dy] of offsets) {
    const r = { ...want, x: clampX(want.x + dx), y: clampY(want.y + dy) };
    if (!blocked.some((b) => overlaps(r, b))) return { x: r.x, y: r.y };
  }
  return null;
}

/** The same domino turned to `orient`, keeping its centre where it was. */
export function turned(p: Parked, orient: Orient): Rect {
  const r = parkedRect(p);
  const next = parkedRect({ x: 0, y: 0, orient });
  return { ...next, x: r.x + r.w / 2 - next.w / 2, y: r.y + r.h / 2 - next.h / 2 };
}

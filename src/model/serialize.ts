import type { Puzzle } from './types';

export function encodePuzzle(p: Puzzle): string {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePuzzle(code: string): Puzzle | null {
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
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

export const shareUrl = (p: Puzzle) =>
  `${location.origin}${location.pathname}#/play/s/${encodePuzzle(p)}`;

/** Board geometry shared by the renderers and their tests (viewBox units). */

/** Size of one cell. */
export const S = 100;
/** Distance of the outer pips from the centre of a domino half. */
export const PIP_OFFSET = S * 0.24;
export const PIP_R = S * 0.085;

export const BADGE_STROKE = 3;
export const BADGE_OK_STROKE = 5;

export type BadgeShape =
  | { kind: 'diamond'; half: number; fontSize: number }
  | { kind: 'pill'; halfW: number; halfH: number; fontSize: number };

/**
 * Badges are centred on a grid corner. Pips never come closer than
 * S/2 - PIP_OFFSET - PIP_R (= 17.5) to a grid line, so a pill shorter than
 * that, or a diamond small enough, can never cover a pip.
 */
export function badgeShape(label: string): BadgeShape {
  const n = [...label].length;
  if (n > 3) return { kind: 'pill', halfW: 8 + n * 6.5, halfH: 13, fontSize: 19 };
  return { kind: 'diamond', half: n === 3 ? 27 : 24, fontSize: n === 1 ? 26 : n === 2 ? 22 : 17 };
}

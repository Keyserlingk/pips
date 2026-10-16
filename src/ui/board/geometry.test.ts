import { describe, expect, it } from 'vitest';
import { constraintLabel } from '../../model/cells';
import type { Constraint } from '../../model/types';
import { BADGE_OK_STROKE, PIP_OFFSET, PIP_R, S, badgeShape } from './geometry';

// Every pip position in the four cells around a grid corner at (0, 0).
const offsets = [-PIP_OFFSET, 0, PIP_OFFSET];
const pips: [number, number][] = [];
for (const cellX of [-S, 0])
  for (const cellY of [-S, 0])
    for (const dx of offsets) for (const dy of offsets) pips.push([cellX + S / 2 + dx, cellY + S / 2 + dy]);

const labels = [
  ...[0, 5, 12, 42].map((v) => constraintLabel({ kind: 'sum', op: '=', value: v })),
  ...[3, 18].flatMap((v) => [
    constraintLabel({ kind: 'sum', op: '<', value: v }),
    constraintLabel({ kind: 'sum', op: '>', value: v }),
  ]),
  '=',
  '≠',
  ...([
    { kind: 'step', max: 1 },
    { kind: 'product', value: 0 },
    { kind: 'product', value: 12 },
    { kind: 'product', value: 7776 },
    { kind: 'extreme', which: 'max', value: 5 },
    { kind: 'extreme', which: 'min', value: 0 },
    { kind: 'sumParity', even: true },
    { kind: 'sumParity', even: false },
  ] as Constraint[]).map(constraintLabel),
];

describe('badge geometry', () => {
  it.each(labels)('badge "%s" never touches a pip', (label) => {
    const shape = badgeShape(label);
    const grow = BADGE_OK_STROKE / 2;
    for (const [px, py] of pips) {
      if (shape.kind === 'diamond') {
        // Distance from a point to the diamond |x|+|y| <= a is at least (|x|+|y|-a)/√2.
        const gap = (Math.abs(px) + Math.abs(py) - (shape.half + grow)) / Math.SQRT2;
        expect(gap).toBeGreaterThan(PIP_R);
      } else {
        const dx = Math.max(Math.abs(px) - (shape.halfW + grow), 0);
        const dy = Math.max(Math.abs(py) - (shape.halfH + grow), 0);
        expect(Math.hypot(dx, dy)).toBeGreaterThan(PIP_R);
      }
    }
  });

  it('badges on neighbouring corners do not overlap', () => {
    const halfWidth = (l: string) => {
      const s = badgeShape(l);
      return (s.kind === 'pill' ? s.halfW : s.half) + BADGE_OK_STROKE / 2;
    };
    const widest = Math.max(...labels.filter((l) => [...l].length <= 6).map(halfWidth));
    expect(2 * widest).toBeLessThan(S);
  });
});

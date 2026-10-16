import { useId } from 'react';
import { PIP_OFFSET, PIP_R, S } from './geometry';

export { S };

const D = PIP_OFFSET;
const SPOTS: Record<string, [number, number]> = {
  TL: [-D, -D], TC: [0, -D], TR: [D, -D],
  ML: [-D, 0], C: [0, 0], MR: [D, 0],
  BL: [-D, D], BC: [0, D], BR: [D, D],
};
const LAYOUT: string[][] = [
  [],
  ['C'],
  ['TL', 'BR'],
  ['TL', 'C', 'BR'],
  ['TL', 'TR', 'BL', 'BR'],
  ['TL', 'TR', 'C', 'BL', 'BR'],
  ['TL', 'TR', 'ML', 'MR', 'BL', 'BR'],
  ['TL', 'TR', 'ML', 'C', 'MR', 'BL', 'BR'],
  ['TL', 'TC', 'TR', 'ML', 'MR', 'BL', 'BC', 'BR'],
  ['TL', 'TC', 'TR', 'ML', 'C', 'MR', 'BL', 'BC', 'BR'],
];

function Pips({ cx, cy, n, horizontal }: { cx: number; cy: number; n: number; horizontal: boolean }) {
  return (
    <>
      {(LAYOUT[n] ?? []).map((spot) => {
        const [dx, dy] = SPOTS[spot];
        // Rotate the pattern on horizontal dominoes so 6 reads as 2 rows of 3.
        const [x, y] = horizontal ? [dy, dx] : [dx, dy];
        return <circle key={spot} cx={cx + x} cy={cy + y} r={PIP_R} fill="var(--pip)" />;
      })}
    </>
  );
}

/** A domino whose top-left corner is at (x, y). `first` is the left/top half. */
export function DominoShape({
  x,
  y,
  horizontal,
  first,
  second,
  inset = 6,
  opacity,
  washFirst,
  washSecond,
}: {
  x: number;
  y: number;
  horizontal: boolean;
  first: number;
  second: number;
  inset?: number;
  opacity?: number;
  /** Faint tint per half (a CSS colour), showing which region it lies in. */
  washFirst?: string;
  washSecond?: string;
}) {
  const clipId = useId();
  const w = horizontal ? 2 * S : S;
  const h = horizontal ? S : 2 * S;
  const body = { x: x + inset, y: y + inset, width: w - 2 * inset, height: h - 2 * inset, rx: 16 };
  const washes = [
    { color: washFirst, x, y },
    { color: washSecond, x: horizontal ? x + S : x, y: horizontal ? y : y + S },
  ].filter((wsh) => wsh.color);
  return (
    <g opacity={opacity}>
      <rect {...body} fill="var(--domino-bg)" />
      {washes.length > 0 && (
        <>
          <clipPath id={clipId}>
            <rect {...body} />
          </clipPath>
          <g clipPath={`url(#${clipId})`} style={{ opacity: 'var(--wash-opacity)' }}>
            {washes.map((wsh, i) => (
              <rect key={i} x={wsh.x} y={wsh.y} width={S} height={S} fill={wsh.color} />
            ))}
          </g>
        </>
      )}
      <rect {...body} fill="none" stroke="var(--domino-border)" strokeWidth={5} />
      {horizontal ? (
        <line x1={x + S} y1={y + 20} x2={x + S} y2={y + S - 20} stroke="var(--domino-border)" strokeWidth={4} strokeLinecap="round" />
      ) : (
        <line x1={x + 20} y1={y + S} x2={x + S - 20} y2={y + S} stroke="var(--domino-border)" strokeWidth={4} strokeLinecap="round" />
      )}
      <Pips cx={x + S / 2} cy={y + S / 2} n={first} horizontal={horizontal} />
      <Pips cx={x + (horizontal ? 1.5 * S : S / 2)} cy={y + (horizontal ? S / 2 : 1.5 * S)} n={second} horizontal={horizontal} />
    </g>
  );
}

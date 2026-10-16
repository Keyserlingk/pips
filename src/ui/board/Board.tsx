import type React from 'react';
import type { Cell, Domino, Region } from '../../model/types';
import { type RegionStatus, constraintLabel, key } from '../../model/cells';
import { DominoShape, S } from './DominoShape';

export const PAD = 36;

export interface BoardDomino {
  id: string | number;
  a: Cell;
  b: Cell;
  pips: Domino;
  faded?: boolean;
}

interface Props {
  width: number;
  height: number;
  cells: Cell[];
  regions: Region[];
  dominoes?: BoardDomino[];
  status?: Record<string, RegionStatus>;
  showInactive?: boolean;
  selectedRegion?: string | null;
  highlight?: Set<string>;
  svgRef?: React.Ref<SVGSVGElement>;
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (e: React.PointerEvent<SVGSVGElement>) => void;
}

/** Board coordinates (in viewBox units) → cell, using the rendered size of the svg. */
export function cellAt(svg: SVGSVGElement | null, width: number, height: number, x: number, y: number): Cell | null {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const vw = width * S + 2 * PAD;
  const vh = height * S + 2 * PAD;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const ox = rect.left + (rect.width - vw * scale) / 2;
  const oy = rect.top + (rect.height - vh * scale) / 2;
  const c = Math.floor(((x - ox) / scale - PAD) / S);
  const r = Math.floor(((y - oy) / scale - PAD) / S);
  return r >= 0 && c >= 0 && r < height && c < width ? { r, c } : null;
}

export function cellPixels(svg: SVGSVGElement | null, width: number, height: number): number {
  if (!svg) return 60;
  const rect = svg.getBoundingClientRect();
  return S * Math.min(rect.width / (width * S + 2 * PAD), rect.height / (height * S + 2 * PAD));
}

const INSET = 8;

/** Dashed outline segments, drawn slightly inside the region. */
function outline(region: Region): [number, number, number, number][] {
  const set = new Set(region.cells.map(key));
  const has = (r: number, c: number) => set.has(`${r},${c}`);
  const segs: [number, number, number, number][] = [];
  const half = S / 2;
  for (const { r, c } of region.cells) {
    const cx = (c + 0.5) * S;
    const cy = (r + 0.5) * S;
    for (const [nx, ny] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      if (has(r + ny, c + nx)) continue;
      const tx = -ny;
      const ty = nx;
      const ext = (sgn: number) => {
        const side = has(r + ty * sgn, c + tx * sgn);
        const diag = has(r + ty * sgn + ny, c + tx * sgn + nx);
        return !side ? half - INSET : diag ? half + INSET : half;
      };
      const bx = cx + nx * (half - INSET);
      const by = cy + ny * (half - INSET);
      const e1 = ext(-1);
      const e2 = ext(1);
      segs.push([bx - tx * e1, by - ty * e1, bx + tx * e2, by + ty * e2]);
    }
  }
  return segs;
}

export function Board(props: Props) {
  const { width, height, cells, regions, dominoes = [], status = {}, highlight } = props;
  const active = new Set(cells.map(key));
  const regionOf = new Map<string, Region>();
  regions.forEach((reg) => reg.cells.forEach((c) => regionOf.set(key(c), reg)));
  const vw = width * S + 2 * PAD;
  const vh = height * S + 2 * PAD;

  const inactive: Cell[] = [];
  if (props.showInactive)
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) if (!active.has(`${r},${c}`)) inactive.push({ r, c });

  return (
    <svg
      ref={props.svgRef}
      className="board"
      viewBox={`${-PAD} ${-PAD} ${vw} ${vh}`}
      style={{ aspectRatio: `${vw} / ${vh}` }}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
    >
      {inactive.map(({ r, c }) => (
        <rect key={`i${r},${c}`} x={c * S + 5} y={r * S + 5} width={S - 10} height={S - 10} rx={12} className="cell-inactive" />
      ))}
      {cells.map((cell) => {
        const reg = regionOf.get(key(cell));
        return (
          <rect
            key={key(cell)}
            x={cell.c * S + 3}
            y={cell.r * S + 3}
            width={S - 6}
            height={S - 6}
            rx={12}
            fill={reg ? `var(--region-${reg.color}-fill)` : 'var(--cell-bg)'}
          />
        );
      })}
      {regions.map((reg) => (
        <g
          key={reg.id}
          stroke={`var(--region-${reg.color}-stroke)`}
          strokeWidth={reg.id === props.selectedRegion ? 7 : 4}
          strokeDasharray={reg.id === props.selectedRegion ? undefined : '11 9'}
          strokeLinecap="round"
        >
          {outline(reg).map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </g>
      ))}
      {highlight &&
        [...highlight].map((k) => {
          const [r, c] = k.split(',').map(Number);
          return <rect key={`h${k}`} x={c * S + 3} y={r * S + 3} width={S - 6} height={S - 6} rx={12} className="cell-highlight" />;
        })}
      {dominoes.map((d) => {
        const horizontal = d.a.r === d.b.r;
        const aFirst = horizontal ? d.a.c < d.b.c : d.a.r < d.b.r;
        const tl = aFirst ? d.a : d.b;
        return (
          <DominoShape
            key={d.id}
            x={tl.c * S}
            y={tl.r * S}
            horizontal={horizontal}
            first={aFirst ? d.pips[0] : d.pips[1]}
            second={aFirst ? d.pips[1] : d.pips[0]}
            opacity={d.faded ? 0.55 : undefined}
          />
        );
      })}
      {regions.map((reg) => {
        const label = constraintLabel(reg.constraint);
        if (!label || !reg.cells.length) return null;
        const anchor = reg.cells.reduce((m, c) => (c.r > m.r || (c.r === m.r && c.c > m.c) ? c : m));
        const cx = (anchor.c + 1) * S - 22;
        const cy = (anchor.r + 1) * S - 8;
        const st = status[reg.id];
        const h = label.length > 2 ? 36 : 30;
        return (
          <g key={`b${reg.id}`} className="badge" pointerEvents="none">
            <polygon
              points={`${cx},${cy - h} ${cx + h},${cy} ${cx},${cy + h} ${cx - h},${cy}`}
              strokeLinejoin="round"
              fill={st === 'bad' ? 'var(--bad)' : `var(--region-${reg.color}-stroke)`}
              stroke={st === 'ok' ? 'var(--ok)' : 'var(--surface)'}
              strokeWidth={st === 'ok' ? 7 : 4}
            />
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={label.length > 2 ? 22 : label.length > 1 ? 26 : 32} fontWeight={800} fill="#fff">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

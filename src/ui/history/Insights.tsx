import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty } from '../../model/types';
import { loadHistory } from '../../model/storage';
import { dailyStreak, dailyTotals, hourCounts, levelStats, rollingAverage, since, solveTimes } from '../../model/insights';
import { PLAYABLE_LEVELS, levelClass, levelLabel } from '../../model/levels';
import { formatDay } from '../../model/daily';
import { duration } from '../../model/result';
import { Tabs } from './History';

/*
 * Insights: charts of the solved-games history. The charts are plain SVG drawn at the
 * width they get (so text stays readable on phones), one series in the theme's accent.
 */

const DAY = 86_400_000;
const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const midnight = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

const RANGES = [
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: 'Year', days: 365 },
  { id: 'all', label: 'All', days: null },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

// ------------------------------------------------------------------ chart

interface Mark {
  x: number;
  y: number;
  /** Tooltip lines: the first is the value (shown strong), the rest describe it. */
  tip: string[];
  /** Drawn lighter (e.g. a day with only some daily puzzles solved). */
  faint?: boolean;
}

interface ChartProps {
  kind: 'dots' | 'bars';
  marks: Mark[];
  /** A trend line through the marks (dots only), one y per mark. */
  trend?: number[];
  xDomain: [number, number];
  xTicks: (width: number) => { x: number; label: string }[];
  /** Bar width in x units. */
  band?: number;
  yFormat: (v: number) => string;
  /** Tick steps to choose from for the y axis, smallest first. */
  ySteps: number[];
  label: string;
}

const H = 220;
const M = { top: 12, right: 12, bottom: 26, left: 44 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceStep(max: number, steps: number[], ticks = 4) {
  return steps.find((s) => max / s <= ticks) ?? steps[steps.length - 1] * Math.ceil(max / ticks / steps[steps.length - 1]);
}

function Chart({ kind, marks, trend, xDomain, xTicks, band = 0, yFormat, ySteps, label }: ChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = H - M.top - M.bottom;

  const maxY = Math.max(1, ...marks.map((m) => m.y), ...(trend ?? []));
  const step = niceStep(maxY, ySteps);
  const top = Math.ceil(maxY / step) * step;
  const [x0, x1] = xDomain;
  const sx = (x: number) => M.left + (x1 === x0 ? plotW / 2 : ((x - x0) / (x1 - x0)) * plotW);
  const sy = (y: number) => M.top + plotH - (y / top) * plotH;
  const barW = Math.min(18, Math.max(3, (band / (x1 - x0 || 1)) * plotW - 2));

  const nearest = (clientX: number, el: SVGSVGElement) => {
    if (!marks.length) return null;
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < marks.length; i++) if (Math.abs(sx(marks[i].x) - px) < Math.abs(sx(marks[best].x) - px)) best = i;
    return best;
  };

  const yTicks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) yTicks.push(v);
  const h = hover === null ? null : marks[hover];
  const tipLeft = h ? Math.min(Math.max(sx(h.x), 70), width - 70) : 0;

  return (
    <div className="chart" ref={wrapRef}>
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget))}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const d = e.key === 'ArrowLeft' ? -1 : 1;
            setHover((i) => Math.min(marks.length - 1, Math.max(0, i === null ? (d > 0 ? 0 : marks.length - 1) : i + d)));
          }}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={M.left} x2={M.left + plotW} y1={sy(v)} y2={sy(v)} />
              <text className="chart-tick" x={M.left - 6} y={sy(v)} dy="0.32em" textAnchor="end">
                {yFormat(v)}
              </text>
            </g>
          ))}
          {xTicks(plotW).map((t) => (
            // Labels at the ends are kept inside the chart.
            <text
              key={t.x}
              className="chart-tick"
              x={sx(t.x)}
              y={H - 6}
              textAnchor={sx(t.x) < M.left + 24 ? 'start' : sx(t.x) > M.left + plotW - 24 ? 'end' : 'middle'}
            >
              {t.label}
            </text>
          ))}
          {h && kind === 'dots' && <line className="chart-crosshair" x1={sx(h.x)} x2={sx(h.x)} y1={M.top} y2={M.top + plotH} />}
          {kind === 'bars' &&
            marks.map((m, i) => {
              const bh = Math.max(0, sy(0) - sy(m.y));
              const r = Math.min(4, barW / 2, bh);
              const x = sx(m.x) - barW / 2;
              const y = sy(m.y);
              // Rounded top, square foot on the baseline.
              const d = `M${x},${y + bh}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${y + bh}Z`;
              return <path key={i} className={`chart-bar${m.faint ? ' faint' : ''}${hover === i ? ' on' : ''}`} d={d} />;
            })}
          {kind === 'dots' && trend && trend.length > 1 && (
            <polyline className="chart-trend" points={marks.map((m, i) => `${sx(m.x)},${sy(trend[i])}`).join(' ')} />
          )}
          {kind === 'dots' &&
            marks.map((m, i) => <circle key={i} className={`chart-dot${hover === i ? ' on' : ''}`} cx={sx(m.x)} cy={sy(m.y)} r={hover === i ? 5.5 : 4} />)}
          <line className="chart-axis" x1={M.left} x2={M.left + plotW} y1={sy(0)} y2={sy(0)} />
        </svg>
      )}
      {h && (
        <div className="chart-tip" style={{ left: tipLeft, top: Math.max(0, sy(h.y) - 12) }}>
          <strong>{h.tip[0]}</strong>
          {h.tip.slice(1).map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Date ticks across a time domain, spaced to fit the width. */
const timeTicks =
  ([from, to]: [number, number]) =>
  (width: number) => {
    const n = Math.max(2, Math.min(6, Math.floor(width / 80)));
    const span = Math.max(DAY, to - from);
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(from + (span * i) / (n - 1));
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (!out.some((t) => t.x === x)) out.push({ x, label: shortDate(x) });
    }
    return out;
  };

const SECOND_STEPS = [10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200];
const COUNT_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500];

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="chart-table">
      <summary>Show as table</summary>
      <div className="chart-table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Legend({ items }: { items: { kind: 'dot' | 'line' | 'bar' | 'bar faint'; label: string }[] }) {
  return (
    <div className="chart-legend muted small">
      {items.map((i) => (
        <span key={i.label}>
          <i className={`key ${i.kind}`} aria-hidden /> {i.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- page

export function InsightsPage({ go }: { go: (h: string) => void }) {
  const all = useMemo(loadHistory, []);
  const [range, setRange] = useState<RangeId>('90');
  const [level, setLevel] = useState<Difficulty>('easy');
  const [dailyOnly, setDailyOnly] = useState(false);

  const now = Date.now();
  const days = RANGES.find((r) => r.id === range)!.days;
  const from = days === null ? null : now - days * DAY;
  const history = since(all, from);
  const domainStart = from ?? Math.min(now - 7 * DAY, ...history.map((e) => e.solvedAt));
  const domain: [number, number] = [domainStart, now];

  const solves = solveTimes(history, level, dailyOnly);
  const trend = rollingAverage(solves.map((s) => s.seconds));
  const totals = dailyTotals(all).filter((d) => from === null || midnight(d.date) >= from - DAY);
  const hours = hourCounts(history);
  const stats = levelStats(history);
  const streak = dailyStreak(all);
  const played = history.reduce((a, e) => a + e.elapsed, 0);
  const fullDays = totals.filter((d) => d.complete).length;

  if (!all.length)
    return (
      <div className="history">
        <Tabs tab="insights" go={go} />
        <p className="muted center">Solve some puzzles and your statistics show up here.</p>
      </div>
    );

  return (
    <div className="history insights">
      <Tabs tab="insights" go={go} />
      <div className="seg insights-range" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="stat-tiles">
        <div className="panel stat">
          <span className="muted small">Solved</span>
          <strong>{history.length}</strong>
        </div>
        <div className="panel stat">
          <span className="muted small">Time played</span>
          <strong>{played >= 3600 ? `${Math.floor(played / 3600)} h ${Math.floor((played % 3600) / 60)} min` : duration(played)}</strong>
        </div>
        <div className="panel stat">
          <span className="muted small">Daily streak</span>
          <strong>
            {streak} {streak === 1 ? 'day' : 'days'}
          </strong>
        </div>
        <div className="panel stat">
          <span className="muted small">Days with all {PLAYABLE_LEVELS.length}</span>
          <strong>{fullDays}</strong>
        </div>
      </div>

      <section className="panel">
        <h3>Time to solve</h3>
        <div className="row insights-controls">
          <div className="seg" role="group" aria-label="Level">
            {PLAYABLE_LEVELS.map((l) => (
              <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                {levelLabel(l)}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={dailyOnly} onChange={(e) => setDailyOnly(e.target.checked)} />
            Daily puzzles only
          </label>
        </div>
        {solves.length === 0 ? (
          <p className="muted small">No {levelLabel(level)} puzzles solved in this time.</p>
        ) : (
          <>
            <Legend
              items={[
                { kind: 'dot', label: 'Each solve' },
                { kind: 'line', label: 'Average of the last 5' },
              ]}
            />
            <Chart
              kind="dots"
              label={`Time to solve ${levelLabel(level)} puzzles over time`}
              marks={solves.map((s, i) => ({
                x: s.at,
                y: s.seconds,
                tip: [formatTime(s.seconds), `${shortDate(s.at)} · ${s.title}`, `Average: ${formatTime(trend[i])}`],
              }))}
              trend={trend}
              xDomain={domain}
              xTicks={timeTicks(domain)}
              yFormat={formatTime}
              ySteps={SECOND_STEPS}
            />
            <DataTable
              head={['Solved', 'Puzzle', 'Time', 'Average of last 5']}
              rows={solves.map((s, i) => [shortDate(s.at), s.title, formatTime(s.seconds), formatTime(trend[i])]).reverse()}
            />
          </>
        )}
      </section>

      <section className="panel">
        <h3>Daily puzzles: total time per day</h3>
        {totals.length === 0 ? (
          <p className="muted small">No daily puzzles solved in this time.</p>
        ) : (
          <>
            <Legend
              items={[
                { kind: 'bar', label: `All ${PLAYABLE_LEVELS.length} solved` },
                { kind: 'bar faint', label: 'Some solved' },
              ]}
            />
            <Chart
              kind="bars"
              label="Total time on each day's daily puzzles"
              marks={totals.map((d) => ({
                x: midnight(d.date),
                y: d.total,
                faint: !d.complete,
                tip: [
                  formatTime(d.total),
                  `${formatDay(d.date)} · ${Object.keys(d.levels).length}/${PLAYABLE_LEVELS.length} solved`,
                  PLAYABLE_LEVELS.filter((l) => d.levels[l] !== undefined)
                    .map((l) => `${levelLabel(l)} ${formatTime(d.levels[l]!)}`)
                    .join(' · '),
                ],
              }))}
              band={DAY}
              xDomain={[Math.min(domain[0], midnight(totals[0].date)) - DAY / 2, now]}
              xTicks={timeTicks([Math.min(domain[0], midnight(totals[0].date)), now])}
              yFormat={formatTime}
              ySteps={SECOND_STEPS}
            />
            <DataTable
              head={['Day', ...PLAYABLE_LEVELS.map(levelLabel), 'Total']}
              rows={[...totals]
                .reverse()
                .map((d) => [formatDay(d.date), ...PLAYABLE_LEVELS.map((l) => (d.levels[l] === undefined ? '–' : formatTime(d.levels[l]!))), formatTime(d.total)])}
            />
          </>
        )}
      </section>

      <section className="panel">
        <h3>When you play</h3>
        <p className="muted small chart-note">Puzzles solved in each hour of the day.</p>
        <Chart
          kind="bars"
          label="Puzzles solved by hour of the day"
          marks={hours.map((n, hr) => ({ x: hr, y: n, tip: [`${n} solved`, `${String(hr).padStart(2, '0')}:00–${String(hr + 1).padStart(2, '0')}:00`] }))}
          band={1}
          xDomain={[-0.5, 23.5]}
          xTicks={() => [0, 6, 12, 18, 23].map((x) => ({ x, label: `${String(x).padStart(2, '0')}:00` }))}
          yFormat={(v) => String(v)}
          ySteps={COUNT_STEPS}
        />
        <DataTable head={['Hour', 'Solved']} rows={hours.map((n, hr) => [`${String(hr).padStart(2, '0')}:00`, n])} />
      </section>

      <section className="panel">
        <h3>By level</h3>
        <table className="level-stats">
          <thead>
            <tr>
              <th>Level</th>
              <th>Solved</th>
              <th>Best</th>
              <th>Average</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.level}>
                <td>
                  <span className={`pill ${levelClass(s.level)}`}>{levelLabel(s.level)}</span>
                </td>
                <td>{s.count}</td>
                <td>{s.best === null ? '–' : formatTime(s.best)}</td>
                <td>{s.average === null ? '–' : formatTime(s.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

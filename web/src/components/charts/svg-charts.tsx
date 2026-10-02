"use client";

import { linePath, niceMax, scaleLinear, stepPath, ticks } from "@/lib/charts";

const W = 640;
const H = 280;
const M = { top: 16, right: 16, bottom: 32, left: 40 };

const css = {
  grid: "stroke-border",
  axis: "fill-muted-foreground text-[11px]",
};

export interface BurnPoint { at: number; scope: number; remaining: number }

/** Burndown: remaining work as a step line, total scope as a dashed step line, ideal as a straight line. */
export function BurndownChart({ points, ideal, start, end, now }: {
  /** Current time (ms), passed in so renders stay pure. */
  now: number;
  points: BurnPoint[];
  ideal: { at: number; remaining: number }[];
  start: number;
  end: number;
}) {
  const max = niceMax(Math.max(1, ...points.flatMap((p) => [p.scope, p.remaining]), ...ideal.map((p) => p.remaining)));
  const x = scaleLinear([start, Math.max(end, start + 1)], [M.left, W - M.right]);
  const y = scaleLinear([0, max], [H - M.bottom, M.top]);
  const remaining = points.map((p) => ({ x: x(p.at), y: y(p.remaining) }));
  const scope = points.map((p) => ({ x: x(p.at), y: y(p.scope) }));
  const idealLine = ideal.map((p) => ({ x: x(p.at), y: y(p.remaining) }));
  const lastX = Math.min(x(Math.min(now, end)), W - M.right);
  const dayMs = 24 * 60 * 60 * 1000;
  const tickCount = Math.min(8, Math.max(1, Math.round((end - start) / dayMs)));
  const xTicks: number[] = [];
  for (let i = 0; i <= tickCount; i++) xTicks.push(start + ((end - start) * i) / tickCount);

  return (
    <svg role="img" aria-label="Burndown chart" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks(max).map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className={css.grid} />
          <text x={M.left - 6} y={y(t) + 4} textAnchor="end" className={css.axis}>{t}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} x={x(t)} y={H - 10} textAnchor="middle" className={css.axis}>
          {new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
        </text>
      ))}
      {idealLine.length > 0 && <path d={linePath(idealLine)} fill="none" strokeWidth={1.5} strokeDasharray="4 4" className="stroke-muted-foreground" data-series="ideal" />}
      {scope.length > 0 && <path d={stepPath(scope, lastX)} fill="none" strokeWidth={1.5} strokeDasharray="2 3" className="stroke-primary/60" data-series="scope" />}
      {remaining.length > 0 && <path d={stepPath(remaining, lastX)} fill="none" strokeWidth={2.5} className="stroke-primary" data-series="remaining" />}
      {remaining.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} className="fill-primary" />)}
    </svg>
  );
}

export interface BarGroup { label: string; values: { name: string; value: number; className: string }[] }

/** Grouped bar chart (velocity, throughput). */
export function BarChart({ groups, label }: { groups: BarGroup[]; label: string }) {
  const max = niceMax(Math.max(1, ...groups.flatMap((g) => g.values.map((v) => v.value))));
  const y = scaleLinear([0, max], [H - M.bottom, M.top]);
  const slot = (W - M.left - M.right) / Math.max(1, groups.length);
  const series = groups[0]?.values.length ?? 1;
  const barW = Math.min(36, (slot * 0.7) / series);

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks(max).map((t) => (
        <g key={t}>
          <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} className={css.grid} />
          <text x={M.left - 6} y={y(t) + 4} textAnchor="end" className={css.axis}>{t}</text>
        </g>
      ))}
      {groups.map((g, gi) => {
        const cx = M.left + slot * gi + slot / 2;
        return (
          <g key={g.label}>
            {g.values.map((v, vi) => {
              const bx = cx - (barW * series) / 2 + barW * vi;
              return (
                <g key={v.name}>
                  <rect x={bx} y={y(v.value)} width={barW - 2} height={Math.max(0, H - M.bottom - y(v.value))} className={v.className} rx={2}>
                    <title>{`${g.label} · ${v.name}: ${v.value}`}</title>
                  </rect>
                </g>
              );
            })}
            <text x={cx} y={H - 10} textAnchor="middle" className={css.axis}>{g.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${i.className}`} />{i.label}
        </li>
      ))}
    </ul>
  );
}

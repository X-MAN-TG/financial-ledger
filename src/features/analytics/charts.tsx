/**
 * Chart building blocks (10 section 3).
 *
 * Every chart here answers a question the user would act on. Restrained
 * palette drawn from theme tokens, no 3D, no neon, no gratuitous gradient
 * fills, minimal axes, tooltips that read like a statement line.
 */
import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalyticsDailyPoint } from '../../../shared/types';
import { formatCompact, formatDateShort, formatMoney } from '../../lib/format';

/** Reads a CSS variable so Recharts (which needs real colours) stays themed. */
function useToken(name: string, fallback: string): string {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const read = () =>
      setValue(
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback,
      );
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, [name, fallback]);
  return value;
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>;
  label?: string;
  currency?: 'INR' | 'USDT' | 'RUB' | 'EXTRAS';
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card shadow-e3 px-3 py-2.5 text-[12px]" style={{ minWidth: 130 }}>
      <p className="font-semibold text-[var(--text-1)] mb-1.5">
        {label ? formatDateShort(String(label)) : ''}
      </p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-[var(--text-3)]">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="num font-medium text-[var(--text-1)]">
            {currency ? formatMoney(p.value ?? 0, currency) : (p.value ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

const axisProps = (color: string) => ({
  stroke: color,
  tick: { fontSize: 11, fill: color },
  tickLine: false,
  axisLine: false,
});

/** Daily transaction volume with a 7-day rolling average overlay (10 s3). */
export function VolumeChart({ data, height = 200 }: { data: AnalyticsDailyPoint[]; height?: number }) {
  const accent = useToken('--accent', '#56a8e8');
  const grid = useToken('--border', '#1e3250');
  const muted = useToken('--text-3', '#7688a0');

  const withAvg = data.map((d, i) => {
    const window = data.slice(Math.max(0, i - 6), i + 1).filter((x) => !x.isDayOff);
    const avg = window.length ? window.reduce((s, x) => s + x.count, 0) / window.length : 0;
    return { ...d, rolling: Math.round(avg * 10) / 10 };
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={withAvg} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={formatDateShort} {...axisProps(muted)} minTickGap={18} />
        <YAxis allowDecimals={false} {...axisProps(muted)} width={34} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey="count" name="Transactions" fill={accent} radius={[3, 3, 0, 0]} maxBarSize={26} />
        <Line
          type="monotone"
          dataKey="rolling"
          name="7-day average"
          stroke={muted}
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="4 3"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Extras trend - the profitability signal, so it gets its own chart. */
export function ExtrasTrend({ data, height = 190 }: { data: AnalyticsDailyPoint[]; height?: number }) {
  const success = useToken('--success', '#43bf92');
  const grid = useToken('--border', '#1e3250');
  const muted = useToken('--text-3', '#7688a0');

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="extrasFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={success} stopOpacity={0.18} />
            <stop offset="100%" stopColor={success} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={formatDateShort} {...axisProps(muted)} minTickGap={18} />
        <YAxis tickFormatter={(v) => formatCompact(v, 'EXTRAS')} {...axisProps(muted)} width={64} />
        <Tooltip content={<ChartTooltip currency="EXTRAS" />} cursor={{ stroke: grid }} />
        <Area
          type="monotone"
          dataKey="extras"
          name="Extras"
          stroke={success}
          strokeWidth={2}
          fill="url(#extrasFill)"
          dot={false}
          activeDot={{ r: 3.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Currency movement: three series, no conversion, no implied FX rate. */
export function CurrencyChart({ data, height = 200 }: { data: AnalyticsDailyPoint[]; height?: number }) {
  const accent = useToken('--accent', '#56a8e8');
  const success = useToken('--success', '#43bf92');
  const warning = useToken('--warning', '#d9a84f');
  const grid = useToken('--border', '#1e3250');
  const muted = useToken('--text-3', '#7688a0');

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={grid} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={formatDateShort} {...axisProps(muted)} minTickGap={18} />
        <YAxis tickFormatter={(v) => formatCompact(v, 'INR')} {...axisProps(muted)} width={64} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: grid }} />
        <Area type="monotone" dataKey="inr" name="INR" stroke={accent} fill="transparent" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="usdt" name="USDT" stroke={success} fill="transparent" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="rub" name="RUB" stroke={warning} fill="transparent" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Activity calendar. Day Off cells are visually distinct rather than just
 * empty, so the rhythm of the month reads honestly (10 s4.5).
 */
export function ActivityCalendar({ data }: { data: AnalyticsDailyPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const byDate = new Map(data.map((d) => [d.date, d]));
  if (data.length === 0) return null;

  // Pad to whole weeks starting Sunday.
  const first = new Date(`${data[0].date}T00:00:00`);
  const lead = first.getDay();
  const cells: Array<AnalyticsDailyPoint | null> = [
    ...Array.from({ length: lead }, () => null),
    ...data.map((d) => byDate.get(d.date) ?? null),
  ];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="text-[10px] text-center text-[var(--text-3)] font-medium">
            {d}
          </span>
        ))}
        {cells.map((cell, i) =>
          cell === null ? (
            <span key={i} />
          ) : (
            <span
              key={cell.date}
              title={`${cell.date} · ${cell.isDayOff ? 'Day Off' : `${cell.count} transactions`}`}
              className="aspect-square rounded-[5px] grid place-items-center text-[10px] font-medium transition-colors"
              style={
                cell.isDayOff
                  ? {
                      background: 'transparent',
                      border: '1px dashed var(--border-strong)',
                      color: 'var(--text-3)',
                    }
                  : {
                      background:
                        cell.count === 0
                          ? 'var(--surface-2)'
                          : `color-mix(in srgb, var(--accent) ${Math.round((cell.count / max) * 85) + 15}%, var(--surface-2))`,
                      color: cell.count / max > 0.55 ? 'var(--accent-fg)' : 'var(--text-3)',
                    }
              }
            >
              {Number(cell.date.slice(8, 10))}
            </span>
          ),
        )}
      </div>
      <div className="flex items-center gap-3 mt-3 text-[10.5px] text-[var(--text-3)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--surface-2)' }} />
          None
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--accent)' }} />
          Busiest
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed" style={{ borderColor: 'var(--border-strong)' }} />
          Day off
        </span>
      </div>
    </div>
  );
}

/** Completion split as a single honest progress bar, not a donut. */
export function CompletionBar({
  completed,
  pending,
}: {
  completed: number;
  pending: number;
}) {
  const total = completed + pending;
  const pct = total > 0 ? (completed / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="num text-[24px] font-semibold text-[var(--text-1)] leading-none">
          {Math.round(pct)}%
        </span>
        <span className="text-[12px] text-[var(--text-3)]">
          <span className="num font-medium text-[var(--text-2)]">{completed}</span> of{' '}
          <span className="num">{total}</span> completed
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--surface-3)' }}>
        <div
          className="h-full transition-[width] duration-500 ease-standard"
          style={{ width: `${pct}%`, background: 'var(--success)' }}
        />
      </div>
      <div className="flex items-center gap-4 mt-2.5 text-[11.5px]">
        <span className="flex items-center gap-1.5 text-[var(--text-3)]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} />
          Completed {completed}
        </span>
        <span className="flex items-center gap-1.5 text-[var(--text-3)]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--surface-3)' }} />
          Pending {pending}
        </span>
      </div>
    </div>
  );
}

/** Ranked horizontal list - clearer than a pie for "top N" (10 s3). */
export function RankedBars({
  items,
  valueFormat,
  onSelect,
  emptyLabel = 'No data yet',
}: {
  items: Array<{ id?: string; label: string; value: number; sub?: string }>;
  valueFormat: (v: number) => string;
  onSelect?: (id: string) => void;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-[13px] text-[var(--text-3)] py-6 text-center">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-[13px] text-[var(--text-1)] truncate">
                {item.label}
                {item.sub && <span className="text-[11.5px] text-[var(--text-3)] ml-1.5">{item.sub}</span>}
              </span>
              <span className="num text-[12.5px] font-medium text-[var(--text-2)] shrink-0">
                {valueFormat(item.value)}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-standard"
                style={{
                  width: `${(item.value / max) * 100}%`,
                  background: i === 0 ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 55%, transparent)',
                }}
              />
            </div>
          </>
        );
        return item.id && onSelect ? (
          <button
            key={item.id ?? i}
            type="button"
            onClick={() => onSelect(item.id as string)}
            className="w-full text-left rounded-md -mx-1.5 px-1.5 py-1 hover:bg-[var(--surface-2)] transition-colors"
          >
            {inner}
          </button>
        ) : (
          <div key={item.id ?? i} className="py-1">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

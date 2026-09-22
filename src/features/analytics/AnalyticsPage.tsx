/**
 * Analytics (10-analytics-specification.txt).
 *
 * All aggregation happens in SQL on the Worker; the client only renders
 * small pre-aggregated payloads (10 s4.2). Responses are cached with
 * TanStack Query and revalidated on an interval rather than per render
 * (10 s4.3).
 */
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  AnalyticsAllTime,
  AnalyticsMonthly,
  AnalyticsToday,
  AnalyticsWindow,
} from '../../../shared/types';
import { Page } from '../../components/AppShell';
import { Badge, Card, EmptyState, SectionTitle, Skeleton } from '../../components/ui/primitives';
import { apiGet } from '../../lib/api';
import { cn } from '../../lib/cn';
import { StatCard, ChartCard } from '../../components/ui/shell-primitives';
import {
  IcCoins,
  IcWallet,
  IcTrend,
  IcCheckCircle,
  IcClock,
  IcLedger,
} from '../../components/ui/icons';
import {
  formatDateMedium,
  formatDelta,
  formatMoney,
  formatNumber,
} from '../../lib/format';
import {
  ActivityCalendar,
  CompletionBar,
  CurrencyChart,
  ExtrasTrend,
  RankedBars,
  VolumeChart,
} from './charts';

type Range = 'today' | '7d' | '30d' | 'monthly' | 'all-time';

const RANGES: Array<{ id: Range; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'all-time', label: 'All time' },
];

const STALE = 60_000;

export function AnalyticsPage() {
  const [range, setRange] = useState<Range>('7d');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  return (
    <Page title="Analytics" subtitle="Your trading activity, measured.">
      <div className="flex gap-1 p-1 rounded-md bg-[var(--surface-2)] border border-[var(--border)] mb-4 overflow-x-auto no-scrollbar">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={(e) => {
              setRange(r.id);
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            className={cn(
              'h-9 px-3.5 rounded text-[12.5px] font-medium transition-colors whitespace-nowrap shrink-0',
              range === r.id
                ? 'bg-[var(--surface-1)] text-[var(--text-1)] shadow-e1'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === 'today' && <TodayView />}
      {range === '7d' && <WindowView key="7d" path="/api/analytics/7d" label="Last 7 days" />}
      {range === '30d' && <WindowView key="30d" path="/api/analytics/30d" label="Last 30 days" />}
      {range === 'monthly' && <MonthlyView month={month} onMonthChange={setMonth} />}
      {range === 'all-time' && <AllTimeView />}
    </Page>
  );
}

/* --------------------------------------------------------------- tiles ---- */

/**
 * Analytics tiles are the same object as the dashboard's stat cards, so this
 * is a thin adapter over the shared StatCard rather than a second card recipe
 * (brief 4.5: one card system across the app).
 */
function Metric({
  label,
  value,
  sub,
  delta,
  emphasis,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  emphasis?: boolean;
  icon?: ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'info' | 'neutral';
}) {
  return (
    <StatCard
      label={label}
      value={value}
      caption={sub}
      delta={delta}
      icon={icon}
      tone={tone ?? 'accent'}
      hero={emphasis}
    />
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-6 w-24 mt-3" />
            <Skeleton className="h-2.5 w-16 mt-2.5" />
          </Card>
        ))}
      </div>
      <Card>
        <Skeleton className="h-3 w-32 mb-4" />
        <Skeleton className="h-[200px] w-full" />
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- today ---- */

function TodayView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'today'],
    queryFn: () => apiGet<AnalyticsToday>('/api/analytics/today'),
    staleTime: STALE,
  });

  if (isLoading) return <LoadingGrid />;
  if (error || !data) return <Card><EmptyState title="Analytics unavailable" description="Could not load today's figures." /></Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-[var(--text-1)]">
          {formatDateMedium(data.date)}
        </h2>
        {data.dayStatus === 'DAY_OFF' && <Badge tone="warning">Day Off</Badge>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="INR" value={formatMoney(data.totalInr, 'INR')} icon={<IcCoins size={15} />} emphasis />
        <Metric label="USDT" value={formatMoney(data.totalUsdt, 'USDT')} icon={<IcWallet size={15} />} emphasis />
        <Metric label="Final RUB" value={formatMoney(data.totalRub, 'RUB')} icon={<IcCoins size={15} />} tone="info" />
        <Metric label="Extras" value={formatMoney(data.totalExtras, 'EXTRAS')} icon={<IcTrend size={15} />} tone="success" />
      </div>

      <div className="grid lg:grid-cols-2 gap-3 items-start">
        <Card>
          <SectionTitle title="Completion" subtitle="Orders marked done today" />
          <CompletionBar completed={data.completedCount} pending={data.pendingCount} />
        </Card>
        <Card>
          <SectionTitle title="Activity" subtitle="Rows recorded today" />
          <p className="num text-[32px] font-semibold text-[var(--text-1)] leading-none">
            {formatNumber(data.transactionCount)}
          </p>
          <p className="text-[12.5px] text-[var(--text-3)] mt-2">
            transaction{data.transactionCount === 1 ? '' : 's'} recorded
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- 7d and 30d ---- */

function WindowView({ path, label }: { path: string; label: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', path],
    queryFn: () => apiGet<AnalyticsWindow>(path),
    staleTime: STALE,
  });

  if (isLoading) return <LoadingGrid />;
  if (error || !data) return <Card><EmptyState title="Analytics unavailable" description="Could not load this window." /></Card>;

  const hasActivity = data.transactionCount > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric
          label="Transactions"
          value={formatNumber(data.transactionCount)}
          icon={<IcLedger size={15} />}
          delta={data.previous?.countChangePct ?? null}
          sub={
            Number.isFinite(data.previous?.countChangePct ?? NaN)
              ? 'vs previous period'
              : 'no prior activity'
          }
          emphasis
        />
        <Metric
          label="Extras"
          value={formatMoney(data.totalExtras, 'EXTRAS')}
          icon={<IcTrend size={15} />}
          delta={data.previous?.extrasChangePct ?? null}
          sub={
            Number.isFinite(data.previous?.extrasChangePct ?? NaN)
              ? 'vs previous period'
              : 'no prior activity'
          }
          emphasis
        />
        <Metric label="INR volume" value={formatMoney(data.totalInr, 'INR')} icon={<IcCoins size={15} />} tone="info" sub={`${data.tradingDayCount} trading days`} />
        <Metric
          label="Avg / trading day"
          value={data.avgTransactionsPerTradingDay.toFixed(1)}
          icon={<IcClock size={15} />}
          tone="neutral"
          sub={data.dayOffCount > 0 ? `${data.dayOffCount} day${data.dayOffCount === 1 ? '' : 's'} off excluded` : 'transactions'}
        />
      </div>

      {!hasActivity ? (
        <Card>
          <EmptyState
            title="No activity in this period"
            description="Charts appear once you record transactions in this window."
          />
        </Card>
      ) : (
        <>
          <Card>
            <SectionTitle title="Daily volume" subtitle={`${label} · bars with a 7-day rolling average`} />
            <VolumeChart data={data.days} />
          </Card>

          <div className="grid lg:grid-cols-2 gap-3 items-start">
            <Card>
              <SectionTitle title="Extras trend" subtitle="Daily extras earned" />
              <ExtrasTrend data={data.days} />
            </Card>
            <Card>
              <SectionTitle title="Currency movement" subtitle="Daily totals, no conversion applied" />
              <CurrencyChart data={data.days} />
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-3 items-start">
            <Card>
              <SectionTitle title="Completion" subtitle="Across the whole period" />
              <CompletionBar completed={data.completedCount} pending={data.pendingCount} />
            </Card>
            <Card>
              <SectionTitle title="Activity calendar" subtitle="Shaded by transaction volume" />
              <ActivityCalendar data={data.days} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- monthly ---- */

function MonthlyView({ month, onMonthChange }: { month: string; onMonthChange: (m: string) => void }) {
  const [metric, setMetric] = useState<'extras' | 'volume'>('extras');
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'monthly', month],
    queryFn: () => apiGet<AnalyticsMonthly>(`/api/analytics/monthly?month=${month}`),
    staleTime: STALE,
  });

  const best = useMemo(() => {
    if (!data) return [];
    const src = metric === 'extras' ? data.bestDaysByExtras : data.bestDaysByVolume;
    return src.map((d) => ({ label: formatDateMedium(d.date), value: d.value }));
  }, [data, metric]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="month"
          value={month}
          max={new Date().toISOString().slice(0, 7)}
          onChange={(e) => e.target.value && onMonthChange(e.target.value)}
          aria-label="Select month"
          className="h-9 px-3 rounded-md bg-[var(--surface-1)] border border-[var(--border)] text-[13px] text-[var(--text-1)] focus:outline-none focus:border-[var(--accent)]"
        />
      </div>

      {isLoading ? (
        <LoadingGrid />
      ) : error || !data ? (
        <Card><EmptyState title="Analytics unavailable" description="Could not load this month." /></Card>
      ) : data.transactionCount === 0 ? (
        <Card>
          <EmptyState title="No activity this month" description="Choose another month or start recording transactions." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Transactions" value={formatNumber(data.transactionCount)} icon={<IcLedger size={15} />} emphasis />
            <Metric label="Extras" value={formatMoney(data.totalExtras, 'EXTRAS')} icon={<IcTrend size={15} />} emphasis />
            <Metric label="INR volume" value={formatMoney(data.totalInr, 'INR')} icon={<IcCoins size={15} />} tone="info" />
            <Metric label="Avg value" value={formatMoney(data.avgTransactionValueInr, 'INR')} icon={<IcCheckCircle size={15} />} tone="neutral" sub="per transaction" />
          </div>

          <Card>
            <SectionTitle title="Daily volume" subtitle="Transactions per day this month" />
            <VolumeChart data={data.days} />
          </Card>

          <div className="grid lg:grid-cols-2 gap-3 items-start">
            <Card>
              <SectionTitle
                title="Best performing days"
                action={
                  <div className="flex gap-1 p-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                    {(['extras', 'volume'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMetric(m)}
                        className={cn(
                          'h-7 px-2.5 rounded text-[11.5px] font-medium transition-colors',
                          metric === m ? 'bg-[var(--surface-1)] text-[var(--text-1)]' : 'text-[var(--text-3)]',
                        )}
                      >
                        {m === 'extras' ? 'Extras' : 'Volume'}
                      </button>
                    ))}
                  </div>
                }
              />
              <RankedBars
                items={best}
                valueFormat={(v) => (metric === 'extras' ? formatMoney(v, 'EXTRAS') : formatNumber(v))}
              />
            </Card>
            <Card>
              <SectionTitle title="Activity calendar" subtitle="Shaded by volume, days off marked" />
              <ActivityCalendar data={data.days} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ all time ---- */

function AllTimeView() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'all-time'],
    queryFn: () => apiGet<AnalyticsAllTime>('/api/analytics/all-time'),
    staleTime: STALE * 5,
  });

  if (isLoading) return <LoadingGrid />;
  if (error || !data) return <Card><EmptyState title="Analytics unavailable" description="Could not load your history." /></Card>;

  if (data.transactionCount === 0) {
    return (
      <Card>
        <EmptyState
          title="No history yet"
          description="All-time figures appear once you have recorded transactions."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-[var(--text-3)]">
        {data.firstDate ? `${formatDateMedium(data.firstDate)} — ${formatDateMedium(data.lastDate ?? data.firstDate)}` : ''}
        {' · '}
        {data.tradingDayCount} trading days, {data.dayOffCount} days off
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Transactions" value={formatNumber(data.transactionCount)} icon={<IcLedger size={15} />} emphasis />
        <Metric label="Total INR" value={formatMoney(data.totalInr, 'INR')} icon={<IcCoins size={15} />} emphasis />
        <Metric label="Total USDT" value={formatMoney(data.totalUsdt, 'USDT')} icon={<IcWallet size={15} />} tone="info" />
        <Metric label="Total Extras" value={formatMoney(data.totalExtras, 'EXTRAS')} icon={<IcTrend size={15} />} tone="success" />
      </div>

      <div className="grid lg:grid-cols-2 gap-3 items-start">
        <Card>
          <SectionTitle title="Completion rate" subtitle="Across your entire history" />
          <CompletionBar completed={data.completedCount} pending={data.pendingCount} />
          <p className="text-[12px] text-[var(--text-3)] mt-4 pt-3 border-t border-[var(--border)]">
            Average transaction value{' '}
            <span className="num font-medium text-[var(--text-2)]">
              {formatMoney(data.avgTransactionValueInr, 'INR')}
            </span>
          </p>
        </Card>

        <Card>
          <SectionTitle title="Most active days" subtitle="Top days by transaction count" />
          <RankedBars
            items={data.mostActiveDays.map((d) => ({ label: formatDateMedium(d.date), value: d.value }))}
            valueFormat={(v) => `${formatNumber(v)} txns`}
          />
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-3 items-start">
        <Card>
          <SectionTitle title="Top customers" subtitle="By transaction count" />
          <RankedBars
            items={data.topCustomers.map((c) => ({
              id: c.customerId ?? undefined,
              label: c.name,
              value: c.count,
              sub: formatMoney(c.extras, 'EXTRAS'),
            }))}
            valueFormat={(v) => `${formatNumber(v)} txns`}
            onSelect={(id) => navigate(`/customers/${id}`)}
            emptyLabel="No linked customers yet"
          />
        </Card>

        <Card>
          <SectionTitle title="Monthly trend" subtitle="Transactions per month" />
          <RankedBars
            items={data.monthly.slice(-8).reverse().map((m) => ({
              label: m.month,
              value: m.count,
              sub: formatMoney(m.extras, 'EXTRAS'),
            }))}
            valueFormat={(v) => formatNumber(v)}
          />
        </Card>
      </div>
    </div>
  );
}

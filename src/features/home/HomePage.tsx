/**
 * Dashboard / Home (brief 4.8).
 *
 * Reads only existing endpoints - no new API surface. Today's figures come
 * from the same Dexie-backed day the ledger renders, so the number here can
 * never disagree with the number on the ledger screen.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { computeTotals, localDateKey } from '../../../shared/business-rules';
import type { AnalyticsToday, LocalTransaction } from '../../../shared/types';
import { Page } from '../../components/AppShell';
import { ElevatedCard, NavCard, PillButton, StatCard, StatusBadge } from '../../components/ui/shell-primitives';
import { Skeleton } from '../../components/ui/primitives';
import {
  IcAnalytics,
  IcArrowDownLeft,
  IcCheckCircle,
  IcClock,
  IcCoins,
  IcLedger,
  IcTimeline,
  IcTrend,
} from '../../components/ui/icons';
import { useSession } from '../../hooks/use-session';
import { apiGet } from '../../lib/api';
import { formatDateLong, formatMoney, formatNumber } from '../../lib/format';
import { listDayRows } from '../../offline/ledger-repo';

export function HomePage() {
  const { db, user } = useSession();
  const navigate = useNavigate();
  const today = localDateKey();

  /* Today's numbers come from the local day so they match the ledger exactly. */
  const day = useLiveQuery(
    async () => (db ? ((await db.ledgerDays.where('date').equals(today).first()) ?? null) : null),
    [db, today],
  );
  const rows = useLiveQuery(
    async () => (db && day ? await listDayRows(db, day.id) : ([] as LocalTransaction[])),
    [db, day?.id],
    [] as LocalTransaction[],
  );

  const totals = useMemo(() => computeTotals(rows ?? []), [rows]);
  const isDayOff = day?.status === 'DAY_OFF';

  /* Lifetime context for the secondary tiles. */
  const { data: todayStats, isLoading } = useQuery({
    queryKey: ['analytics', 'today'],
    queryFn: () => apiGet<AnalyticsToday>('/api/analytics/today'),
    staleTime: 60_000,
  });

  const firstName = (user?.displayName ?? '').trim().split(/\s+/)[0] || 'there';

  return (
    <Page
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Dashboard' }]}
      eyebrow="Today's summary"
      title={`Welcome back, ${firstName}`}
      subtitle={formatDateLong(today)}
      actions={
        <PillButton variant="primary" icon={<IcLedger size={16} />} onClick={() => navigate('/ledger')}>
          Open today's ledger
        </PillButton>
      }
    >
      {/* ------------------------------------------------ headline tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          hero
          label="Extras today"
          value={formatMoney(totals.totalExtras, 'EXTRAS')}
          caption={isDayOff ? 'Marked as a day off' : `${totals.rowCount} row${totals.rowCount === 1 ? '' : 's'} recorded`}
          icon={<IcTrend size={15} />}
        />
        <StatCard
          label="INR received"
          value={formatMoney(totals.totalInr, 'INR')}
          caption="Today's inbound total"
          icon={<IcArrowDownLeft size={15} />}
          tone="info"
        />
        <StatCard
          label="USDT"
          value={formatMoney(totals.totalUsdt, 'USDT')}
          caption="Today's crypto leg"
          icon={<IcCoins size={15} />}
          tone="info"
        />
        <StatCard
          label="Completed"
          value={`${totals.completedCount} / ${totals.rowCount}`}
          caption={
            totals.pendingCount > 0
              ? `${totals.pendingCount} still pending`
              : totals.rowCount > 0
                ? 'All orders done'
                : 'Nothing recorded yet'
          }
          icon={<IcCheckCircle size={15} />}
          tone={totals.pendingCount > 0 ? 'warning' : 'success'}
        />
      </div>

      {/* ------------------------------------------------- today's totals */}
      <ElevatedCard tone="hero" className="mt-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-1)] leading-tight">
              Today's totals
            </h2>
            <p className="text-[12px] text-[var(--text-3)] mt-0.5">
              {isDayOff ? 'This day is marked as a day off.' : 'Live from your ledger, including unsynced edits.'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge tone="success" icon={<IcCheckCircle size={12} />}>
              {totals.completedCount} done
            </StatusBadge>
            {totals.pendingCount > 0 && (
              <StatusBadge tone="warning" icon={<IcClock size={12} />}>
                {totals.pendingCount} pending
              </StatusBadge>
            )}
            <StatusBadge tone="neutral">{totals.rowCount} total</StatusBadge>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 mt-4">
          <Money label="INR" value={formatMoney(totals.totalInr, 'INR')} />
          <Money label="USDT" value={formatMoney(totals.totalUsdt, 'USDT')} />
          <Money label="Final RUB" value={formatMoney(totals.totalRub, 'RUB')} />
          <Money label="Extras" value={formatMoney(totals.totalExtras, 'EXTRAS')} accent />
        </div>
      </ElevatedCard>

      {/* ------------------------------------------------------ shortcuts */}
      <h2 className="text-[13px] font-semibold text-[var(--text-2)] mt-6 mb-3 uppercase tracking-[0.06em]">
        Jump to
      </h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <NavCard
          to="/timeline"
          icon={<IcTimeline size={17} />}
          title="Timeline"
          description="Every day you've recorded"
        />
        <NavCard
          to="/analytics"
          icon={<IcAnalytics size={17} />}
          title="Analytics"
          description="Trends across your history"
          tone="success"
        />
        <NavCard
          to="/customers"
          icon={<IcCoins size={17} />}
          title="Customers"
          description="Who you trade with most"
          tone="info"
        />
      </div>

      {/* --------------------------------------------------- lifetime bar */}
      <div className="mt-4">
        {isLoading ? (
          <ElevatedCard>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-5 w-44 mt-3" />
          </ElevatedCard>
        ) : todayStats ? (
          <ElevatedCard>
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">
              Server view of today
            </p>
            <p className="text-[13px] text-[var(--text-2)] mt-2">
              {formatNumber(todayStats.transactionCount)} transaction
              {todayStats.transactionCount === 1 ? '' : 's'} recorded ·{' '}
              {todayStats.completionPct.toFixed(0)}% complete ·{' '}
              {todayStats.dayStatus === 'DAY_OFF' ? 'day off' : 'trading day'}
            </p>
          </ElevatedCard>
        ) : null}
      </div>
    </Page>
  );
}

function Money({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
        {label}
      </p>
      <p
        className="num mt-2 text-[19px] font-semibold leading-none truncate"
        style={{ color: accent ? 'var(--success)' : 'var(--text-1)' }}
      >
        {value}
      </p>
    </div>
  );
}

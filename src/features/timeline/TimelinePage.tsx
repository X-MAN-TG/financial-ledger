/**
 * Timeline (09-timeline-search-and-filters.txt).
 *
 * Reverse-chronological ledger days with server-side pagination and the
 * full combinable filter set (date range, customer, completion status,
 * amount range on a selectable field, free text). Every filter is a query
 * parameter on GET /api/timeline and is re-scoped to the session user
 * server-side regardless of what we send (09 s3).
 *
 * Offline (09 s6): falls back to whatever Dexie already has, clearly
 * labelled as a partial local view - never an error.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { computeTotals } from '../../../shared/business-rules';
import type { Customer, ListResponse, TimelineDayItem } from '../../../shared/types';
import { Page } from '../../components/AppShell';
import { Badge, Button, Card, EmptyState, Input, Label, Skeleton } from '../../components/ui/primitives';
import { ApiError, apiGet } from '../../lib/api';
import { useSession } from '../../hooks/use-session';
import { formatDateMedium, formatMoney, formatWeekday } from '../../lib/format';
import { cn } from '../../lib/cn';

type StatusFilter = 'ANY' | 'COMPLETED' | 'PENDING' | 'INCOMPLETE' | 'READY';
type AmountField = 'inr' | 'usdt' | 'rub' | 'extras';

interface Filters {
  from: string;
  to: string;
  customerId: string;
  status: StatusFilter;
  amountField: AmountField;
  minAmount: string;
  maxAmount: string;
  q: string;
}

const EMPTY_FILTERS: Filters = {
  from: '',
  to: '',
  customerId: '',
  status: 'ANY',
  amountField: 'inr',
  minAmount: '',
  maxAmount: '',
  q: '',
};

export function TimelinePage() {
  const navigate = useNavigate();
  const { db } = useSession();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [items, setItems] = useState<TimelineDayItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Free text debounces itself; structured filters apply on demand.
  useEffect(() => {
    const t = window.setTimeout(
      () => setApplied((prev) => ({ ...prev, q: filters.q.trim() })),
      320,
    );
    return () => window.clearTimeout(t);
  }, [filters.q]);

  useEffect(() => {
    void apiGet<ListResponse<Customer>>('/api/customers?pageSize=100')
      .then((r) => setCustomers(r.items))
      .catch(() => undefined);
  }, []);

  const queryString = useCallback(
    (targetPage: number) => {
      const qs = new URLSearchParams({ page: String(targetPage), pageSize: '30' });
      if (applied.from) qs.set('from', applied.from);
      if (applied.to) qs.set('to', applied.to);
      if (applied.customerId) qs.set('customerId', applied.customerId);
      if (applied.status !== 'ANY') qs.set('status', applied.status);
      if (applied.minAmount || applied.maxAmount) {
        qs.set('amountField', applied.amountField);
        if (applied.minAmount) qs.set('minAmount', applied.minAmount);
        if (applied.maxAmount) qs.set('maxAmount', applied.maxAmount);
      }
      if (applied.q) qs.set('q', applied.q);
      return qs.toString();
    },
    [applied],
  );

  const load = useCallback(
    async (targetPage: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGet<ListResponse<TimelineDayItem>>(
          `/api/timeline?${queryString(targetPage)}`,
        );
        setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
        setPage(res.page);
        setOffline(false);
      } catch (e) {
        if (e instanceof ApiError && e.isTransient) setOffline(true);
        else setError(e instanceof ApiError ? e.message : 'Could not load the timeline.');
      } finally {
        setLoading(false);
      }
    },
    [queryString],
  );

  useEffect(() => {
    void load(1, true);
  }, [load]);

  /* Local Dexie fallback so the timeline still shows something offline. */
  const localDays = useLiveQuery(async () => {
    if (!db) return [] as TimelineDayItem[];
    const days = await db.ledgerDays.toArray();
    const out: TimelineDayItem[] = [];
    for (const d of days) {
      const rows = (await db.transactions.where('ledgerDayId').equals(d.id).toArray()).filter(
        (r) => !r.isDeleted,
      );
      out.push({
        date: d.date,
        ledgerDayId: d.id,
        status: d.status,
        transactionCount: rows.length,
        totals: computeTotals(rows),
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [db], [] as TimelineDayItem[]);

  const visible = offline ? (localDays ?? []) : items;
  const hasMore = !offline && items.length < total;
  const grouped = useMemo(() => groupByMonth(visible), [visible]);
  const activeFilterCount = countActive(applied);

  return (
    <Page
      breadcrumbs={[{ label: 'Workspace', to: '/home' }, { label: 'Timeline' }]}
      eyebrow="History"
      title="Timeline"
      subtitle={
        offline
          ? 'Showing locally cached days'
          : total > 0
            ? `${total} day${total === 1 ? '' : 's'} recorded`
            : undefined
      }
      actions={
        <Button
          size="sm"
          variant={activeFilterCount > 0 ? 'subtle' : 'secondary'}
          onClick={() => setShowFilters((v) => !v)}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 6h18M6 12h12M10 18h4" />
          </svg>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
      }
    >
      <div className="relative mb-3">
        <svg
          viewBox="0 0 24 24"
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-3)] pointer-events-none"
          fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <Input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Search customer names and notes"
          className="pl-9"
          aria-label="Search the timeline"
        />
      </div>

      {showFilters && (
        <Card className="mb-4 animate-fade-rise">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="f-from">From</Label>
              <Input id="f-from" type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="f-to">To</Label>
              <Input id="f-to" type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="f-customer">Customer</Label>
              <Select
                id="f-customer"
                value={filters.customerId}
                onChange={(v) => setFilters((f) => ({ ...f, customerId: v }))}
                options={[{ value: '', label: 'Any customer' }, ...customers.map((c) => ({ value: c.id, label: c.name }))]}
              />
            </div>
            <div>
              <Label htmlFor="f-status">Status</Label>
              <Select
                id="f-status"
                value={filters.status}
                onChange={(v) => setFilters((f) => ({ ...f, status: v as StatusFilter }))}
                options={[
                  { value: 'ANY', label: 'Any status' },
                  { value: 'COMPLETED', label: 'Completed' },
                  { value: 'PENDING', label: 'Pending' },
                  { value: 'READY', label: 'Ready' },
                  { value: 'INCOMPLETE', label: 'Incomplete' },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="f-field">Amount field</Label>
              <Select
                id="f-field"
                value={filters.amountField}
                onChange={(v) => setFilters((f) => ({ ...f, amountField: v as AmountField }))}
                options={[
                  { value: 'inr', label: 'INR' },
                  { value: 'usdt', label: 'USDT' },
                  { value: 'rub', label: 'Final RUB' },
                  { value: 'extras', label: 'Extras' },
                ]}
              />
            </div>
            <div>
              <Label htmlFor="f-min">Min amount</Label>
              <Input id="f-min" inputMode="decimal" placeholder="0" value={filters.minAmount} onChange={(e) => setFilters((f) => ({ ...f, minAmount: e.target.value.replace(/[^0-9.]/g, '') }))} />
            </div>
            <div>
              <Label htmlFor="f-max">Max amount</Label>
              <Input id="f-max" inputMode="decimal" placeholder="Any" value={filters.maxAmount} onChange={(e) => setFilters((f) => ({ ...f, maxAmount: e.target.value.replace(/[^0-9.]/g, '') }))} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--border)]">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
              }}
            >
              Clear all
            </Button>
            <Button size="sm" variant="primary" onClick={() => setApplied(filters)}>
              Apply filters
            </Button>
          </div>
        </Card>
      )}

      {offline && (
        <div
          className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 mb-3"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
          role="status"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 18.5v.01M5 12.8a10 10 0 0114 0M2 9.3a15 15 0 0120 0" />
          </svg>
          <p className="text-[12.5px] leading-snug">
            Offline — showing days cached on this device. Full history returns when you reconnect.
          </p>
        </div>
      )}

      {error ? (
        <Card>
          <EmptyState
            title="Timeline unavailable"
            description={error}
            action={<Button variant="secondary" onClick={() => void load(1, true)}>Retry</Button>}
          />
        </Card>
      ) : loading && visible.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="flex items-center gap-4">
              <Skeleton className="h-11 w-11 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M8 3v3M16 3v3M3.5 9h17M5 6h14a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 015 6z" />
              </svg>
            }
            title={activeFilterCount > 0 ? 'No matching days' : 'No days recorded yet'}
            description={
              activeFilterCount > 0
                ? 'No ledger days match this filter combination.'
                : 'Your ledger days will appear here as you record them.'
            }
            action={
              activeFilterCount > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setApplied(EMPTY_FILTERS);
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/ledger')}>Open today</Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map(([month, days]) => (
            <div key={month}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)] mb-2 px-1">
                {month}
              </p>
              <div className="space-y-1.5">
                {days.map((d) => (
                  <DayRow key={d.date} item={d} onOpen={() => navigate(`/ledger?date=${d.date}`)} />
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="pt-1 flex justify-center">
              <Button variant="secondary" loading={loading} onClick={() => void load(page + 1, false)}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

function Select({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-11 px-3 rounded-md bg-[var(--surface-1)] text-[var(--text-1)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] text-[14px]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function DayRow({ item, onOpen }: { item: TimelineDayItem; onOpen: () => void }) {
  const isDayOff = item.status === 'DAY_OFF';
  const pct =
    item.totals.rowCount > 0
      ? Math.round((item.totals.completedCount / item.totals.rowCount) * 100)
      : 0;
  /**
   * A day that exists but holds nothing (auto-created, or every row deleted)
   * is its own state (16 s6) - showing "0 transactions - 0% complete" next to
   * a confident Rs 0.00 makes an untouched day look like a recorded loss.
   */
  const isEmptyDay = item.transactionCount === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full card px-3.5 py-3 flex items-center gap-3.5 text-left hover:bg-[var(--surface-2)] transition-colors"
    >
      <div
        className="shrink-0 h-11 w-11 rounded-lg grid place-content-center text-center"
        style={{ background: isDayOff ? 'var(--surface-3)' : 'var(--accent-soft)' }}
      >
        <span
          className="num block text-[15px] font-semibold leading-none"
          style={{ color: isDayOff ? 'var(--text-3)' : 'var(--accent)' }}
        >
          {Number(item.date.slice(8, 10))}
        </span>
        <span className="block text-[9.5px] uppercase tracking-wide mt-0.5 text-[var(--text-3)]">
          {formatWeekday(item.date)}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-[var(--text-1)]">
            {formatDateMedium(item.date)}
          </span>
          {isDayOff && <Badge tone="warning">Day Off</Badge>}
        </div>
        <p className="text-[12px] text-[var(--text-3)] mt-0.5">
          {isDayOff
            ? item.transactionCount > 0
              ? `${item.transactionCount} preserved row${item.transactionCount === 1 ? '' : 's'}`
              : 'No trading'
            : isEmptyDay
              ? 'No entries recorded'
              : `${item.transactionCount} transaction${item.transactionCount === 1 ? '' : 's'} · ${pct}% complete`}
        </p>
      </div>

      {!isDayOff && !isEmptyDay && (
        <div className="hidden sm:flex flex-col items-end shrink-0">
          <span className="num text-[13.5px] font-medium text-[var(--text-1)]">
            {formatMoney(item.totals.totalInr, 'INR')}
          </span>
          <span className="num text-[11.5px] text-[var(--text-3)]">
            {formatMoney(item.totals.totalUsdt, 'USDT')}
          </span>
        </div>
      )}

      <svg viewBox="0 0 24 24" className="h-4 w-4 text-[var(--text-3)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function countActive(f: Filters): number {
  let n = 0;
  if (f.from) n++;
  if (f.to) n++;
  if (f.customerId) n++;
  if (f.status !== 'ANY') n++;
  if (f.minAmount || f.maxAmount) n++;
  if (f.q) n++;
  return n;
}

function groupByMonth(items: TimelineDayItem[]): Array<[string, TimelineDayItem[]]> {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const map = new Map<string, TimelineDayItem[]>();
  for (const item of items) {
    const [y, m] = item.date.split('-');
    const key = `${MONTHS[Number(m) - 1]} ${y}`;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()];
}

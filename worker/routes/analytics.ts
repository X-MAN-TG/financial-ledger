/**
 * Analytics (05 section 9, 10-analytics-specification.txt).
 *
 * Every endpoint returns a small pre-aggregated object built from indexed
 * SQL aggregates. Raw rows are never shipped for client-side aggregation
 * (10 section 4.2). Soft-deleted rows are excluded everywhere (10 s4.4).
 * Day Off days are excluded from trading-day averages but still reported so
 * calendars can mark them (10 section 4.5).
 */
import { addDays, localDateKey, round2 } from '../../shared/business-rules';
import type {
  AnalyticsAllTime,
  AnalyticsDailyPoint,
  AnalyticsMonthly,
  AnalyticsToday,
  AnalyticsWindow,
} from '../../shared/types';
import { dateKeySchema, monthlyQuerySchema } from '../../shared/validation';
import { z } from 'zod';
import type { Env } from '../lib/config';
import { queryAll, queryFirst } from '../lib/db';
import { json } from '../lib/http';
import type { SessionContext } from '../middleware/auth';
import { parseQuery } from '../middleware/validation';

/** The client sends its local "today" so buckets match the user's timezone. */
const todayQuerySchema = z.object({ date: dateKeySchema.optional() });

interface DayAggRow {
  date: string;
  status: string;
  c: number;
  inr: number;
  usdt: number;
  rub: number;
  extras: number;
  completed: number;
}

async function fetchDailyAggregates(
  env: Env,
  userId: string,
  from: string,
  to: string,
): Promise<DayAggRow[]> {
  return queryAll<DayAggRow>(
    env,
    `SELECT d.date AS date, d.status AS status,
            COUNT(t.id) AS c,
            COALESCE(SUM(t.inr_amount), 0) AS inr,
            COALESCE(SUM(t.usdt_amount), 0) AS usdt,
            COALESCE(SUM(t.final_rub_amount), 0) AS rub,
            COALESCE(SUM(t.extras_amount), 0) AS extras,
            COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
       FROM ledger_days d
       LEFT JOIN transactions t
         ON t.ledger_day_id = d.id AND t.user_id = d.user_id AND t.is_deleted = 0
      WHERE d.user_id = ? AND d.date >= ? AND d.date <= ?
      GROUP BY d.id
      ORDER BY d.date ASC`,
    [userId, from, to],
  );
}

/** Fill gaps so charts show continuous dates, not just days with rows. */
function buildSeries(rows: DayAggRow[], from: string, to: string): AnalyticsDailyPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: AnalyticsDailyPoint[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 800) {
    const r = byDate.get(cursor);
    out.push({
      date: cursor,
      count: r ? Number(r.c) : 0,
      inr: r ? round2(Number(r.inr)) : 0,
      usdt: r ? round2(Number(r.usdt)) : 0,
      rub: r ? round2(Number(r.rub)) : 0,
      extras: r ? round2(Number(r.extras)) : 0,
      completed: r ? Number(r.completed) : 0,
      isDayOff: r ? r.status === 'DAY_OFF' : false,
    });
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

async function windowTotals(
  env: Env,
  userId: string,
  from: string,
  to: string,
): Promise<{ count: number; inr: number; usdt: number; rub: number; extras: number; completed: number }> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT COUNT(t.id) AS c,
            COALESCE(SUM(t.inr_amount), 0) AS inr,
            COALESCE(SUM(t.usdt_amount), 0) AS usdt,
            COALESCE(SUM(t.final_rub_amount), 0) AS rub,
            COALESCE(SUM(t.extras_amount), 0) AS extras,
            COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
       FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND t.is_deleted = 0 AND d.date >= ? AND d.date <= ?`,
    [userId, from, to],
  );
  return {
    count: row ? Number(row.c) : 0,
    inr: row ? round2(Number(row.inr)) : 0,
    usdt: row ? round2(Number(row.usdt)) : 0,
    rub: row ? round2(Number(row.rub)) : 0,
    extras: row ? round2(Number(row.extras)) : 0,
    completed: row ? Number(row.completed) : 0,
  };
}

export async function analyticsToday(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, todayQuerySchema);
  const date = q.date ?? localDateKey();

  const row = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT d.status AS status,
            COUNT(t.id) AS c,
            COALESCE(SUM(t.inr_amount), 0) AS inr,
            COALESCE(SUM(t.usdt_amount), 0) AS usdt,
            COALESCE(SUM(t.final_rub_amount), 0) AS rub,
            COALESCE(SUM(t.extras_amount), 0) AS extras,
            COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
       FROM ledger_days d
       LEFT JOIN transactions t
         ON t.ledger_day_id = d.id AND t.user_id = d.user_id AND t.is_deleted = 0
      WHERE d.user_id = ? AND d.date = ?
      GROUP BY d.id`,
    [session.userId, date],
  );

  const count = row ? Number(row.c) : 0;
  const completed = row ? Number(row.completed) : 0;
  const payload: AnalyticsToday = {
    date,
    transactionCount: count,
    totalInr: row ? round2(Number(row.inr)) : 0,
    totalUsdt: row ? round2(Number(row.usdt)) : 0,
    totalRub: row ? round2(Number(row.rub)) : 0,
    totalExtras: row ? round2(Number(row.extras)) : 0,
    completedCount: completed,
    pendingCount: count - completed,
    completionPct: count > 0 ? Math.round((completed / count) * 100) : 0,
    dayStatus: row?.status === 'DAY_OFF' ? 'DAY_OFF' : 'TRADING_DAY',
  };
  return json(payload);
}

async function buildWindow(
  env: Env,
  userId: string,
  to: string,
  days: number,
  withPrevious: boolean,
): Promise<AnalyticsWindow> {
  const from = addDays(to, -(days - 1));
  const rows = await fetchDailyAggregates(env, userId, from, to);
  const series = buildSeries(rows, from, to);
  const totals = await windowTotals(env, userId, from, to);

  const tradingDayCount = rows.filter((r) => r.status !== 'DAY_OFF').length;
  const dayOffCount = rows.filter((r) => r.status === 'DAY_OFF').length;

  const win: AnalyticsWindow = {
    from,
    to,
    days: series,
    transactionCount: totals.count,
    totalInr: totals.inr,
    totalUsdt: totals.usdt,
    totalRub: totals.rub,
    totalExtras: totals.extras,
    completedCount: totals.completed,
    pendingCount: totals.count - totals.completed,
    tradingDayCount,
    dayOffCount,
    // Day Off days are excluded from this average (10 section 4.5).
    avgTransactionsPerTradingDay:
      tradingDayCount > 0 ? round2(totals.count / tradingDayCount) : 0,
  };

  if (withPrevious) {
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));
    const prev = await windowTotals(env, userId, prevFrom, prevTo);
    const pct = (curr: number, before: number): number | null => {
      if (before === 0) return curr === 0 ? 0 : null; // null = "no baseline"
      return round2(((curr - before) / before) * 100);
    };
    win.previous = {
      transactionCount: prev.count,
      totalExtras: prev.extras,
      totalInr: prev.inr,
      extrasChangePct: pct(totals.extras, prev.extras),
      countChangePct: pct(totals.count, prev.count),
    };
  }

  return win;
}

export async function analytics7d(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, todayQuerySchema);
  return json(await buildWindow(env, session.userId, q.date ?? localDateKey(), 7, true));
}

export async function analytics30d(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, todayQuerySchema);
  return json(await buildWindow(env, session.userId, q.date ?? localDateKey(), 30, true));
}

export async function analyticsMonthly(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, monthlyQuerySchema);
  const [y, m] = q.month.split('-').map(Number);
  const from = `${q.month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${q.month}-${String(lastDay).padStart(2, '0')}`;

  const rows = await fetchDailyAggregates(env, session.userId, from, to);
  const series = buildSeries(rows, from, to);
  const totals = await windowTotals(env, session.userId, from, to);

  const byExtras = [...series]
    .filter((d) => d.extras > 0)
    .sort((a, b) => b.extras - a.extras)
    .slice(0, 5)
    .map((d) => ({ date: d.date, value: d.extras }));
  const byVolume = [...series]
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((d) => ({ date: d.date, value: d.count }));

  const payload: AnalyticsMonthly = {
    month: q.month,
    transactionCount: totals.count,
    totalInr: totals.inr,
    totalUsdt: totals.usdt,
    totalRub: totals.rub,
    totalExtras: totals.extras,
    completedCount: totals.completed,
    pendingCount: totals.count - totals.completed,
    avgTransactionValueInr: totals.count > 0 ? round2(totals.inr / totals.count) : 0,
    days: series,
    bestDaysByExtras: byExtras,
    bestDaysByVolume: byVolume,
  };
  return json(payload);
}

export async function analyticsAllTime(env: Env, session: SessionContext): Promise<Response> {
  const totalsRow = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT COUNT(t.id) AS c,
            COALESCE(SUM(t.inr_amount), 0) AS inr,
            COALESCE(SUM(t.usdt_amount), 0) AS usdt,
            COALESCE(SUM(t.final_rub_amount), 0) AS rub,
            COALESCE(SUM(t.extras_amount), 0) AS extras,
            COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
       FROM transactions t
      WHERE t.user_id = ? AND t.is_deleted = 0`,
    [session.userId],
  );

  const bounds = await queryFirst<{ first_date: string | null; last_date: string | null }>(
    env,
    'SELECT MIN(date) AS first_date, MAX(date) AS last_date FROM ledger_days WHERE user_id = ?',
    [session.userId],
  );

  const dayStatus = await queryFirst<{ trading: number; off: number }>(
    env,
    `SELECT SUM(CASE WHEN status = 'TRADING_DAY' THEN 1 ELSE 0 END) AS trading,
            SUM(CASE WHEN status = 'DAY_OFF' THEN 1 ELSE 0 END) AS off
       FROM ledger_days WHERE user_id = ?`,
    [session.userId],
  );

  const mostActive = await queryAll<{ date: string; c: number }>(
    env,
    `SELECT d.date AS date, COUNT(t.id) AS c
       FROM ledger_days d
       JOIN transactions t ON t.ledger_day_id = d.id AND t.user_id = d.user_id AND t.is_deleted = 0
      WHERE d.user_id = ?
      GROUP BY d.id
      ORDER BY c DESC, d.date DESC
      LIMIT 5`,
    [session.userId],
  );

  // Group by customer_id where present, else by the typed name snapshot, so
  // free-typed customers still surface in the ranking.
  const topCustomers = await queryAll<{
    customer_id: string | null;
    name: string | null;
    c: number;
    extras: number;
  }>(
    env,
    `SELECT t.customer_id AS customer_id,
            COALESCE(c.name, t.customer_name_snapshot) AS name,
            COUNT(t.id) AS c,
            COALESCE(SUM(t.extras_amount), 0) AS extras
       FROM transactions t
       LEFT JOIN customers c ON c.id = t.customer_id AND c.user_id = t.user_id
      WHERE t.user_id = ? AND t.is_deleted = 0
        AND (t.customer_id IS NOT NULL OR (t.customer_name_snapshot IS NOT NULL AND TRIM(t.customer_name_snapshot) != ''))
      GROUP BY COALESCE(t.customer_id, LOWER(TRIM(t.customer_name_snapshot)))
      ORDER BY c DESC
      LIMIT 8`,
    [session.userId],
  );

  const monthly = await queryAll<{ month: string; c: number; extras: number; inr: number }>(
    env,
    `SELECT substr(d.date, 1, 7) AS month,
            COUNT(t.id) AS c,
            COALESCE(SUM(t.extras_amount), 0) AS extras,
            COALESCE(SUM(t.inr_amount), 0) AS inr
       FROM ledger_days d
       JOIN transactions t ON t.ledger_day_id = d.id AND t.user_id = d.user_id AND t.is_deleted = 0
      WHERE d.user_id = ?
      GROUP BY month
      ORDER BY month ASC
      LIMIT 60`,
    [session.userId],
  );

  const count = totalsRow ? Number(totalsRow.c) : 0;
  const completed = totalsRow ? Number(totalsRow.completed) : 0;
  const inr = totalsRow ? round2(Number(totalsRow.inr)) : 0;

  const payload: AnalyticsAllTime = {
    firstDate: bounds?.first_date ?? null,
    lastDate: bounds?.last_date ?? null,
    transactionCount: count,
    totalInr: inr,
    totalUsdt: totalsRow ? round2(Number(totalsRow.usdt)) : 0,
    totalRub: totalsRow ? round2(Number(totalsRow.rub)) : 0,
    totalExtras: totalsRow ? round2(Number(totalsRow.extras)) : 0,
    completedCount: completed,
    pendingCount: count - completed,
    avgTransactionValueInr: count > 0 ? round2(inr / count) : 0,
    tradingDayCount: dayStatus ? Number(dayStatus.trading ?? 0) : 0,
    dayOffCount: dayStatus ? Number(dayStatus.off ?? 0) : 0,
    mostActiveDays: mostActive.map((r) => ({ date: r.date, value: Number(r.c) })),
    topCustomers: topCustomers.map((r) => ({
      customerId: r.customer_id,
      name: r.name ?? 'Unnamed',
      count: Number(r.c),
      extras: round2(Number(r.extras)),
    })),
    monthly: monthly.map((r) => ({
      month: r.month,
      count: Number(r.c),
      extras: round2(Number(r.extras)),
      inr: round2(Number(r.inr)),
    })),
  };
  return json(payload);
}

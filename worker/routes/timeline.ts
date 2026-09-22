/**
 * Timeline (05 section 8, 09-timeline-search-and-filters.txt).
 *
 * Day-level aggregates come from SQL GROUP BY, never from fetching rows and
 * summing in the Worker (09 section 4.2). Results are always additionally
 * scoped to the session user regardless of what the client sent (09 s3).
 */
import { z } from 'zod';
import type { TimelineDayItem } from '../../shared/types';
import { pageSchema, pageSizeSchema, timelineQuerySchema } from '../../shared/validation';
import type { Env } from '../lib/config';
import { mapTransaction, queryAll, queryFirst } from '../lib/db';
import { badRequest, json } from '../lib/http';
import type { SessionContext } from '../middleware/auth';
import { parseQuery, parseWith } from '../middleware/validation';
import { dateKeySchema } from '../../shared/validation';

const AMOUNT_COLUMN: Record<string, string> = {
  inr: 't.inr_amount',
  usdt: 't.usdt_amount',
  rub: 't.final_rub_amount',
  extras: 't.extras_amount',
};

export async function getTimeline(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, timelineQuerySchema);
  if (q.from && q.to && q.from > q.to) throw badRequest('"from" must be on or before "to"');
  if (q.minAmount !== undefined && q.maxAmount !== undefined && q.minAmount > q.maxAmount) {
    throw badRequest('Minimum amount must not exceed maximum amount');
  }

  // Transaction-level predicates. When any are present, a day only appears
  // if it has at least one MATCHING transaction, and its totals reflect
  // only the matching rows - otherwise filters would be misleading.
  const txPredicates: string[] = ['t.is_deleted = 0'];
  const txParams: unknown[] = [];

  if (q.customerId) {
    txPredicates.push('t.customer_id = ?');
    txParams.push(q.customerId);
  }
  if (q.status && q.status !== 'ANY') {
    if (q.status === 'PENDING') {
      txPredicates.push("t.status != 'COMPLETED'");
    } else {
      txPredicates.push('t.status = ?');
      txParams.push(q.status);
    }
  }
  if (q.minAmount !== undefined || q.maxAmount !== undefined) {
    // Whitelisted column name - never interpolated from raw user input.
    const col = AMOUNT_COLUMN[q.amountField ?? 'inr'];
    if (q.minAmount !== undefined) {
      txPredicates.push(`COALESCE(${col}, 0) >= ?`);
      txParams.push(q.minAmount);
    }
    if (q.maxAmount !== undefined) {
      txPredicates.push(`COALESCE(${col}, 0) <= ?`);
      txParams.push(q.maxAmount);
    }
  }
  if (q.q) {
    txPredicates.push('(t.customer_name_snapshot LIKE ? OR t.note LIKE ?)');
    const like = `%${q.q}%`;
    txParams.push(like, like);
  }

  const hasTxFilter =
    Boolean(q.customerId) ||
    (Boolean(q.status) && q.status !== 'ANY') ||
    q.minAmount !== undefined ||
    q.maxAmount !== undefined ||
    Boolean(q.q);

  const dayPredicates: string[] = ['d.user_id = ?'];
  const dayParams: unknown[] = [session.userId];
  if (q.from) {
    dayPredicates.push('d.date >= ?');
    dayParams.push(q.from);
  }
  if (q.to) {
    dayPredicates.push('d.date <= ?');
    dayParams.push(q.to);
  }

  const joinCondition = `t.ledger_day_id = d.id AND t.user_id = d.user_id AND ${txPredicates.join(' AND ')}`;
  const joinType = hasTxFilter ? 'JOIN' : 'LEFT JOIN';

  const offset = (q.page - 1) * q.pageSize;

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT d.id, d.date, d.status,
            COUNT(t.id) AS tx_count,
            COALESCE(SUM(t.inr_amount), 0) AS inr,
            COALESCE(SUM(t.usdt_amount), 0) AS usdt,
            COALESCE(SUM(t.final_rub_amount), 0) AS rub,
            COALESCE(SUM(t.extras_amount), 0) AS extras,
            COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
       FROM ledger_days d
       ${joinType} transactions t ON ${joinCondition}
      WHERE ${dayPredicates.join(' AND ')}
      GROUP BY d.id
      ORDER BY d.date DESC
      LIMIT ? OFFSET ?`,
    [...dayParams, ...txParams, q.pageSize, offset],
  );

  const totalRow = await queryFirst<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM (
        SELECT d.id
          FROM ledger_days d
          ${joinType} transactions t ON ${joinCondition}
         WHERE ${dayPredicates.join(' AND ')}
         GROUP BY d.id
     )`,
    [...dayParams, ...txParams],
  );

  const items: TimelineDayItem[] = rows.map((r) => {
    const count = Number(r.tx_count);
    const completed = Number(r.completed);
    return {
      date: String(r.date),
      ledgerDayId: String(r.id),
      status: r.status === 'DAY_OFF' ? 'DAY_OFF' : 'TRADING_DAY',
      transactionCount: count,
      totals: {
        totalInr: Number(r.inr),
        totalUsdt: Number(r.usdt),
        totalRub: Number(r.rub),
        totalExtras: Number(r.extras),
        completedCount: completed,
        pendingCount: count - completed,
        rowCount: count,
      },
    };
  });

  return json({
    items,
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow ? Number(totalRow.c) : 0,
  });
}

export async function getTimelineDayTransactions(
  env: Env,
  session: SessionContext,
  rawDate: string,
  url: URL,
): Promise<Response> {
  const date = parseWith(dateKeySchema, rawDate);
  const q = parseQuery(url, z.object({ page: pageSchema, pageSize: pageSizeSchema }));
  const offset = (q.page - 1) * q.pageSize;

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND d.date = ? AND t.is_deleted = 0
      ORDER BY t.sort_order ASC
      LIMIT ? OFFSET ?`,
    [session.userId, date, q.pageSize, offset],
  );
  const totalRow = await queryFirst<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND d.date = ? AND t.is_deleted = 0`,
    [session.userId, date],
  );

  return json({
    items: rows.map(mapTransaction),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow ? Number(totalRow.c) : 0,
  });
}

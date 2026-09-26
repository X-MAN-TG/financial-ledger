/**
 * Ledger day routes (05 section 4, 06-daily-ledger-specification.txt).
 */
import { computeTotals } from '../../shared/business-rules';
import { dateKeySchema, ledgerDayRangeSchema, ledgerDayUpdateSchema } from '../../shared/validation';
import type { Env } from '../lib/config';
import { auditStatement } from '../lib/audit';
import { batch, mapLedgerDay, queryAll, queryFirst, stmt } from '../lib/db';
import { badRequest, json, notFound } from '../lib/http';
import { attachCustomValues, ensureLedgerDay, listDayTransactions } from '../lib/ledger-service';
import type { SessionContext } from '../middleware/auth';
import { parseBody, parseQuery, parseWith } from '../middleware/validation';

/**
 * GET /api/ledger-days/:date
 * Lazily creates the day as TRADING_DAY on first read (06 section 2.1).
 * Empty seed rows are created client-side/offline-first, never here.
 */
export async function getLedgerDay(
  env: Env,
  session: SessionContext,
  rawDate: string,
): Promise<Response> {
  const date = parseWith(dateKeySchema, rawDate);
  const day = await ensureLedgerDay(env, session.userId, date);
  const transactions = await attachCustomValues(
    env,
    await listDayTransactions(env, session.userId, day.id),
  );
  return json({ ledgerDay: day, transactions, totals: computeTotals(transactions) });
}

export async function setDayOff(
  env: Env,
  session: SessionContext,
  rawDate: string,
): Promise<Response> {
  const date = parseWith(dateKeySchema, rawDate);
  const day = await ensureLedgerDay(env, session.userId, date);
  const now = Date.now();

  // Status change only - existing transactions are never touched (06 s3.2).
  await batch(env, [
    stmt(
      env,
      "UPDATE ledger_days SET status = 'DAY_OFF', updated_at = ? WHERE id = ? AND user_id = ?",
      [now, day.id, session.userId],
    ),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'DAY_MARKED_OFF',
        resourceType: 'ledger_day',
        resourceId: day.id,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { date },
      },
      now,
    ),
  ]);

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM ledger_days WHERE id = ?',
    [day.id],
  );
  if (!row) throw notFound('Ledger day not found');
  return json({ ledgerDay: mapLedgerDay(row) });
}

export async function reopenDay(
  env: Env,
  session: SessionContext,
  rawDate: string,
): Promise<Response> {
  const date = parseWith(dateKeySchema, rawDate);
  const day = await ensureLedgerDay(env, session.userId, date);
  const now = Date.now();

  await batch(env, [
    stmt(
      env,
      "UPDATE ledger_days SET status = 'TRADING_DAY', updated_at = ? WHERE id = ? AND user_id = ?",
      [now, day.id, session.userId],
    ),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'DAY_REOPENED',
        resourceType: 'ledger_day',
        resourceId: day.id,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { date },
      },
      now,
    ),
  ]);

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM ledger_days WHERE id = ?',
    [day.id],
  );
  if (!row) throw notFound('Ledger day not found');
  // Seeding of empty rows on reopen happens client-side (06 section 3.4).
  return json({ ledgerDay: mapLedgerDay(row) });
}

/** GET /api/ledger-days?from&to - day summaries via SQL aggregation. */
export async function listLedgerDays(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, ledgerDayRangeSchema);
  if (q.from && q.to && q.from > q.to) throw badRequest('"from" must be on or before "to"');

  const params: unknown[] = [session.userId];
  let where = 'd.user_id = ?';
  if (q.from) {
    where += ' AND d.date >= ?';
    params.push(q.from);
  }
  if (q.to) {
    where += ' AND d.date <= ?';
    params.push(q.to);
  }

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
       LEFT JOIN transactions t
         ON t.ledger_day_id = d.id AND t.user_id = d.user_id AND t.is_deleted = 0
      WHERE ${where}
      GROUP BY d.id
      ORDER BY d.date DESC`,
    params,
  );

  return json({
    items: rows.map((r) => ({
      date: String(r.date),
      ledgerDayId: String(r.id),
      status: r.status === 'DAY_OFF' ? 'DAY_OFF' : 'TRADING_DAY',
      transactionCount: Number(r.tx_count),
      totals: {
        totalInr: Number(r.inr),
        totalUsdt: Number(r.usdt),
        totalRub: Number(r.rub),
        totalExtras: Number(r.extras),
        completedCount: Number(r.completed),
        pendingCount: Number(r.tx_count) - Number(r.completed),
        rowCount: Number(r.tx_count),
      },
    })),
  });
}

export async function updateLedgerDay(
  req: Request,
  env: Env,
  session: SessionContext,
  rawDate: string,
): Promise<Response> {
  const date = parseWith(dateKeySchema, rawDate);
  const day = await ensureLedgerDay(env, session.userId, date);
  const body = await parseBody(req, ledgerDayUpdateSchema);
  const now = Date.now();

  const nextStatus = body.status ?? day.status;
  const nextNote = body.note !== undefined ? body.note : (day.note ?? null);
  const nextAttachments =
    body.attachments !== undefined ? body.attachments : (day.attachments ?? []);
  const nextUsdtRate =
    body.usdtRate !== undefined ? body.usdtRate : (day.usdtRate ?? 0);

  const { execute } = await import('../lib/db');
  await execute(
    env,
    'UPDATE ledger_days SET status = ?, note = ?, attachments = ?, usdt_rate = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [nextStatus, nextNote, JSON.stringify(nextAttachments), nextUsdtRate, now, day.id, session.userId],
  );

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM ledger_days WHERE id = ?',
    [day.id],
  );
  if (!row) throw notFound('Ledger day not found');
  return json({ ledgerDay: mapLedgerDay(row) });
}


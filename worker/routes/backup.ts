/**
 * Export data endpoints + user Backup Center (05 section 10,
 * 14-backup-and-recovery.txt, 15-pdf-export.txt).
 *
 * The Worker only serves JSON. PDF/CSV bytes are produced entirely in the
 * browser (15 section 1) - there is no server-side rendering anywhere here.
 */
import { computeTotals, round2 } from '../../shared/business-rules';
import type { ExportDayPayload, ExportFullPage } from '../../shared/types';
import {
  backupExportSchema,
  dateKeySchema,
  exportFullQuerySchema,
  importPayloadSchema,
} from '../../shared/validation';
import { auditStatement, writeAudit } from '../lib/audit';
import type { Env } from '../lib/config';
import { newId } from '../lib/crypto';
import {
  batch,
  boolToInt,
  mapBackupRecord,
  mapColumnDefinition,
  mapLedgerDay,
  mapTransaction,
  queryAll,
  queryFirst,
  stmt,
} from '../lib/db';
import { json, notFound } from '../lib/http';
import { attachCustomValues, ensureLedgerDay } from '../lib/ledger-service';
import type { SessionContext } from '../middleware/auth';
import { parseBody, parseQuery, parseWith } from '../middleware/validation';

export async function exportDay(
  env: Env,
  session: SessionContext,
  rawDate: string,
): Promise<Response> {
  const date = parseWith(dateKeySchema, rawDate);
  const day = await ensureLedgerDay(env, session.userId, date);

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND t.ledger_day_id = ? AND t.is_deleted = 0
      ORDER BY t.sort_order ASC`,
    [session.userId, String(day.id)],
  );
  const transactions = await attachCustomValues(env, rows.map(mapTransaction));

  const profile = await queryFirst<{ display_name: string; full_name: string | null }>(
    env,
    'SELECT display_name, full_name FROM profiles WHERE user_id = ?',
    [session.userId],
  );
  const columns = await queryAll<Record<string, unknown>>(
    env,
    'SELECT * FROM column_definitions WHERE is_active = 1 ORDER BY position ASC',
  );

  const payload: ExportDayPayload = {
    date,
    status: day.status === 'DAY_OFF' ? 'DAY_OFF' : 'TRADING_DAY',
    transactions,
    totals: computeTotals(transactions),
  };

  return json({
    ...payload,
    profile: {
      displayName: profile?.display_name ?? '',
      fullName: profile?.full_name ?? null,
    },
    columns: columns.map(mapColumnDefinition),
  });
}

/** Paginated by DAY so the client can assemble large PDFs incrementally. */
export async function exportFull(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, exportFullQuerySchema);
  const params: unknown[] = [session.userId];
  let where = 'user_id = ?';
  if (q.from) {
    where += ' AND date >= ?';
    params.push(q.from);
  }
  if (q.to) {
    where += ' AND date <= ?';
    params.push(q.to);
  }

  const totalRow = await queryFirst<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM ledger_days WHERE ${where}`,
    params,
  );
  const offset = (q.page - 1) * q.pageSize;
  const dayRows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT * FROM ledger_days WHERE ${where} ORDER BY date DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset],
  );

  const days: ExportDayPayload[] = [];
  if (dayRows.length > 0) {
    const ids = dayRows.map((d) => String(d.id));
    const placeholders = ids.map(() => '?').join(',');
    const txRows = await queryAll<Record<string, unknown>>(
      env,
      `SELECT t.*, d.date AS date FROM transactions t
         JOIN ledger_days d ON d.id = t.ledger_day_id
        WHERE t.user_id = ? AND t.ledger_day_id IN (${placeholders}) AND t.is_deleted = 0
        ORDER BY d.date DESC, t.sort_order ASC`,
      [session.userId, ...ids],
    );
    const withCustom = await attachCustomValues(env, txRows.map(mapTransaction));
    const byDay = new Map<string, typeof withCustom>();
    for (const t of withCustom) {
      const arr = byDay.get(t.ledgerDayId) ?? [];
      arr.push(t);
      byDay.set(t.ledgerDayId, arr);
    }
    for (const d of dayRows) {
      const day = mapLedgerDay(d);
      const transactions = byDay.get(day.id) ?? [];
      days.push({
        date: day.date,
        status: day.status,
        transactions,
        totals: computeTotals(transactions),
      });
    }
  }

  // Grand totals for the whole (filtered) range, computed in SQL so the
  // cover page does not depend on how many pages the client has fetched.
  const grandRow = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT COUNT(t.id) AS c,
            COALESCE(SUM(t.inr_amount), 0) AS inr,
            COALESCE(SUM(t.usdt_amount), 0) AS usdt,
            COALESCE(SUM(t.final_rub_amount), 0) AS rub,
            COALESCE(SUM(t.extras_amount), 0) AS extras,
            COALESCE(SUM(CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
       FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND t.is_deleted = 0
        ${q.from ? 'AND d.date >= ?' : ''} ${q.to ? 'AND d.date <= ?' : ''}`,
    [session.userId, ...(q.from ? [q.from] : []), ...(q.to ? [q.to] : [])],
  );

  const profile = await queryFirst<{ display_name: string; full_name: string | null }>(
    env,
    'SELECT display_name, full_name FROM profiles WHERE user_id = ?',
    [session.userId],
  );
  const columns = await queryAll<Record<string, unknown>>(
    env,
    'SELECT * FROM column_definitions WHERE is_active = 1 ORDER BY position ASC',
  );

  const gCount = grandRow ? Number(grandRow.c) : 0;
  const gCompleted = grandRow ? Number(grandRow.completed) : 0;

  const payload: ExportFullPage = {
    days,
    page: q.page,
    pageSize: q.pageSize,
    totalDays: totalRow ? Number(totalRow.c) : 0,
    profile: {
      displayName: profile?.display_name ?? '',
      fullName: profile?.full_name ?? null,
    },
    columns: columns.map(mapColumnDefinition),
    grandTotals: {
      totalInr: grandRow ? round2(Number(grandRow.inr)) : 0,
      totalUsdt: grandRow ? round2(Number(grandRow.usdt)) : 0,
      totalRub: grandRow ? round2(Number(grandRow.rub)) : 0,
      totalExtras: grandRow ? round2(Number(grandRow.extras)) : 0,
      completedCount: gCompleted,
      pendingCount: gCount - gCompleted,
      rowCount: gCount,
    },
  };
  return json(payload);
}

/** Complete personal dump for the JSON backup (14 section 5.1). */
export async function exportAll(env: Env, session: SessionContext): Promise<Response> {
  const [profile, settings, customers, days, txRows] = await Promise.all([
    queryFirst<Record<string, unknown>>(env, 'SELECT * FROM profiles WHERE user_id = ?', [
      session.userId,
    ]),
    queryFirst<Record<string, unknown>>(env, 'SELECT * FROM user_settings WHERE user_id = ?', [
      session.userId,
    ]),
    queryAll<Record<string, unknown>>(env, 'SELECT * FROM customers WHERE user_id = ?', [
      session.userId,
    ]),
    queryAll<Record<string, unknown>>(
      env,
      'SELECT * FROM ledger_days WHERE user_id = ? ORDER BY date ASC',
      [session.userId],
    ),
    queryAll<Record<string, unknown>>(
      env,
      `SELECT t.*, d.date AS date FROM transactions t
         JOIN ledger_days d ON d.id = t.ledger_day_id
        WHERE t.user_id = ?
        ORDER BY d.date ASC, t.sort_order ASC`,
      [session.userId],
    ),
  ]);

  const transactions = await attachCustomValues(env, txRows.map(mapTransaction));

  return json({
    version: 1,
    exportedAt: Date.now(),
    profile: profile
      ? { displayName: String(profile.display_name), fullName: profile.full_name ?? null }
      : null,
    settings: settings ? { theme: String(settings.theme), dateFormat: String(settings.date_format) } : null,
    customers: customers.map((c) => ({
      id: String(c.id),
      name: String(c.name),
      phone: c.phone ?? null,
      notes: c.notes ?? null,
      isActive: c.is_active === 1,
      isDeleted: c.is_deleted === 1,
      createdAt: Number(c.created_at),
      updatedAt: Number(c.updated_at),
    })),
    ledgerDays: days.map((d) => {
      const day = mapLedgerDay(d);
      return {
        id: day.id,
        date: day.date,
        status: day.status,
        note: day.note ?? null,
        attachments: day.attachments ?? [],
        usdtRate: day.usdtRate ?? 0,
        createdAt: day.createdAt,
        updatedAt: day.updatedAt,
      };
    }),
    transactions: transactions.map((t) => ({
      id: t.id,
      ledgerDayId: t.ledgerDayId,
      date: t.date,
      srNumber: t.srNumber,
      customerId: t.customerId,
      customerNameSnapshot: t.customerNameSnapshot,
      inrAmount: t.inrAmount,
      inrReceived: t.inrReceived,
      usdtAmount: t.usdtAmount,
      finalRubAmount: t.finalRubAmount,
      extrasAmount: t.extrasAmount,
      orderDone: t.orderDone,
      note: t.note,
      sortOrder: t.sortOrder,
      isDeleted: t.isDeleted,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      clientCreatedAt: t.clientCreatedAt,
      customValues: t.customValues ?? undefined,
    })),
  });
}

export async function backupStatus(env: Env, session: SessionContext): Promise<Response> {
  const lastSync = await queryFirst<{ last: number | null }>(
    env,
    'SELECT MAX(applied_at) AS last FROM sync_operations WHERE user_id = ?',
    [session.userId],
  );
  const recent = await queryAll<Record<string, unknown>>(
    env,
    'SELECT * FROM backup_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
    [session.userId],
  );
  const lastExport = recent.find((r) => r.status === 'SUCCESS');

  return json({
    lastSyncAt: lastSync?.last ?? null,
    lastExportAt: lastExport ? Number(lastExport.created_at) : null,
    lastExportType: lastExport ? String(lastExport.type) : null,
    lastExportStatus: lastExport ? String(lastExport.status) : null,
    recent: recent.map(mapBackupRecord),
  });
}

/**
 * Records the outcome of a client-side export. The client reports the REAL
 * outcome: a failed generation is logged as FAILURE, never as success
 * (14 section 4 - honesty about backup status).
 */
export async function recordExport(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, backupExportSchema);
  const typeMap = {
    JSON: 'USER_EXPORT_JSON',
    CSV: 'USER_EXPORT_CSV',
    PDF: 'USER_EXPORT_PDF',
  } as const;
  const id = newId();
  const now = Date.now();

  await batch(env, [
    stmt(
      env,
      `INSERT INTO backup_records (id, user_id, type, status, file_ref, size_bytes, error_message, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        id,
        session.userId,
        typeMap[body.type],
        body.status,
        body.sizeBytes ?? null,
        body.errorMessage ?? null,
        now,
      ],
    ),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'EXPORT_GENERATED',
        resourceType: 'backup_record',
        resourceId: id,
        scope: 'USER',
        result: body.status,
        metadata: { type: body.type, sizeBytes: body.sizeBytes },
      },
      now,
    ),
  ]);

  return json({ backupRecordId: id, status: body.status }, 201);
}

/**
 * Import/restore (14 sections 2 and 7). Runs through the same validation and
 * ownership rules as normal writes; duplicate protection is by primary key
 * so re-importing an old backup never duplicates existing records.
 */
export async function importBackup(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, importPayloadSchema);
  const now = Date.now();

  let customersInserted = 0;
  let daysInserted = 0;
  let txInserted = 0;
  let txSkipped = 0;

  const statements: D1PreparedStatement[] = [];

  for (const c of body.customers) {
    statements.push(
      stmt(
        env,
        `INSERT INTO customers (id, user_id, name, phone, notes, is_active, is_deleted, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          c.id,
          session.userId,
          c.name,
          c.phone ?? null,
          c.notes ?? null,
          boolToInt(c.isActive ?? true),
          boolToInt(c.isDeleted ?? false),
          c.createdAt,
          c.updatedAt,
        ],
      ),
    );
    customersInserted += 1;
  }

  for (const d of body.ledgerDays) {
    statements.push(
      stmt(
        env,
        `INSERT INTO ledger_days (id, user_id, date, status, note, attachments, usdt_rate, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           note = COALESCE(excluded.note, ledger_days.note),
           attachments = COALESCE(excluded.attachments, ledger_days.attachments),
           usdt_rate = COALESCE(excluded.usdt_rate, ledger_days.usdt_rate)`,
        [d.id, session.userId, d.date, d.status, d.note ?? null, JSON.stringify(d.attachments ?? []), d.usdtRate ?? 0, d.createdAt, d.updatedAt],
      ),
    );
    daysInserted += 1;
  }

  // Resolve each transaction's day by DATE, because a conflicting
  // ledger_days insert above may have been skipped in favour of an existing
  // row with a different id for the same date.
  const dayIdByDate = new Map<string, string>();
  const existingDays = await queryAll<{ id: string; date: string }>(
    env,
    'SELECT id, date FROM ledger_days WHERE user_id = ?',
    [session.userId],
  );
  for (const d of existingDays) dayIdByDate.set(d.date, d.id);
  for (const d of body.ledgerDays) if (!dayIdByDate.has(d.date)) dayIdByDate.set(d.date, d.id);

  const { deriveStatus, resolveOrderDone } = await import('../../shared/business-rules');

  for (const t of body.transactions) {
    const dayId = dayIdByDate.get(t.date);
    if (!dayId) {
      txSkipped += 1;
      continue;
    }
    const fields = {
      customerNameSnapshot: t.customerNameSnapshot ?? null,
      inrAmount: t.inrAmount ?? null,
      usdtAmount: t.usdtAmount ?? null,
      finalRubAmount: t.finalRubAmount ?? null,
      orderDone: t.orderDone ?? false,
    };
    // Imported data is NOT trusted: status is recomputed, not copied.
    const orderDone = resolveOrderDone(fields);
    const status = deriveStatus({ ...fields, orderDone });

    statements.push(
      stmt(
        env,
        `INSERT INTO transactions (
           id, user_id, ledger_day_id, sr_number, customer_id, customer_name_snapshot,
           inr_amount, inr_received, usdt_amount, final_rub_amount, extras_amount,
           order_done, status, note, sort_order, is_deleted, deleted_at,
           created_at, updated_at, client_created_at, sync_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)
         ON CONFLICT(id) DO NOTHING`,
        [
          t.id,
          session.userId,
          dayId,
          t.srNumber,
          t.customerId ?? null,
          t.customerNameSnapshot ?? null,
          t.inrAmount ?? null,
          boolToInt(t.inrReceived ?? false),
          t.usdtAmount ?? null,
          t.finalRubAmount ?? null,
          t.extrasAmount ?? null,
          boolToInt(orderDone),
          status,
          t.note ?? null,
          t.sortOrder,
          boolToInt(t.isDeleted ?? false),
          t.createdAt,
          t.updatedAt,
          t.clientCreatedAt ?? t.createdAt,
        ],
      ),
    );
    txInserted += 1;
  }

  statements.push(
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'IMPORT_RESTORED',
        resourceType: 'backup_record',
        resourceId: null,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { customersInserted, daysInserted, txInserted, txSkipped },
      },
      now,
    ),
  );

  // D1 batch has a practical statement ceiling; chunk to stay safe.
  const CHUNK = 60;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await batch(env, statements.slice(i, i + CHUNK));
  }

  return json({
    ok: true,
    customers: customersInserted,
    ledgerDays: daysInserted,
    transactions: txInserted,
    skipped: txSkipped,
  });
}

export { writeAudit };

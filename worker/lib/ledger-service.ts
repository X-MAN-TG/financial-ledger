/**
 * Core ledger write path, shared by the REST transaction routes (Phase 5)
 * and the offline sync batch endpoint (Phase 6), so both go through exactly
 * the same validation, state machine, ownership and idempotency rules.
 *
 * Key guarantees implemented here:
 *  - status is ALWAYS recomputed server-side (07 section 3.6)
 *  - order_done is rejected unless completion requirements are met (07 3.4/8)
 *  - operationId replay returns the prior result (03 section 13, 13 s5.4)
 *  - last-write-wins by updated_at with a conflict flag (05 s5, 13 s7.2)
 *  - mutation + audit row land in the same D1 batch (12 section 6.1)
 */
import {
  deriveStatus,
  meetsCompletionRequirements,
  missingCompletionFields,
  resolveOrderDone,
} from '../../shared/business-rules';
import type { LedgerDay, Transaction } from '../../shared/types';
import type { SyncOperationType } from '../../shared/constants';
import {
  transactionCreateSchema,
  transactionUpdateSchema,
  type TransactionCreateInput,
  type TransactionUpdateInput,
} from '../../shared/validation';
import { auditStatement } from './audit';
import type { Env } from './config';
import {
  batch,
  boolToInt,
  mapLedgerDay,
  mapTransaction,
  queryAll,
  queryFirst,
  stmt,
} from './db';
import { ApiException, conflict, notFound } from './http';
import { newId } from './crypto';

export interface OperationOutcome {
  status: 'APPLIED' | 'DUPLICATE_IGNORED' | 'REJECTED';
  transaction?: Transaction;
  conflict?: boolean;
  error?: { code: string; message: string };
}

/* ------------------------------------------------------- idempotency ---- */

interface SyncOpRow {
  id: string;
  user_id: string;
  transaction_id: string;
  operation_type: string;
  result: string;
}

/**
 * Has this operationId already been applied for this user? Scoped by
 * user_id so one user can never probe/replay another user's op ids.
 */
export async function findAppliedOperation(
  env: Env,
  userId: string,
  operationId: string,
): Promise<SyncOpRow | null> {
  return queryFirst<SyncOpRow>(
    env,
    'SELECT * FROM sync_operations WHERE id = ? AND user_id = ?',
    [operationId, userId],
  );
}

export function recordOperationStatement(
  env: Env,
  operationId: string,
  userId: string,
  transactionId: string,
  type: SyncOperationType,
  result: 'APPLIED' | 'DUPLICATE_IGNORED' | 'REJECTED',
  at: number,
): D1PreparedStatement {
  return stmt(
    env,
    `INSERT INTO sync_operations (id, user_id, transaction_id, operation_type, applied_at, result)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [operationId, userId, transactionId, type, at, result],
  );
}

/* --------------------------------------------------------- ledger day ---- */

/**
 * Lazily create the (user, date) ledger day (06 section 2.1). Uses an
 * idempotent INSERT so two concurrent devices opening the same date cannot
 * create two rows; the UNIQUE(user_id, date) index is the backstop.
 */
export async function ensureLedgerDay(
  env: Env,
  userId: string,
  date: string,
  preferredId?: string,
): Promise<LedgerDay> {
  const existing = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM ledger_days WHERE user_id = ? AND date = ?',
    [userId, date],
  );
  if (existing) return mapLedgerDay(existing);

  const now = Date.now();
  const id = preferredId ?? newId();
  await env.DB.prepare(
    `INSERT INTO ledger_days (id, user_id, date, status, created_at, updated_at)
     VALUES (?, ?, ?, 'TRADING_DAY', ?, ?)
     ON CONFLICT(user_id, date) DO NOTHING`,
  )
    .bind(id, userId, date, now, now)
    .run();

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM ledger_days WHERE user_id = ? AND date = ?',
    [userId, date],
  );
  if (!row) throw notFound('Ledger day could not be created');
  return mapLedgerDay(row);
}

export async function listDayTransactions(
  env: Env,
  userId: string,
  ledgerDayId: string,
  includeDeleted = false,
): Promise<Transaction[]> {
  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND t.ledger_day_id = ?${includeDeleted ? '' : ' AND t.is_deleted = 0'}
      ORDER BY t.sort_order ASC, t.created_at ASC`,
    [userId, ledgerDayId],
  );
  return rows.map(mapTransaction);
}

/** Attach owner-defined custom column values, keyed by column key. */
export async function attachCustomValues(
  env: Env,
  transactions: Transaction[],
): Promise<Transaction[]> {
  if (transactions.length === 0) return transactions;
  const ids = transactions.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await queryAll<{ transaction_id: string; key: string; value: string | null }>(
    env,
    `SELECT v.transaction_id, c.key, v.value
       FROM transaction_custom_values v
       JOIN column_definitions c ON c.id = v.column_id
      WHERE v.transaction_id IN (${placeholders})`,
    ids,
  );
  if (rows.length === 0) return transactions;
  const byTx = new Map<string, Record<string, string | null>>();
  for (const r of rows) {
    const bag = byTx.get(r.transaction_id) ?? {};
    bag[r.key] = r.value;
    byTx.set(r.transaction_id, bag);
  }
  return transactions.map((t) => {
    const cv = byTx.get(t.id);
    return cv ? { ...t, customValues: cv } : t;
  });
}

async function customValueStatements(
  env: Env,
  transactionId: string,
  customValues: Record<string, string | null> | undefined,
  at: number,
): Promise<D1PreparedStatement[]> {
  if (!customValues || Object.keys(customValues).length === 0) return [];
  const keys = Object.keys(customValues);
  const placeholders = keys.map(() => '?').join(',');
  // Only active, non-system columns may receive values.
  const cols = await queryAll<{ id: string; key: string }>(
    env,
    `SELECT id, key FROM column_definitions
      WHERE key IN (${placeholders}) AND is_system = 0 AND is_active = 1`,
    keys,
  );
  const out: D1PreparedStatement[] = [];
  for (const col of cols) {
    const value = customValues[col.key] ?? null;
    out.push(
      stmt(
        env,
        `INSERT INTO transaction_custom_values (id, transaction_id, column_id, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(transaction_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [newId(), transactionId, col.id, value, at, at],
      ),
    );
  }
  return out;
}

/* ------------------------------------------------------------- create ---- */

export async function applyCreate(
  env: Env,
  userId: string,
  input: TransactionCreateInput,
): Promise<OperationOutcome> {
  const prior = await findAppliedOperation(env, userId, input.operationId);
  if (prior) {
    const existing = await queryFirst<Record<string, unknown>>(
      env,
      `SELECT t.*, d.date AS date FROM transactions t
         JOIN ledger_days d ON d.id = t.ledger_day_id
        WHERE t.id = ? AND t.user_id = ?`,
      [prior.transaction_id, userId],
    );
    return {
      status: 'DUPLICATE_IGNORED',
      transaction: existing ? mapTransaction(existing) : undefined,
    };
  }

  // Same row id arriving twice (client retried with a fresh operationId):
  // still must not create a second row - the id IS the identity (13 s2.2).
  const byId = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.id = ?`,
    [input.id],
  );
  if (byId) {
    if (String(byId.user_id) !== userId) {
      // Another user owns this id: refuse without confirming existence.
      return {
        status: 'REJECTED',
        error: { code: 'NOT_FOUND', message: 'Transaction not found' },
      };
    }
    const now = Date.now();
    await batch(env, [
      recordOperationStatement(env, input.operationId, userId, input.id, 'CREATE', 'DUPLICATE_IGNORED', now),
    ]);
    return { status: 'DUPLICATE_IGNORED', transaction: mapTransaction(byId) };
  }

  const day = await ensureLedgerDay(env, userId, input.date, input.ledgerDayId);

  // Verify a supplied customer belongs to the caller and snapshot its name.
  let customerId: string | null = input.customerId ?? null;
  let snapshot = input.customerNameSnapshot ?? null;
  if (customerId) {
    const cust = await queryFirst<{ id: string; name: string }>(
      env,
      'SELECT id, name FROM customers WHERE id = ? AND user_id = ?',
      [customerId, userId],
    );
    if (!cust) {
      customerId = null; // Unknown/foreign customer id is dropped, not trusted.
    } else if (!snapshot) {
      snapshot = cust.name;
    }
  }

  const fields = {
    customerNameSnapshot: snapshot,
    inrAmount: input.inrAmount ?? null,
    usdtAmount: input.usdtAmount ?? null,
    finalRubAmount: input.finalRubAmount ?? null,
    orderDone: input.orderDone,
  };

  // Reject a completion attempt that does not satisfy 07 section 3.4.
  if (input.orderDone && !meetsCompletionRequirements(fields)) {
    const now = Date.now();
    await batch(env, [
      recordOperationStatement(env, input.operationId, userId, input.id, 'CREATE', 'REJECTED', now),
      auditStatement(
        env,
        {
          userId,
          actorRole: 'USER',
          action: 'TRANSACTION_COMPLETION_REJECTED',
          resourceType: 'transaction',
          resourceId: input.id,
          scope: 'USER',
          result: 'FAILURE',
          metadata: { missing: missingCompletionFields(fields), phase: 'CREATE' },
        },
        now,
      ),
    ]);
    return {
      status: 'REJECTED',
      error: {
        code: 'COMPLETION_REQUIREMENTS_UNMET',
        message: 'Customer name, INR, USDT and Final RUB are required to mark an order done',
      },
    };
  }

  const orderDone = resolveOrderDone(fields);
  const status = deriveStatus({ ...fields, orderDone });
  const now = Date.now();

  const statements: D1PreparedStatement[] = [
    stmt(
      env,
      `INSERT INTO transactions (
         id, user_id, ledger_day_id, sr_number, customer_id, customer_name_snapshot,
         inr_amount, inr_received, usdt_amount, final_rub_amount, extras_amount,
         order_done, status, note, attachments, sort_order, is_deleted, deleted_at,
         created_at, updated_at, client_created_at, sync_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 1)`,
      [
        input.id,
        userId,
        day.id,
        input.srNumber,
        customerId,
        snapshot,
        input.inrAmount ?? null,
        boolToInt(input.inrReceived),
        input.usdtAmount ?? null,
        input.finalRubAmount ?? null,
        input.extrasAmount ?? null,
        boolToInt(orderDone),
        status,
        input.note ?? null,
        JSON.stringify(input.attachments ?? []),
        input.sortOrder,
        now,
        now,
        input.clientCreatedAt,
      ],
    ),
    ...(await customValueStatements(env, input.id, input.customValues, now)),
    recordOperationStatement(env, input.operationId, userId, input.id, 'CREATE', 'APPLIED', now),
    auditStatement(
      env,
      {
        userId,
        actorRole: 'USER',
        action: 'TRANSACTION_CREATED',
        resourceType: 'transaction',
        resourceId: input.id,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { date: input.date, srNumber: input.srNumber, status },
      },
      now,
    ),
  ];
  if (input.note && input.note.trim()) {
    statements.push(
      auditStatement(
        env,
        {
          userId,
          actorRole: 'USER',
          action: 'NOTE_ADDED',
          resourceType: 'transaction',
          resourceId: input.id,
          scope: 'USER',
          result: 'SUCCESS',
        },
        now,
      ),
    );
  }

  await batch(env, statements);

  const created = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id WHERE t.id = ?`,
    [input.id],
  );
  return { status: 'APPLIED', transaction: created ? mapTransaction(created) : undefined };
}

/* ------------------------------------------------------------- update ---- */

export async function applyUpdate(
  env: Env,
  userId: string,
  transactionId: string,
  input: TransactionUpdateInput,
): Promise<OperationOutcome> {
  const prior = await findAppliedOperation(env, userId, input.operationId);
  if (prior) {
    const existing = await queryFirst<Record<string, unknown>>(
      env,
      `SELECT t.*, d.date AS date FROM transactions t
         JOIN ledger_days d ON d.id = t.ledger_day_id
        WHERE t.id = ? AND t.user_id = ?`,
      [prior.transaction_id, userId],
    );
    return {
      status: 'DUPLICATE_IGNORED',
      transaction: existing ? mapTransaction(existing) : undefined,
    };
  }

  const currentRow = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.id = ? AND t.user_id = ?`,
    [transactionId, userId],
  );
  if (!currentRow) throw notFound('Transaction not found');
  const current = mapTransaction(currentRow);

  /**
   * Last-write-wins (05 section 5 conflict rule, 13 section 7.2).
   * A stale syncVersion means another device already advanced this row.
   * We compare client intent time against the server's updated_at: an older
   * edit loses and is reported back as a conflict rather than silently
   * overwriting the newer state.
   */
  let conflicted = false;
  if (input.syncVersion !== undefined && input.syncVersion < current.syncVersion) {
    const clientTime = input.clientUpdatedAt ?? 0;
    if (clientTime <= current.updatedAt) {
      const now = Date.now();
      await batch(env, [
        recordOperationStatement(
          env,
          input.operationId,
          userId,
          transactionId,
          'UPDATE',
          'REJECTED',
          now,
        ),
        auditStatement(
          env,
          {
            userId,
            actorRole: 'USER',
            action: 'SYNC_CONFLICT_DETECTED',
            resourceType: 'transaction',
            resourceId: transactionId,
            scope: 'USER',
            result: 'FAILURE',
            metadata: {
              incomingVersion: input.syncVersion,
              serverVersion: current.syncVersion,
            },
          },
          now,
        ),
      ]);
      throw new ApiException(
        409,
        'STALE_VERSION',
        'This row was updated on another device',
      );
    }
    conflicted = true; // Newer client wins, but tell the caller it collided.
  }

  const next = {
    customerId: input.customerId !== undefined ? input.customerId : current.customerId,
    customerNameSnapshot:
      input.customerNameSnapshot !== undefined
        ? input.customerNameSnapshot
        : current.customerNameSnapshot,
    inrAmount: input.inrAmount !== undefined ? input.inrAmount : current.inrAmount,
    inrReceived: input.inrReceived !== undefined ? input.inrReceived : current.inrReceived,
    usdtAmount: input.usdtAmount !== undefined ? input.usdtAmount : current.usdtAmount,
    finalRubAmount:
      input.finalRubAmount !== undefined ? input.finalRubAmount : current.finalRubAmount,
    extrasAmount: input.extrasAmount !== undefined ? input.extrasAmount : current.extrasAmount,
    orderDone: input.orderDone !== undefined ? input.orderDone : current.orderDone,
    note: input.note !== undefined ? input.note : current.note,
    attachments: input.attachments !== undefined ? input.attachments : current.attachments,
    srNumber: input.srNumber !== undefined ? input.srNumber : current.srNumber,
    sortOrder: input.sortOrder !== undefined ? input.sortOrder : current.sortOrder,
  };

  if (next.customerId && next.customerId !== current.customerId) {
    const cust = await queryFirst<{ id: string; name: string }>(
      env,
      'SELECT id, name FROM customers WHERE id = ? AND user_id = ?',
      [next.customerId, userId],
    );
    if (!cust) {
      next.customerId = null;
    } else if (input.customerNameSnapshot === undefined) {
      next.customerNameSnapshot = cust.name;
    }
  }

  // Explicit attempt to check Order Done without the required fields.
  if (input.orderDone === true && !meetsCompletionRequirements(next)) {
    const now = Date.now();
    await batch(env, [
      recordOperationStatement(
        env,
        input.operationId,
        userId,
        transactionId,
        'UPDATE',
        'REJECTED',
        now,
      ),
      auditStatement(
        env,
        {
          userId,
          actorRole: 'USER',
          action: 'TRANSACTION_COMPLETION_REJECTED',
          resourceType: 'transaction',
          resourceId: transactionId,
          scope: 'USER',
          result: 'FAILURE',
          metadata: { missing: missingCompletionFields(next), phase: 'UPDATE' },
        },
        now,
      ),
    ]);
    return {
      status: 'REJECTED',
      error: {
        code: 'COMPLETION_REQUIREMENTS_UNMET',
        message: 'Customer name, INR, USDT and Final RUB are required to mark an order done',
      },
    };
  }

  /**
   * 07 section 3.5: clearing a required field on a COMPLETED row must not
   * leave order_done stuck true. resolveOrderDone re-derives it from the
   * resulting field set, so the row falls back to READY/INCOMPLETE.
   */
  const orderDone = resolveOrderDone(next);
  const status = deriveStatus({ ...next, orderDone });
  const now = Date.now();

  const statements: D1PreparedStatement[] = [
    stmt(
      env,
      `UPDATE transactions SET
         customer_id = ?, customer_name_snapshot = ?, inr_amount = ?, inr_received = ?,
         usdt_amount = ?, final_rub_amount = ?, extras_amount = ?, order_done = ?,
         status = ?, note = ?, attachments = ?, sr_number = ?, sort_order = ?,
         updated_at = ?, sync_version = sync_version + 1
       WHERE id = ? AND user_id = ?`,
      [
        next.customerId,
        next.customerNameSnapshot,
        next.inrAmount,
        boolToInt(next.inrReceived),
        next.usdtAmount,
        next.finalRubAmount,
        next.extrasAmount,
        boolToInt(orderDone),
        status,
        next.note,
        JSON.stringify(next.attachments ?? []),
        next.srNumber,
        next.sortOrder,
        now,
        transactionId,
        userId,
      ],
    ),
    ...(await customValueStatements(env, transactionId, input.customValues, now)),
    recordOperationStatement(env, input.operationId, userId, transactionId, 'UPDATE', 'APPLIED', now),
    auditStatement(
      env,
      {
        userId,
        actorRole: 'USER',
        action: 'TRANSACTION_UPDATED',
        resourceType: 'transaction',
        resourceId: transactionId,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { status, fields: Object.keys(input).filter((k) => k !== 'operationId') },
      },
      now,
    ),
  ];

  // Note lifecycle auditing (07 section 7.3).
  if (input.note !== undefined) {
    const had = Boolean(current.note && current.note.trim());
    const has = Boolean(input.note && String(input.note).trim());
    const action = !had && has ? 'NOTE_ADDED' : had && !has ? 'NOTE_REMOVED' : had && has ? 'NOTE_EDITED' : null;
    if (action) {
      statements.push(
        auditStatement(
          env,
          {
            userId,
            actorRole: 'USER',
            action,
            resourceType: 'transaction',
            resourceId: transactionId,
            scope: 'USER',
            result: 'SUCCESS',
          },
          now,
        ),
      );
    }
  }

  await batch(env, statements);

  const updated = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id WHERE t.id = ?`,
    [transactionId],
  );
  return {
    status: 'APPLIED',
    transaction: updated ? mapTransaction(updated) : undefined,
    conflict: conflicted,
  };
}

/* ------------------------------------------------- delete / restore ---- */

export async function applyDelete(
  env: Env,
  userId: string,
  transactionId: string,
  operationId: string,
): Promise<OperationOutcome> {
  const prior = await findAppliedOperation(env, userId, operationId);
  if (prior) {
    const existing = await queryFirst<Record<string, unknown>>(
      env,
      `SELECT t.*, d.date AS date FROM transactions t
         JOIN ledger_days d ON d.id = t.ledger_day_id WHERE t.id = ? AND t.user_id = ?`,
      [prior.transaction_id, userId],
    );
    return {
      status: 'DUPLICATE_IGNORED',
      transaction: existing ? mapTransaction(existing) : undefined,
    };
  }

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
    [transactionId, userId],
  );
  if (!row) throw notFound('Transaction not found');

  const now = Date.now();
  await batch(env, [
    stmt(
      env,
      `UPDATE transactions SET is_deleted = 1, deleted_at = ?, updated_at = ?,
              sync_version = sync_version + 1
        WHERE id = ? AND user_id = ?`,
      [now, now, transactionId, userId],
    ),
    recordOperationStatement(env, operationId, userId, transactionId, 'DELETE', 'APPLIED', now),
    auditStatement(
      env,
      {
        userId,
        actorRole: 'USER',
        action: 'TRANSACTION_DELETED',
        resourceType: 'transaction',
        resourceId: transactionId,
        scope: 'USER',
        result: 'SUCCESS',
      },
      now,
    ),
  ]);

  const updated = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id WHERE t.id = ?`,
    [transactionId],
  );
  return { status: 'APPLIED', transaction: updated ? mapTransaction(updated) : undefined };
}

export async function applyRestore(
  env: Env,
  userId: string,
  transactionId: string,
  operationId: string,
): Promise<OperationOutcome> {
  const prior = await findAppliedOperation(env, userId, operationId);
  if (prior) {
    const existing = await queryFirst<Record<string, unknown>>(
      env,
      `SELECT t.*, d.date AS date FROM transactions t
         JOIN ledger_days d ON d.id = t.ledger_day_id WHERE t.id = ? AND t.user_id = ?`,
      [prior.transaction_id, userId],
    );
    return {
      status: 'DUPLICATE_IGNORED',
      transaction: existing ? mapTransaction(existing) : undefined,
    };
  }

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
    [transactionId, userId],
  );
  if (!row) throw notFound('Transaction not found');

  const now = Date.now();
  await batch(env, [
    stmt(
      env,
      `UPDATE transactions SET is_deleted = 0, deleted_at = NULL, updated_at = ?,
              sync_version = sync_version + 1
        WHERE id = ? AND user_id = ?`,
      [now, transactionId, userId],
    ),
    recordOperationStatement(env, operationId, userId, transactionId, 'RESTORE', 'APPLIED', now),
    auditStatement(
      env,
      {
        userId,
        actorRole: 'USER',
        action: 'TRANSACTION_RESTORED',
        resourceType: 'transaction',
        resourceId: transactionId,
        scope: 'USER',
        result: 'SUCCESS',
      },
      now,
    ),
  ]);

  const updated = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id WHERE t.id = ?`,
    [transactionId],
  );
  return { status: 'APPLIED', transaction: updated ? mapTransaction(updated) : undefined };
}

/** Irreversible hard delete, used only by the Trash "permanently delete". */
export async function purgeTransaction(
  env: Env,
  userId: string,
  transactionId: string,
): Promise<void> {
  const row = await queryFirst<{ id: string; is_deleted: number }>(
    env,
    'SELECT id, is_deleted FROM transactions WHERE id = ? AND user_id = ?',
    [transactionId, userId],
  );
  if (!row) throw notFound('Transaction not found');
  if (!row.is_deleted) {
    throw conflict('CONFLICT', 'Move the transaction to Trash before deleting it permanently');
  }
  const now = Date.now();
  await batch(env, [
    stmt(env, 'DELETE FROM transaction_custom_values WHERE transaction_id = ?', [transactionId]),
    stmt(env, 'DELETE FROM transactions WHERE id = ? AND user_id = ?', [transactionId, userId]),
    auditStatement(
      env,
      {
        userId,
        actorRole: 'USER',
        action: 'TRANSACTION_PURGED',
        resourceType: 'transaction',
        resourceId: transactionId,
        scope: 'USER',
        result: 'SUCCESS',
      },
      now,
    ),
  ]);
}

export { transactionCreateSchema, transactionUpdateSchema };

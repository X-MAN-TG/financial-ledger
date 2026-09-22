/**
 * Transaction routes (05 section 5). All logic lives in ledger-service so
 * the REST path and the sync-batch path cannot diverge.
 */
import {
  operationOnlySchema,
  transactionCreateSchema,
  transactionReorderSchema,
  transactionUpdateSchema,
  pageSchema,
  pageSizeSchema,
} from '../../shared/validation';
import { z } from 'zod';
import type { Env } from '../lib/config';
import { auditStatement } from '../lib/audit';
import { batch, mapTransaction, queryAll, stmt } from '../lib/db';
import { ApiException, json } from '../lib/http';
import {
  applyCreate,
  applyDelete,
  applyRestore,
  applyUpdate,
  purgeTransaction,
} from '../lib/ledger-service';
import type { SessionContext } from '../middleware/auth';
import { parseBody, parseQuery } from '../middleware/validation';

function outcomeToResponse(
  outcome: Awaited<ReturnType<typeof applyCreate>>,
  createdStatus = 201,
): Response {
  if (outcome.status === 'REJECTED') {
    throw new ApiException(
      outcome.error?.code === 'NOT_FOUND' ? 404 : 400,
      outcome.error?.code ?? 'VALIDATION_ERROR',
      outcome.error?.message ?? 'Operation rejected',
    );
  }
  // Idempotent replay returns 200 with the original record (05 section 5).
  return json(
    { transaction: outcome.transaction, replayed: outcome.status === 'DUPLICATE_IGNORED' },
    outcome.status === 'DUPLICATE_IGNORED' ? 200 : createdStatus,
  );
}

export async function createTransaction(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, transactionCreateSchema);
  const outcome = await applyCreate(env, session.userId, body);
  return outcomeToResponse(outcome, 201);
}

export async function updateTransaction(
  req: Request,
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  const body = await parseBody(req, transactionUpdateSchema);
  const outcome = await applyUpdate(env, session.userId, id, body);
  if (outcome.status === 'REJECTED') {
    throw new ApiException(
      400,
      outcome.error?.code ?? 'VALIDATION_ERROR',
      outcome.error?.message ?? 'Operation rejected',
    );
  }
  return json({
    transaction: outcome.transaction,
    replayed: outcome.status === 'DUPLICATE_IGNORED',
    conflict: Boolean(outcome.conflict),
  });
}

export async function deleteTransaction(
  req: Request,
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  const body = await parseBody(req, operationOnlySchema);
  const outcome = await applyDelete(env, session.userId, id, body.operationId);
  return json({
    transaction: outcome.transaction,
    replayed: outcome.status === 'DUPLICATE_IGNORED',
  });
}

export async function restoreTransaction(
  req: Request,
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  const body = await parseBody(req, operationOnlySchema);
  const outcome = await applyRestore(env, session.userId, id, body.operationId);
  return json({
    transaction: outcome.transaction,
    replayed: outcome.status === 'DUPLICATE_IGNORED',
  });
}

export async function purgeTransactionRoute(
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  await purgeTransaction(env, session.userId, id);
  return json({ ok: true, id });
}

/** GET /api/transactions/trash - soft-deleted rows (07 section 6.2). */
export async function listTrash(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, z.object({ page: pageSchema, pageSize: pageSizeSchema }));
  const offset = (q.page - 1) * q.pageSize;

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND t.is_deleted = 1
      ORDER BY t.deleted_at DESC
      LIMIT ? OFFSET ?`,
    [session.userId, q.pageSize, offset],
  );
  const totalRow = await queryAll<{ c: number }>(
    env,
    'SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND is_deleted = 1',
    [session.userId],
  );

  return json({
    items: rows.map(mapTransaction),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow[0] ? Number(totalRow[0].c) : 0,
  });
}

/**
 * POST /api/transactions/reorder - persists a new sort order for one day
 * and recomputes sr_number from the resulting order (07 section 4.3).
 */
export async function reorderTransactions(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, transactionReorderSchema);
  const placeholders = body.order.map(() => '?').join(',');
  const owned = await queryAll<{ id: string }>(
    env,
    `SELECT id FROM transactions WHERE user_id = ? AND id IN (${placeholders})`,
    [session.userId, ...body.order],
  );
  const ownedIds = new Set(owned.map((r) => r.id));
  const now = Date.now();

  const statements = body.order
    .filter((id) => ownedIds.has(id))
    .map((id, index) =>
      stmt(
        env,
        `UPDATE transactions SET sort_order = ?, sr_number = ?, updated_at = ?,
                sync_version = sync_version + 1
          WHERE id = ? AND user_id = ?`,
        [index, index + 1, now, id, session.userId],
      ),
    );

  statements.push(
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'TRANSACTION_UPDATED',
        resourceType: 'transaction',
        resourceId: null,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { operation: 'REORDER', count: statements.length },
      },
      now,
    ),
  );

  await batch(env, statements);
  return json({ ok: true, count: statements.length - 1 });
}

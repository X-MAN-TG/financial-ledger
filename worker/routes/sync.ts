/**
 * POST /api/sync/batch - the offline queue flush endpoint
 * (05 section 6, 13-offline-first-and-sync.txt section 5).
 *
 * Contract highlights:
 *  - operations are applied IN ORDER, one at a time
 *  - each result is APPLIED | DUPLICATE_IGNORED | REJECTED, per operationId
 *  - a REJECTED op never aborts the rest of the batch (the client needs
 *    per-op resolution so one bad row cannot block the whole queue)
 *  - one summarized audit entry per batch, not one per op (12 section 6.3)
 */
import type {
  SyncBatchResponse,
  SyncOperationResultItem,
} from '../../shared/types';
import {
  customerCreateSchema,
  ledgerDayCreateSchema,
  operationOnlySchema,
  syncBatchSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
  uuidSchema,
} from '../../shared/validation';
import { writeAudit } from '../lib/audit';
import type { Env } from '../lib/config';
import { mapLedgerDay, queryFirst } from '../lib/db';
import { ApiException, json } from '../lib/http';
import {
  applyCreate,
  applyDelete,
  applyRestore,
  applyUpdate,
  ensureLedgerDay,
} from '../lib/ledger-service';
import { upsertCustomerFromSync, deleteCustomerById } from '../lib/customer-service';
import type { SessionContext } from '../middleware/auth';
import { parseBody, safeParseWith } from '../middleware/validation';

export async function syncBatch(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, syncBatchSchema);
  const results: SyncOperationResultItem[] = [];

  let applied = 0;
  let duplicates = 0;
  let rejected = 0;

  for (const op of body.operations) {
    try {
      const result = await applyOne(env, session, op);
      results.push(result);
      if (result.status === 'APPLIED') applied += 1;
      else if (result.status === 'DUPLICATE_IGNORED') duplicates += 1;
      else rejected += 1;
    } catch (e) {
      rejected += 1;
      const isApi = e instanceof ApiException;
      results.push({
        operationId: op.operationId,
        status: 'REJECTED',
        entity: op.entity,
        entityId: String((op.payload as { id?: string }).id ?? ''),
        error: {
          code: isApi ? String(e.code) : 'INTERNAL_ERROR',
          // Safe message only - never leak internals to the client (13 s5.2).
          message: isApi ? e.message : 'Could not apply this change',
        },
      });
      if (!isApi) {
        console.error('SYNC_OP_FAILED', op.type, op.entity, e instanceof Error ? e.message : e);
      }
    }
  }

  await writeAudit(env, {
    userId: session.userId,
    actorRole: 'USER',
    action: 'SYNC_BATCH_APPLIED',
    resourceType: 'sync_batch',
    resourceId: null,
    scope: 'USER',
    result: rejected > 0 ? 'FAILURE' : 'SUCCESS',
    metadata: { total: body.operations.length, applied, duplicates, rejected },
  });

  const response: SyncBatchResponse = { results, serverTime: Date.now() };
  return json(response);
}

async function applyOne(
  env: Env,
  session: SessionContext,
  op: { operationId: string; type: string; entity: string; payload: Record<string, unknown> },
): Promise<SyncOperationResultItem> {
  const base = { operationId: op.operationId, entity: op.entity as 'transaction' };

  if (op.entity === 'transaction') {
    if (op.type === 'CREATE') {
      const parsed = safeParseWith(transactionCreateSchema, {
        ...op.payload,
        operationId: op.operationId,
      });
      if (!parsed.ok) {
        return {
          ...base,
          entityId: String(op.payload.id ?? ''),
          status: 'REJECTED',
          error: { code: 'VALIDATION_ERROR', message: parsed.message },
        };
      }
      const outcome = await applyCreate(env, session.userId, parsed.data);
      return {
        ...base,
        entityId: parsed.data.id,
        status: outcome.status,
        record: outcome.transaction,
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    }

    const idParse = safeParseWith(uuidSchema, op.payload.id);
    if (!idParse.ok) {
      return {
        ...base,
        entityId: String(op.payload.id ?? ''),
        status: 'REJECTED',
        error: { code: 'VALIDATION_ERROR', message: 'Missing transaction id' },
      };
    }
    const txId = idParse.data;

    if (op.type === 'UPDATE') {
      const parsed = safeParseWith(transactionUpdateSchema, {
        ...op.payload,
        operationId: op.operationId,
      });
      if (!parsed.ok) {
        return {
          ...base,
          entityId: txId,
          status: 'REJECTED',
          error: { code: 'VALIDATION_ERROR', message: parsed.message },
        };
      }
      try {
        const outcome = await applyUpdate(env, session.userId, txId, parsed.data);
        return {
          ...base,
          entityId: txId,
          status: outcome.status,
          record: outcome.transaction,
          conflict: outcome.conflict,
          ...(outcome.error ? { error: outcome.error } : {}),
        };
      } catch (e) {
        // A stale-version loss is reported as a conflict, not a hard failure,
        // so the client can show "changed elsewhere" and reconcile (13 s7.2).
        if (e instanceof ApiException && e.code === 'STALE_VERSION') {
          const current = await queryFirst<Record<string, unknown>>(
            env,
            `SELECT t.*, d.date AS date FROM transactions t
               JOIN ledger_days d ON d.id = t.ledger_day_id
              WHERE t.id = ? AND t.user_id = ?`,
            [txId, session.userId],
          );
          const { mapTransaction } = await import('../lib/db');
          return {
            ...base,
            entityId: txId,
            status: 'REJECTED',
            conflict: true,
            record: current ? mapTransaction(current) : undefined,
            error: { code: 'STALE_VERSION', message: 'This row was updated on another device' },
          };
        }
        throw e;
      }
    }

    if (op.type === 'DELETE') {
      const parsed = safeParseWith(operationOnlySchema, { operationId: op.operationId });
      if (!parsed.ok) {
        return {
          ...base,
          entityId: txId,
          status: 'REJECTED',
          error: { code: 'VALIDATION_ERROR', message: parsed.message },
        };
      }
      const outcome = await applyDelete(env, session.userId, txId, op.operationId);
      return { ...base, entityId: txId, status: outcome.status, record: outcome.transaction };
    }

    if (op.type === 'RESTORE') {
      const outcome = await applyRestore(env, session.userId, txId, op.operationId);
      return { ...base, entityId: txId, status: outcome.status, record: outcome.transaction };
    }
  }

  if (op.entity === 'ledgerDay') {
    const parsed = safeParseWith(ledgerDayCreateSchema, op.payload);
    if (!parsed.ok) {
      return {
        operationId: op.operationId,
        entity: 'ledgerDay',
        entityId: String(op.payload.id ?? ''),
        status: 'REJECTED',
        error: { code: 'VALIDATION_ERROR', message: parsed.message },
      };
    }
    const day = await ensureLedgerDay(env, session.userId, parsed.data.date, parsed.data.id);

    // Sync any changes to status, note, attachments, or usdtRate.
    const hasStatusChange = parsed.data.status !== day.status;
    const hasNoteChange = parsed.data.note !== undefined && parsed.data.note !== day.note;
    const hasAttachmentsChange =
      parsed.data.attachments !== undefined &&
      JSON.stringify(parsed.data.attachments) !== JSON.stringify(day.attachments ?? []);
    const hasUsdtRateChange =
      parsed.data.usdtRate !== undefined && parsed.data.usdtRate !== day.usdtRate;

    if (hasStatusChange || hasNoteChange || hasAttachmentsChange || hasUsdtRateChange) {
      const now = Date.now();
      const nextStatus = parsed.data.status ?? day.status;
      const nextNote = parsed.data.note !== undefined ? parsed.data.note : (day.note ?? null);
      const nextAttachments =
        parsed.data.attachments !== undefined ? parsed.data.attachments : (day.attachments ?? []);
      const nextUsdtRate =
        parsed.data.usdtRate !== undefined ? parsed.data.usdtRate : (day.usdtRate ?? 0);

      const { execute } = await import('../lib/db');
      await execute(
        env,
        'UPDATE ledger_days SET status = ?, note = ?, attachments = ?, usdt_rate = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [nextStatus, nextNote, JSON.stringify(nextAttachments), nextUsdtRate, now, day.id, session.userId],
      );
      if (hasStatusChange) {
        await writeAudit(env, {
          userId: session.userId,
          actorRole: 'USER',
          action: parsed.data.status === 'DAY_OFF' ? 'DAY_MARKED_OFF' : 'DAY_REOPENED',
          resourceType: 'ledger_day',
          resourceId: day.id,
          scope: 'USER',
          result: 'SUCCESS',
          metadata: { date: parsed.data.date, via: 'SYNC' },
        });
      }
      const fresh = await queryFirst<Record<string, unknown>>(
        env,
        'SELECT * FROM ledger_days WHERE id = ?',
        [day.id],
      );
      return {
        operationId: op.operationId,
        entity: 'ledgerDay',
        entityId: day.id,
        status: 'APPLIED',
        record: fresh ? mapLedgerDay(fresh) : day,
      };
    }

    return {
      operationId: op.operationId,
      entity: 'ledgerDay',
      entityId: day.id,
      status: 'APPLIED',
      record: day,
    };
  }

  if (op.entity === 'customer') {
    if (op.type === 'DELETE') {
      const idParse = safeParseWith(uuidSchema, op.payload.id);
      if (!idParse.ok) {
        return {
          operationId: op.operationId,
          entity: 'customer',
          entityId: '',
          status: 'REJECTED',
          error: { code: 'VALIDATION_ERROR', message: 'Missing customer id' },
        };
      }
      const record = await deleteCustomerById(env, session.userId, idParse.data);
      return {
        operationId: op.operationId,
        entity: 'customer',
        entityId: idParse.data,
        status: 'APPLIED',
        record,
      };
    }

    const parsed = safeParseWith(customerCreateSchema, op.payload);
    if (!parsed.ok) {
      return {
        operationId: op.operationId,
        entity: 'customer',
        entityId: String(op.payload.id ?? ''),
        status: 'REJECTED',
        error: { code: 'VALIDATION_ERROR', message: parsed.message },
      };
    }
    const record = await upsertCustomerFromSync(env, session.userId, parsed.data);
    return {
      operationId: op.operationId,
      entity: 'customer',
      entityId: record.id,
      status: 'APPLIED',
      record,
    };
  }

  return {
    operationId: op.operationId,
    entity: op.entity as 'transaction',
    entityId: '',
    status: 'REJECTED',
    error: { code: 'VALIDATION_ERROR', message: `Unsupported operation ${op.type}/${op.entity}` },
  };
}

export async function syncStatus(env: Env, session: SessionContext): Promise<Response> {
  const row = await queryFirst<{ last: number | null }>(
    env,
    'SELECT MAX(applied_at) AS last FROM sync_operations WHERE user_id = ?',
    [session.userId],
  );
  return json({ serverTime: Date.now(), lastKnownGoodAt: row?.last ?? null });
}

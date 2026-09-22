/**
 * The offline operation queue (13-offline-first-and-sync.txt sections 3-5).
 *
 * Design notes that matter for correctness:
 *
 *  - Every record's id is generated on the client at creation time and never
 *    replaced (13 s2.2). That is what makes CREATE idempotent.
 *
 *  - Queue entries COLLAPSE per (entity, entityId): rapid typing in one row
 *    produces a single pending UPDATE rather than a pile of operations
 *    (13 s3.4 "deterministically derived so repeated identical operations
 *    collapse rather than pile up"). CREATE is never downgraded to UPDATE,
 *    and DELETE/RESTORE always supersede a pending UPDATE.
 *
 *  - CREATE/UPDATE payloads are read from live Dexie state at flush time, so
 *    the server always receives the latest local values, not a stale
 *    snapshot captured when the key was first pressed.
 */
import type { SyncOperationType } from '../../shared/constants';
import type { SyncQueueItem } from '../../shared/types';
import type { LedgerDexie } from './db';

export type QueueEntity = 'transaction' | 'ledgerDay' | 'customer';

export function newOperationId(): string {
  return crypto.randomUUID();
}

/**
 * Enqueue (or merge into) a pending operation for a record.
 *
 * Precedence when an entry already exists and has not started sending:
 *   CREATE + UPDATE  -> CREATE   (the row still needs creating server-side)
 *   CREATE + DELETE  -> DELETE   (kept; server may already have the CREATE
 *                                 from an earlier partial flush)
 *   UPDATE + DELETE  -> DELETE
 *   DELETE + RESTORE -> RESTORE
 */
export async function enqueue(
  db: LedgerDexie,
  entity: QueueEntity,
  entityId: string,
  type: SyncOperationType,
  payload?: Record<string, unknown>,
): Promise<void> {
  await db.transaction('rw', db.syncQueue, async () => {
    const existing = await db.syncQueue.where('entityId').equals(entityId).toArray();
    const mergeable = existing.find((e) => e.status !== 'SYNCING');

    if (!mergeable) {
      const item: SyncQueueItem = {
        operationId: newOperationId(),
        entity,
        entityId,
        type,
        createdAt: Date.now(),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        ...(payload ? { payload } : {}),
      };
      await db.syncQueue.put(item);
      return;
    }

    let nextType: SyncOperationType = type;
    if (mergeable.type === 'CREATE' && type === 'UPDATE') nextType = 'CREATE';

    await db.syncQueue.put({
      ...mergeable,
      type: nextType,
      // A merged change is fresh work: clear backoff and error state so it
      // is retried promptly rather than inheriting an old penalty.
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      ...(payload ? { payload } : {}),
    });
  });
}

export async function pendingCount(db: LedgerDexie): Promise<number> {
  return db.syncQueue.where('status').anyOf('PENDING', 'FAILED').count();
}

export async function claimDueOperations(
  db: LedgerDexie,
  limit: number,
): Promise<SyncQueueItem[]> {
  const now = Date.now();
  const candidates = await db.syncQueue
    .where('status')
    .anyOf('PENDING', 'FAILED')
    .toArray();
  return candidates
    .filter((c) => c.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);
}

/** Exponential backoff with jitter, capped (13 section 5.3). */
export function backoffDelayMs(attempts: number): number {
  const base = 2000 * Math.pow(2, Math.max(0, attempts - 1));
  const capped = Math.min(base, 5 * 60 * 1000);
  const jitter = Math.random() * Math.min(1000, capped * 0.25);
  return capped + jitter;
}

export async function markSyncing(db: LedgerDexie, ids: string[]): Promise<void> {
  await db.transaction('rw', db.syncQueue, async () => {
    for (const id of ids) {
      const item = await db.syncQueue.get(id);
      if (item) await db.syncQueue.put({ ...item, status: 'SYNCING' });
    }
  });
}

export async function completeOperation(db: LedgerDexie, operationId: string): Promise<void> {
  await db.syncQueue.delete(operationId);
}

/** Transient failure: keep the item queued and back off (never drop it). */
export async function failOperation(
  db: LedgerDexie,
  operationId: string,
  error: string,
): Promise<void> {
  const item = await db.syncQueue.get(operationId);
  if (!item) return;
  const attempts = item.attempts + 1;
  await db.syncQueue.put({
    ...item,
    status: 'FAILED',
    attempts,
    lastError: error.slice(0, 300),
    nextAttemptAt: Date.now() + backoffDelayMs(attempts),
  });
}

/**
 * Permanent rejection (a validation problem needing the user's attention).
 * The local record is NEVER discarded - it stays visible and editable with
 * a SYNC_FAILED marker (13 section 8).
 */
export async function rejectOperation(
  db: LedgerDexie,
  operationId: string,
  error: string,
): Promise<void> {
  const item = await db.syncQueue.get(operationId);
  if (!item) return;
  await db.syncQueue.put({
    ...item,
    status: 'FAILED',
    attempts: item.attempts + 1,
    lastError: error.slice(0, 300),
    // Long pause: retrying identical invalid data would just fail again.
    nextAttemptAt: Date.now() + 24 * 60 * 60 * 1000,
  });
}

/** Re-arm every failed item for an immediate retry (user-triggered). */
export async function retryAllFailed(db: LedgerDexie): Promise<number> {
  const failed = await db.syncQueue.where('status').equals('FAILED').toArray();
  await db.transaction('rw', db.syncQueue, async () => {
    for (const item of failed) {
      await db.syncQueue.put({ ...item, status: 'PENDING', nextAttemptAt: 0, attempts: 0 });
    }
  });
  return failed.length;
}

/**
 * Recover items stuck in SYNCING from a previous session: the tab was
 * closed mid-flight, so we don't know whether the server applied them.
 * Replaying is safe because the operationId is idempotent server-side.
 */
export async function requeueStuckOperations(db: LedgerDexie): Promise<number> {
  const stuck = await db.syncQueue.where('status').equals('SYNCING').toArray();
  await db.transaction('rw', db.syncQueue, async () => {
    for (const item of stuck) {
      await db.syncQueue.put({ ...item, status: 'PENDING', nextAttemptAt: 0 });
    }
  });
  return stuck.length;
}

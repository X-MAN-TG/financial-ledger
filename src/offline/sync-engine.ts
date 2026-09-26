/**
 * The sync engine (13-offline-first-and-sync.txt section 5).
 *
 * Guarantees implemented here:
 *  5.1 batches pending operations in creation order
 *  5.2 APPLIED and DUPLICATE_IGNORED both mark the record SYNCED;
 *      REJECTED marks SYNC_FAILED and surfaces a safe message
 *  5.3 exponential backoff with jitter, bounded retries, no tight loop
 *  5.4 idempotent by construction - replay is safe after a dropped response
 *  5.5 runs on: app start, online event, visibility change, an interval
 *      safety net, and immediately after a local write while online
 */
import type {
  LocalCustomer,
  LocalLedgerDay,
  LocalTransaction,
  SyncBatchResponse,
  SyncQueueItem,
  Transaction,
} from '../../shared/types';
import { LIMITS } from '../../shared/constants';
import { ApiError, apiPost } from '../lib/api';
import type { LedgerDexie } from './db';
import { setMeta } from './db';
import {
  claimDueOperations,
  completeOperation,
  failOperation,
  markSyncing,
  rejectOperation,
  requeueStuckOperations,
} from './queue';

export type SyncPhase = 'IDLE' | 'SYNCING' | 'OFFLINE' | 'ERROR';

export interface SyncState {
  phase: SyncPhase;
  pending: number;
  failed: number;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Set when the server reported a row was changed on another device. */
  conflicts: string[];
}

type Listener = (s: SyncState) => void;

const BATCH_SIZE = Math.min(40, LIMITS.syncBatchMax);

export class SyncEngine {
  private db: LedgerDexie;
  private listeners = new Set<Listener>();
  private running = false;
  private timer: number | null = null;
  private disposed = false;
  private state: SyncState = {
    phase: navigator.onLine ? 'IDLE' : 'OFFLINE',
    pending: 0,
    failed: 0,
    lastSyncAt: null,
    lastError: null,
    conflicts: [],
  };

  constructor(db: LedgerDexie) {
    this.db = db;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): SyncState {
    return this.state;
  }

  private emit(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async start(): Promise<void> {
    // Anything left mid-flight from a previous session is safe to replay.
    await requeueStuckOperations(this.db);
    await this.refreshCounts();

    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibility);

    // Safety-net interval (13 section 5.5).
    this.timer = window.setInterval(() => {
      void this.flush();
    }, 20_000);

    void this.flush();
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.listeners.clear();
  }

  private handleOnline = (): void => {
    this.emit({ phase: 'IDLE' });
    void this.flush();
  };

  private handleOffline = (): void => {
    this.emit({ phase: 'OFFLINE' });
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.flush();
  };

  async refreshCounts(): Promise<void> {
    const [pending, failed] = await Promise.all([
      this.db.syncQueue.where('status').anyOf('PENDING', 'SYNCING').count(),
      this.db.syncQueue.where('status').equals('FAILED').count(),
    ]);
    this.emit({ pending, failed });
  }

  /** Flush the queue. Safe to call concurrently; overlapping calls no-op. */
  async flush(): Promise<void> {
    if (this.disposed || this.running) return;
    if (!navigator.onLine) {
      this.emit({ phase: 'OFFLINE' });
      await this.refreshCounts();
      return;
    }

    this.running = true;
    try {
      let guard = 0;
      // Loop so a large backlog drains across several batches, bounded to
      // avoid monopolising the main thread.
      while (guard < 10) {
        guard += 1;
        const due = await claimDueOperations(this.db, BATCH_SIZE);
        if (due.length === 0) break;

        this.emit({ phase: 'SYNCING' });
        const operations = await this.buildPayloads(due);
        if (operations.length === 0) break;

        await markSyncing(
          this.db,
          operations.map((o) => o.item.operationId),
        );

        let response: SyncBatchResponse;
        try {
          response = await apiPost<SyncBatchResponse>('/api/sync/batch', {
            operations: operations.map((o) => o.op),
          });
        } catch (e) {
          // Transport failure: every item stays queued with backoff.
          const message =
            e instanceof ApiError ? e.message : 'Could not reach the server';
          for (const { item } of operations) {
            await failOperation(this.db, item.operationId, message);
          }
          this.emit({
            phase: navigator.onLine ? 'ERROR' : 'OFFLINE',
            lastError: message,
          });
          await this.refreshCounts();
          return;
        }

        await this.applyResults(response, operations);
        await setMeta(this.db, 'lastSyncAt', response.serverTime);
        this.emit({ lastSyncAt: response.serverTime, lastError: null });
      }

      await this.refreshCounts();
      const failed = await this.db.syncQueue.where('status').equals('FAILED').count();
      this.emit({ phase: failed > 0 ? 'ERROR' : 'IDLE' });
    } finally {
      this.running = false;
    }
  }

  /**
   * Build wire payloads from LIVE Dexie state so the newest local values are
   * sent, not a snapshot from when the edit was first queued.
   */
  private async buildPayloads(
    items: SyncQueueItem[],
  ): Promise<Array<{ item: SyncQueueItem; op: Record<string, unknown> }>> {
    const out: Array<{ item: SyncQueueItem; op: Record<string, unknown> }> = [];

    for (const item of items) {
      if (item.entity === 'transaction') {
        const row = await this.db.transactions.get(item.entityId);
        if (!row) {
          // Record vanished locally (e.g. purged): drop the orphan op.
          await completeOperation(this.db, item.operationId);
          continue;
        }
        if (item.type === 'CREATE') {
          out.push({
            item,
            op: {
              operationId: item.operationId,
              type: 'CREATE',
              entity: 'transaction',
              payload: {
                id: row.id,
                ledgerDayId: row.ledgerDayId,
                date: row.date,
                srNumber: row.srNumber,
                customerId: row.customerId,
                customerNameSnapshot: row.customerNameSnapshot,
                inrAmount: row.inrAmount,
                inrReceived: row.inrReceived,
                usdtAmount: row.usdtAmount,
                finalRubAmount: row.finalRubAmount,
                extrasAmount: row.extrasAmount,
                orderDone: row.orderDone,
                note: row.note,
                attachments: row.attachments,
                sortOrder: row.sortOrder,
                clientCreatedAt: row.clientCreatedAt,
                customValues: row.customValues,
              },
            },
          });
        } else if (item.type === 'UPDATE') {
          out.push({
            item,
            op: {
              operationId: item.operationId,
              type: 'UPDATE',
              entity: 'transaction',
              payload: {
                id: row.id,
                syncVersion: row.syncVersion,
                clientUpdatedAt: row.updatedAt,
                customerId: row.customerId,
                customerNameSnapshot: row.customerNameSnapshot,
                inrAmount: row.inrAmount,
                inrReceived: row.inrReceived,
                usdtAmount: row.usdtAmount,
                finalRubAmount: row.finalRubAmount,
                extrasAmount: row.extrasAmount,
                orderDone: row.orderDone,
                note: row.note,
                attachments: row.attachments,
                srNumber: row.srNumber,
                sortOrder: row.sortOrder,
                customValues: row.customValues,
              },
            },
          });
        } else {
          out.push({
            item,
            op: {
              operationId: item.operationId,
              type: item.type,
              entity: 'transaction',
              payload: { id: row.id },
            },
          });
        }
        continue;
      }

      if (item.entity === 'ledgerDay') {
        const day = await this.db.ledgerDays.get(item.entityId);
        if (!day) {
          await completeOperation(this.db, item.operationId);
          continue;
        }
        out.push({
          item,
          op: {
            operationId: item.operationId,
            type: item.type,
            entity: 'ledgerDay',
            payload: { id: day.id, date: day.date, status: day.status },
          },
        });
        continue;
      }

      const cust = await this.db.customers.get(item.entityId);
      if (!cust) {
        await completeOperation(this.db, item.operationId);
        continue;
      }
      out.push({
        item,
        op: {
          operationId: item.operationId,
          type: item.type,
          entity: 'customer',
          payload:
            item.type === 'DELETE'
              ? { id: cust.id }
              : { id: cust.id, name: cust.name, phone: cust.phone, notes: cust.notes },
        },
      });
    }

    return out;
  }

  private async applyResults(
    response: SyncBatchResponse,
    sent: Array<{ item: SyncQueueItem; op: Record<string, unknown> }>,
  ): Promise<void> {
    const byOpId = new Map(sent.map((s) => [s.item.operationId, s.item]));
    const conflicts: string[] = [];

    for (const result of response.results) {
      const item = byOpId.get(result.operationId);
      if (!item) continue;

      // APPLIED and DUPLICATE_IGNORED are both success (13 section 5.2).
      if (result.status === 'APPLIED' || result.status === 'DUPLICATE_IGNORED') {
        await completeOperation(this.db, result.operationId);
        await this.markSynced(item, result.record as Transaction | undefined);
        if (result.conflict) conflicts.push(item.entityId);
        continue;
      }

      const message = result.error?.message ?? 'The server rejected this change';
      const code = result.error?.code ?? 'REJECTED';

      if (code === 'STALE_VERSION' && result.record) {
        // Lost last-write-wins: adopt the server row and tell the user
        // rather than silently discarding their edit (13 section 7.2).
        await this.adoptServerRecord(item, result.record as Transaction);
        await completeOperation(this.db, result.operationId);
        conflicts.push(item.entityId);
        continue;
      }

      await rejectOperation(this.db, result.operationId, message);
      await this.markFailed(item, message);
    }

    if (conflicts.length > 0) {
      this.emit({ conflicts: [...this.state.conflicts, ...conflicts].slice(-20) });
    }
  }

  private async markSynced(item: SyncQueueItem, record?: Transaction): Promise<void> {
    const now = Date.now();
    if (item.entity === 'transaction') {
      const local = await this.db.transactions.get(item.entityId);
      if (!local) return;
      // Only clear the pending flag if no NEWER local edit was queued while
      // this request was in flight.
      const stillQueued = await this.db.syncQueue
        .where('entityId')
        .equals(item.entityId)
        .count();
      const patch: Partial<LocalTransaction> = {
        syncStatus: stillQueued > 0 ? 'PENDING_SYNC' : 'SYNCED',
        serverConfirmedAt: now,
        lastSyncError: null,
        retryCount: 0,
        operationType: stillQueued > 0 ? local.operationType : null,
      };
      if (record && stillQueued === 0) {
        // Adopt the authoritative server values (status, syncVersion...).
        patch.status = record.status;
        patch.orderDone = record.orderDone;
        patch.syncVersion = record.syncVersion;
        patch.updatedAt = record.updatedAt;
        patch.isDeleted = record.isDeleted;
        patch.srNumber = record.srNumber;
      } else if (record) {
        patch.syncVersion = record.syncVersion;
      }
      await this.db.transactions.update(item.entityId, patch);
      return;
    }

    if (item.entity === 'ledgerDay') {
      await this.db.ledgerDays.update(item.entityId, {
        syncStatus: 'SYNCED',
        serverConfirmedAt: now,
        lastSyncError: null,
      } as Partial<LocalLedgerDay>);
      return;
    }

    await this.db.customers.update(item.entityId, {
      syncStatus: 'SYNCED',
      serverConfirmedAt: now,
      lastSyncError: null,
    } as Partial<LocalCustomer>);
  }

  private async adoptServerRecord(item: SyncQueueItem, record: Transaction): Promise<void> {
    const local = await this.db.transactions.get(item.entityId);
    if (!local) return;
    await this.db.transactions.put({
      ...local,
      ...record,
      localId: record.id,
      syncStatus: 'SYNCED',
      serverConfirmedAt: Date.now(),
      lastSyncError: 'This row was updated on another device',
      retryCount: 0,
      operationType: null,
    });
  }

  private async markFailed(item: SyncQueueItem, message: string): Promise<void> {
    if (item.entity === 'transaction') {
      const local = await this.db.transactions.get(item.entityId);
      if (!local) return;
      await this.db.transactions.update(item.entityId, {
        syncStatus: 'SYNC_FAILED',
        lastSyncError: message,
        retryCount: local.retryCount + 1,
        lastSyncAttemptAt: Date.now(),
      } as Partial<LocalTransaction>);
      return;
    }
    if (item.entity === 'ledgerDay') {
      await this.db.ledgerDays.update(item.entityId, {
        syncStatus: 'SYNC_FAILED',
        lastSyncError: message,
      } as Partial<LocalLedgerDay>);
      return;
    }
    await this.db.customers.update(item.entityId, {
      syncStatus: 'SYNC_FAILED',
      lastSyncError: message,
    } as Partial<LocalCustomer>);
  }
}

let engine: SyncEngine | null = null;

export function initSyncEngine(db: LedgerDexie): SyncEngine {
  if (engine) engine.dispose();
  engine = new SyncEngine(db);
  void engine.start();
  return engine;
}

export function getSyncEngine(): SyncEngine | null {
  return engine;
}

export function disposeSyncEngine(): void {
  if (engine) {
    engine.dispose();
    engine = null;
  }
}

/** Nudge the engine right after a local write while online (13 s5.5). */
export function nudgeSync(): void {
  if (engine && navigator.onLine) void engine.flush();
}

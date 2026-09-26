/**
 * Local-first ledger repository (13 section 3 write flow).
 *
 * Every mutation writes to Dexie FIRST, then enqueues a sync operation.
 * Nothing in the UI path ever waits on the network. The functions here are
 * the only way the app mutates ledger data.
 */
import {
  deriveStatus,
  isBlankRow,
  localDateKey,
  resolveOrderDone,
} from '../../shared/business-rules';
import { SEED_EMPTY_ROW_COUNT } from '../../shared/constants';
import type {
  LedgerDay,
  LocalCustomer,
  LocalLedgerDay,
  LocalTransaction,
  NoteAttachment,
  Transaction,
} from '../../shared/types';
import { ApiError, apiGet } from '../lib/api';
import type { LedgerDexie } from './db';
import { enqueue } from './queue';
import { nudgeSync } from './sync-engine';

export function newUuid(): string {
  return crypto.randomUUID();
}

function blankTransaction(
  userId: string,
  day: { id: string; date: string },
  srNumber: number,
  sortOrder: number,
): LocalTransaction {
  const id = newUuid();
  const now = Date.now();
  return {
    id,
    localId: id,
    userId,
    ledgerDayId: day.id,
    date: day.date,
    srNumber,
    customerId: null,
    customerNameSnapshot: null,
    inrAmount: null,
    inrReceived: false,
    usdtAmount: null,
    finalRubAmount: null,
    extrasAmount: null,
    orderDone: false,
    status: 'INCOMPLETE',
    note: null,
    attachments: [],
    sortOrder,
    isDeleted: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    clientCreatedAt: now,
    syncVersion: 1,
    serverConfirmedAt: null,
    syncStatus: 'LOCAL_ONLY',
    retryCount: 0,
    lastSyncAttemptAt: null,
    lastSyncError: null,
    operationType: 'CREATE',
  };
}

function toLocalTransaction(t: Transaction, date: string): LocalTransaction {
  return {
    ...t,
    date,
    localId: t.id,
    serverConfirmedAt: Date.now(),
    syncStatus: 'SYNCED',
    retryCount: 0,
    lastSyncAttemptAt: null,
    lastSyncError: null,
    operationType: null,
  };
}

/**
 * Open a date: pull the server copy when online, otherwise fall back to the
 * local cache. Seeds 3-5 blank rows exactly once for a brand-new trading day
 * (06 section 2.2 / 2.3) - never for a Day Off, never on re-open of a day
 * that already has rows.
 */
export async function openLedgerDay(
  db: LedgerDexie,
  userId: string,
  date: string,
): Promise<{ day: LocalLedgerDay; fromCache: boolean }> {
  let fromCache = true;
  let day = await db.ledgerDays.where('date').equals(date).first();

  if (navigator.onLine) {
    try {
      const res = await apiGet<{ ledgerDay: LedgerDay; transactions: Transaction[] }>(
        `/api/ledger-days/${date}`,
      );
      fromCache = false;
      const existingLocal = day;
      const isLocalPending =
        existingLocal?.syncStatus === 'PENDING_SYNC' || existingLocal?.syncStatus === 'LOCAL_ONLY';
      const serverDay: LocalLedgerDay = {
        ...res.ledgerDay,
        status: isLocalPending && existingLocal ? existingLocal.status : res.ledgerDay.status,
        note:
          isLocalPending && existingLocal && existingLocal.note !== undefined
            ? existingLocal.note
            : (res.ledgerDay.note ?? null),
        attachments:
          isLocalPending && existingLocal && existingLocal.attachments !== undefined
            ? existingLocal.attachments
            : (res.ledgerDay.attachments ?? []),
        usdtRate:
          isLocalPending && existingLocal && existingLocal.usdtRate !== undefined
            ? existingLocal.usdtRate
            : (res.ledgerDay.usdtRate ?? 0),
        syncStatus: isLocalPending && existingLocal ? existingLocal.syncStatus : 'SYNCED',
        serverConfirmedAt: Date.now(),
        lastSyncError: null,
      };

      // Reconcile a locally-created day for this date with the server's id.
      // Without this the two ids coexist and the day's rows split between
      // them, which reads to the user as "my entries disappeared".
      const staleLocalDays = (await db.ledgerDays.where('date').equals(date).toArray()).filter(
        (d) => d.id !== serverDay.id,
      );
      if (staleLocalDays.length > 0) {
        await db.transaction('rw', db.ledgerDays, db.transactions, async () => {
          for (const stale of staleLocalDays) {
            const orphans = await db.transactions.where('ledgerDayId').equals(stale.id).toArray();
            for (const o of orphans) {
              await db.transactions.put({ ...o, ledgerDayId: serverDay.id });
            }
            await db.ledgerDays.delete(stale.id);
          }
        });
      }

      day = serverDay;
      await db.ledgerDays.put(day);

      // Reconcile: server rows win for anything not locally pending.
      const serverIds = new Set(res.transactions.map((t) => t.id));
      await db.transaction('rw', db.transactions, db.syncQueue, async () => {
        for (const t of res.transactions) {
          const local = await db.transactions.get(t.id);
          const hasPending =
            (await db.syncQueue.where('entityId').equals(t.id).count()) > 0;
          if (!local || !hasPending) {
            await db.transactions.put(toLocalTransaction(t, date));
          }
        }
        // Drop cached rows the server no longer has UNLESS they are local
        // creations still waiting to sync (never destroy unsynced work).
        const cached = await db.transactions.where('ledgerDayId').equals(res.ledgerDay.id).toArray();
        for (const c of cached) {
          if (serverIds.has(c.id)) continue;
          const pending = await db.syncQueue.where('entityId').equals(c.id).count();
          if (pending === 0 && c.syncStatus === 'SYNCED') {
            await db.transactions.delete(c.id);
          }
        }
      });
    } catch (e) {
      if (!(e instanceof ApiError) || !e.isTransient) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
      }
    }
  }

  if (!day) {
    // Offline and never opened before: create the day locally and queue it.
    const id = newUuid();
    const now = Date.now();
    day = {
      id,
      userId,
      date,
      status: 'TRADING_DAY',
      note: null,
      attachments: [],
      usdtRate: 0,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'LOCAL_ONLY',
      serverConfirmedAt: null,
      lastSyncError: null,
    };
    await db.ledgerDays.put(day);
    await enqueue(db, 'ledgerDay', id, 'CREATE');
    nudgeSync();
  }

  await seedIfNeeded(db, userId, day);
  return { day, fromCache };
}

/** 06 section 2.2 / 3.4: seed blank rows only when the day has none. */
export async function seedIfNeeded(
  db: LedgerDexie,
  userId: string,
  day: LocalLedgerDay,
): Promise<void> {
  if (day.status === 'DAY_OFF') return;

  // Count and insert atomically. Two concurrent openLedgerDay() calls (React
  // StrictMode double-invokes effects in dev, and a refocus can overlap a
  // route change in prod) would otherwise both read 0 and both seed, leaving
  // duplicate Sr numbers and twice the intended rows.
  await db.transaction('rw', db.transactions, async () => {
    const existing = await db.transactions.where('ledgerDayId').equals(day.id).count();
    if (existing > 0) return;

    const rows: LocalTransaction[] = [];
    for (let i = 0; i < SEED_EMPTY_ROW_COUNT; i++) {
      rows.push(blankTransaction(userId, day, i + 1, i));
    }
    await db.transactions.bulkAdd(rows);
  });
  // Seeded blank rows are intentionally NOT queued for sync: an untouched
  // placeholder is not user data. They are queued on first real edit.
}

export async function listDayRows(
  db: LedgerDexie,
  ledgerDayId: string,
): Promise<LocalTransaction[]> {
  const rows = await db.transactions.where('ledgerDayId').equals(ledgerDayId).toArray();
  return rows.filter((r) => !r.isDeleted).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function addRow(
  db: LedgerDexie,
  userId: string,
  day: LocalLedgerDay,
): Promise<LocalTransaction> {
  const rows = await listDayRows(db, day.id);
  const maxSort = rows.reduce((m, r) => Math.max(m, r.sortOrder), -1);
  const row = blankTransaction(userId, day, rows.length + 1, maxSort + 1);
  await db.transactions.put(row);
  return row;
}

export type EditableField =
  | 'customerId'
  | 'customerNameSnapshot'
  | 'inrAmount'
  | 'inrReceived'
  | 'usdtAmount'
  | 'finalRubAmount'
  | 'extrasAmount'
  | 'orderDone'
  | 'note'
  | 'attachments';

/**
 * Apply a field edit: write locally, recompute the derived status with the
 * shared rules, then queue a sync op. Returns the updated row so callers can
 * render immediately.
 */
export async function updateRow(
  db: LedgerDexie,
  id: string,
  patch: Partial<Record<EditableField, unknown>>,
): Promise<LocalTransaction | null> {
  const row = await db.transactions.get(id);
  if (!row) return null;

  const wasBlank = isBlankRow(row);
  const next: LocalTransaction = { ...row, ...(patch as Partial<LocalTransaction>) };

  // The client applies the same state machine the Worker will re-apply, so
  // the optimistic UI never disagrees with the authoritative result.
  next.orderDone = resolveOrderDone(next);
  next.status = deriveStatus(next);
  next.updatedAt = Date.now();
  next.syncStatus = 'PENDING_SYNC';
  next.lastSyncError = null;

  const isNewToServer = row.syncStatus === 'LOCAL_ONLY' || row.operationType === 'CREATE';
  next.operationType = isNewToServer ? 'CREATE' : 'UPDATE';

  await db.transactions.put(next);

  // A blank seeded row only becomes real data once it is actually edited.
  const stillBlank = isBlankRow(next);
  if (stillBlank && wasBlank) {
    await db.transactions.put({ ...next, syncStatus: row.syncStatus, operationType: row.operationType });
    return next;
  }

  await enqueue(db, 'transaction', id, isNewToServer ? 'CREATE' : 'UPDATE');
  nudgeSync();
  return next;
}

/** Soft delete (07 section 4.2 / 6.1). */
export async function deleteRow(db: LedgerDexie, id: string): Promise<void> {
  const row = await db.transactions.get(id);
  if (!row) return;
  const now = Date.now();

  // A row the server has never seen can simply disappear locally.
  if (row.syncStatus === 'LOCAL_ONLY' && isBlankRow(row)) {
    await db.transactions.delete(id);
    await db.syncQueue.where('entityId').equals(id).delete();
    return;
  }

  await db.transactions.put({
    ...row,
    isDeleted: true,
    deletedAt: now,
    updatedAt: now,
    syncStatus: 'PENDING_SYNC',
    operationType: 'DELETE',
  });
  await enqueue(db, 'transaction', id, 'DELETE');
  nudgeSync();
}

export async function restoreRow(db: LedgerDexie, id: string): Promise<void> {
  const row = await db.transactions.get(id);
  if (!row) return;
  await db.transactions.put({
    ...row,
    isDeleted: false,
    deletedAt: null,
    updatedAt: Date.now(),
    syncStatus: 'PENDING_SYNC',
    operationType: 'RESTORE',
  });
  await enqueue(db, 'transaction', id, 'RESTORE');
  nudgeSync();
}

export async function setDayStatus(
  db: LedgerDexie,
  userId: string,
  day: LocalLedgerDay,
  status: 'TRADING_DAY' | 'DAY_OFF',
): Promise<LocalLedgerDay> {
  const next: LocalLedgerDay = {
    ...day,
    status,
    updatedAt: Date.now(),
    syncStatus: 'PENDING_SYNC',
  };
  await db.ledgerDays.put(next);
  await enqueue(db, 'ledgerDay', day.id, 'UPDATE');
  nudgeSync();
  // Reopening a previously empty day gets the standard seed (06 s3.4).
  if (status === 'TRADING_DAY') await seedIfNeeded(db, userId, next);
  return next;
}

export async function updateDayDetails(
  db: LedgerDexie,
  day: LocalLedgerDay,
  patch: { note?: string | null; attachments?: NoteAttachment[]; usdtRate?: number | null },
): Promise<LocalLedgerDay> {
  const next: LocalLedgerDay = {
    ...day,
    note: patch.note !== undefined ? patch.note : (day.note ?? null),
    attachments: patch.attachments !== undefined ? patch.attachments : (day.attachments ?? []),
    usdtRate: patch.usdtRate !== undefined ? patch.usdtRate : (day.usdtRate ?? 0),
    updatedAt: Date.now(),
    syncStatus: 'PENDING_SYNC',
  };
  await db.ledgerDays.put(next);
  await enqueue(db, 'ledgerDay', day.id, 'UPDATE');
  nudgeSync();
  return next;
}

/* ---------------------------------------------------------- customers ---- */

export async function cacheCustomers(
  db: LedgerDexie,
  customers: Array<Omit<LocalCustomer, 'syncStatus' | 'serverConfirmedAt' | 'lastSyncError'>>,
): Promise<void> {
  await db.customers.bulkPut(
    customers.map((c) => ({
      ...c,
      syncStatus: 'SYNCED' as const,
      serverConfirmedAt: Date.now(),
      lastSyncError: null,
    })),
  );
}

export async function createCustomerLocal(
  db: LedgerDexie,
  userId: string,
  input: { name: string; phone?: string | null; notes?: string | null },
): Promise<LocalCustomer> {
  const id = newUuid();
  const now = Date.now();
  const customer: LocalCustomer = {
    id,
    userId,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    notes: input.notes?.trim() || null,
    isActive: true,
    isDeleted: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'PENDING_SYNC',
    serverConfirmedAt: null,
    lastSyncError: null,
  };
  await db.customers.put(customer);
  await enqueue(db, 'customer', id, 'CREATE');
  nudgeSync();
  return customer;
}

export async function searchCustomersLocal(
  db: LedgerDexie,
  query: string,
  limit = 8,
): Promise<LocalCustomer[]> {
  const q = query.trim().toLowerCase();
  const all = await db.customers.filter((c) => !c.isDeleted).toArray();
  const matched = q
    ? all.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q),
      )
    : all;
  return matched.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}

export async function todayKey(): Promise<string> {
  return localDateKey();
}

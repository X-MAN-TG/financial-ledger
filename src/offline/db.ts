/**
 * Dexie (IndexedDB) schema - the client's source of truth for ledger data
 * (13-offline-first-and-sync.txt section 2).
 *
 * The database name is namespaced per user id so that signing in as a
 * different account on the same device can never surface or merge another
 * user's cached rows (20-security.txt section 3, isolation).
 */
import Dexie, { type Table } from 'dexie';
import type {
  LocalCustomer,
  LocalLedgerDay,
  LocalTransaction,
  SyncQueueItem,
} from '../../shared/types';

export interface MetaRow {
  key: string;
  value: unknown;
  updatedAt: number;
}

export class LedgerDexie extends Dexie {
  transactions!: Table<LocalTransaction, string>;
  ledgerDays!: Table<LocalLedgerDay, string>;
  customers!: Table<LocalCustomer, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  meta!: Table<MetaRow, string>;

  constructor(userId: string) {
    super(`ledger_db_${userId}`);
    this.version(1).stores({
      // Compound index [ledgerDayId+sortOrder] powers the day table read.
      transactions:
        'id, ledgerDayId, date, syncStatus, isDeleted, customerId, [ledgerDayId+sortOrder], [date+isDeleted], updatedAt',
      ledgerDays: 'id, date, syncStatus, status',
      customers: 'id, name, isDeleted, syncStatus',
      // nextAttemptAt drives backoff scheduling; createdAt preserves FIFO.
      syncQueue: 'operationId, entityId, status, createdAt, nextAttemptAt, [status+nextAttemptAt]',
      meta: 'key',
    });
  }
}

let instance: LedgerDexie | null = null;
let instanceUserId: string | null = null;

export function getDb(userId: string): LedgerDexie {
  if (instance && instanceUserId === userId) return instance;
  if (instance) instance.close();
  instance = new LedgerDexie(userId);
  instanceUserId = userId;
  return instance;
}

export function currentDb(): LedgerDexie | null {
  return instance;
}

/**
 * Closes the handle on sign-out but deliberately does NOT delete the data:
 * unsynced offline edits must survive a sign-out/sign-in cycle (13 s8).
 */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    instanceUserId = null;
  }
}

export async function getMeta<T>(db: LedgerDexie, key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(db: LedgerDexie, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value, updatedAt: Date.now() });
}

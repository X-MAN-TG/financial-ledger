/**
 * D1 helpers and row mappers.
 *
 * ALL queries in this codebase use parameterized statements (.bind) - string
 * concatenation into SQL is never used (20-security.txt section 4.2).
 */
import type {
  AuditEntry,
  BackupRecord,
  ColumnDefinition,
  Customer,
  LedgerDay,
  Profile,
  Transaction,
  UserSettings,
} from '../../shared/types';
import type { Env } from './config';

export const nowMs = (): number => Date.now();

export const boolToInt = (b: boolean | null | undefined): number => (b ? 1 : 0);
export const intToBool = (v: unknown): boolean => v === 1 || v === true;

export const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export const strOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

/* ------------------------------------------------------------- mappers ---- */

export interface DbUserRow {
  id: string;
  email: string;
  password_hash: string | null;
  auth_provider: string;
  google_sub: string | null;
  role: string;
  status: string;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

export function mapProfile(r: Record<string, unknown>): Profile {
  return {
    userId: String(r.user_id),
    displayName: String(r.display_name),
    fullName: strOrNull(r.full_name),
    avatarUrl: strOrNull(r.avatar_url),
    bio: strOrNull(r.bio),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function mapSettings(r: Record<string, unknown>): UserSettings {
  return {
    userId: String(r.user_id),
    theme: String(r.theme),
    dateFormat: String(r.date_format),
    updatedAt: Number(r.updated_at),
  };
}

export function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    phone: strOrNull(r.phone),
    notes: strOrNull(r.notes),
    isActive: intToBool(r.is_active),
    isDeleted: intToBool(r.is_deleted),
    deletedAt: numOrNull(r.deleted_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function mapLedgerDay(r: Record<string, unknown>): LedgerDay {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    date: String(r.date),
    status: r.status === 'DAY_OFF' ? 'DAY_OFF' : 'TRADING_DAY',
    note: strOrNull(r.note),
    attachments: r.attachments ? JSON.parse(String(r.attachments)) : [],
    usdtRate: r.usdt_rate !== null && r.usdt_rate !== undefined ? Number(r.usdt_rate) : 0,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function mapTransaction(r: Record<string, unknown>): Transaction {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    ledgerDayId: String(r.ledger_day_id),
    ...(r.date !== undefined && r.date !== null ? { date: String(r.date) } : {}),
    srNumber: Number(r.sr_number),
    customerId: strOrNull(r.customer_id),
    customerNameSnapshot: strOrNull(r.customer_name_snapshot),
    inrAmount: numOrNull(r.inr_amount),
    inrReceived: intToBool(r.inr_received),
    usdtAmount: numOrNull(r.usdt_amount),
    finalRubAmount: numOrNull(r.final_rub_amount),
    extrasAmount: numOrNull(r.extras_amount),
    orderDone: intToBool(r.order_done),
    status: (r.status as Transaction['status']) ?? 'INCOMPLETE',
    note: strOrNull(r.note),
    attachments: r.attachments ? JSON.parse(String(r.attachments)) : [],
    sortOrder: Number(r.sort_order),
    isDeleted: intToBool(r.is_deleted),
    deletedAt: numOrNull(r.deleted_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    clientCreatedAt: Number(r.client_created_at),
    syncVersion: Number(r.sync_version),
  };
}

export function mapColumnDefinition(r: Record<string, unknown>): ColumnDefinition {
  let opts: string[] | null = null;
  if (r.select_options) {
    try {
      const parsed = JSON.parse(String(r.select_options));
      if (Array.isArray(parsed)) opts = parsed.map(String);
    } catch {
      opts = null;
    }
  }
  return {
    id: String(r.id),
    key: String(r.key),
    label: String(r.label),
    type: r.type as ColumnDefinition['type'],
    position: Number(r.position),
    isRequired: intToBool(r.is_required),
    isActive: intToBool(r.is_active),
    isSystem: intToBool(r.is_system),
    selectOptions: opts,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function mapAuditEntry(r: Record<string, unknown>): AuditEntry {
  let meta: Record<string, unknown> | null = null;
  if (r.metadata) {
    try {
      meta = JSON.parse(String(r.metadata));
    } catch {
      meta = null;
    }
  }
  return {
    id: String(r.id),
    userId: strOrNull(r.user_id),
    actorRole: r.actor_role as AuditEntry['actorRole'],
    action: String(r.action),
    resourceType: String(r.resource_type),
    resourceId: strOrNull(r.resource_id),
    scope: r.scope as AuditEntry['scope'],
    result: r.result as AuditEntry['result'],
    metadata: meta,
    createdAt: Number(r.created_at),
    ...(r.actor_email !== undefined ? { actorEmail: strOrNull(r.actor_email) } : {}),
  };
}

export function mapBackupRecord(r: Record<string, unknown>): BackupRecord {
  return {
    id: String(r.id),
    userId: strOrNull(r.user_id),
    type: r.type as BackupRecord['type'],
    status: r.status as BackupRecord['status'],
    fileRef: strOrNull(r.file_ref),
    sizeBytes: numOrNull(r.size_bytes),
    errorMessage: strOrNull(r.error_message),
    createdAt: Number(r.created_at),
  };
}

/* ------------------------------------------------------------ querying ---- */

export async function queryAll<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const stmt = env.DB.prepare(sql).bind(...params);
  const res = await stmt.all<T>();
  return (res.results ?? []) as T[];
}

export async function queryFirst<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const stmt = env.DB.prepare(sql).bind(...params);
  const row = await stmt.first<T>();
  return (row ?? null) as T | null;
}

export async function execute(env: Env, sql: string, params: unknown[] = []): Promise<D1Result> {
  return env.DB.prepare(sql)
    .bind(...params)
    .run();
}

/**
 * Run several statements atomically-ish. D1's batch() executes statements in
 * a single transaction, which is what 12-audit-logging.txt section 6.1 asks
 * for: the audit row and the mutation land together or not at all.
 */
export async function batch(env: Env, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  return env.DB.batch(statements);
}

export function stmt(env: Env, sql: string, params: unknown[] = []): D1PreparedStatement {
  return env.DB.prepare(sql).bind(...params);
}

export async function countRows(env: Env, sql: string, params: unknown[] = []): Promise<number> {
  const row = await queryFirst<{ c: number }>(env, sql, params);
  return row ? Number(row.c) : 0;
}

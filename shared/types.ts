/**
 * Entity + API payload types shared between the React client and the Worker.
 * Field naming: camelCase on the wire, snake_case in D1 (see worker/lib/db.ts
 * mappers). The DB shape is defined by 03-database-schema.txt.
 */
import type {
  ApiErrorCode,
  AuditActorRole,
  AuditResult,
  AuditScope,
  AuthProvider,
  BackupStatus,
  BackupType,
  ColumnType,
  LedgerDayStatus,
  Role,
  SyncOperationResult,
  SyncOperationType,
  SyncStatus,
  TransactionStatus,
  UserStatus,
} from './constants';

export interface ApiError {
  error: { code: ApiErrorCode | string; message: string; fields?: Record<string, string> };
}

export interface ListResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  authProvider: AuthProvider;
  displayName: string;
  createdAt: number;
}

export interface Profile {
  userId: string;
  displayName: string;
  fullName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserSettings {
  userId: string;
  theme: string;
  dateFormat: string;
  updatedAt: number;
}

export interface Customer {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  isDeleted: boolean;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CustomerSummary {
  totalTransactions: number;
  totalInr: number;
  totalUsdt: number;
  totalRub: number;
  totalExtras: number;
  completedCount: number;
  pendingCount: number;
}

export interface LedgerDay {
  id: string;
  userId: string;
  /** 'YYYY-MM-DD' in the user's local time zone. */
  date: string;
  status: LedgerDayStatus;
  note?: string | null;
  attachments?: NoteAttachment[];
  usdtRate?: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Custom (owner-defined) column values for one transaction: key -> value. */
export type CustomValues = Record<string, string | null>;

export interface NoteAttachment { id: string; name: string; type: string; dataUrl: string; }

export interface Transaction {
  /** Up to five persisted image data URLs attached to the note. */
  attachments: NoteAttachment[];
  id: string;
  userId: string;
  ledgerDayId: string;
  /** Denormalized on the client for fast day lookups; not a D1 column. */
  date?: string;
  srNumber: number;
  customerId: string | null;
  customerNameSnapshot: string | null;
  inrAmount: number | null;
  inrReceived: boolean;
  usdtAmount: number | null;
  finalRubAmount: number | null;
  extrasAmount: number | null;
  orderDone: boolean;
  status: TransactionStatus;
  note: string | null;
  sortOrder: number;
  isDeleted: boolean;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  clientCreatedAt: number;
  syncVersion: number;
  customValues?: CustomValues;
}

/** Totals bar contract (07 section 5). */
export interface DayTotals {
  totalInr: number;
  totalUsdt: number;
  totalRub: number;
  totalExtras: number;
  completedCount: number;
  pendingCount: number;
  rowCount: number;
}

export interface ColumnDefinition {
  id: string;
  key: string;
  label: string;
  type: ColumnType;
  position: number;
  isRequired: boolean;
  isActive: boolean;
  isSystem: boolean;
  selectOptions: string[] | null;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  actorRole: AuditActorRole;
  action: string;
  resourceType: string;
  resourceId: string | null;
  scope: AuditScope;
  result: AuditResult;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  /** Owner global view only. */
  actorEmail?: string | null;
}

export interface BackupRecord {
  id: string;
  userId: string | null;
  type: BackupType;
  status: BackupStatus;
  fileRef: string | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  createdAt: number;
}

/* ---------------------------------------------------------------- API ---- */

export interface LedgerDayResponse {
  ledgerDay: LedgerDay;
  transactions: Transaction[];
}

export interface TimelineDayItem {
  date: string;
  ledgerDayId: string | null;
  status: LedgerDayStatus;
  transactionCount: number;
  totals: DayTotals;
}

export interface SyncOperationInput {
  operationId: string;
  type: SyncOperationType;
  entity: 'transaction' | 'ledgerDay' | 'customer';
  payload: Record<string, unknown>;
}

export interface SyncOperationResultItem {
  operationId: string;
  status: SyncOperationResult;
  entity: SyncOperationInput['entity'];
  entityId: string;
  /** True when last-write-wins discarded the incoming edit (13 s7.2). */
  conflict?: boolean;
  /** Authoritative server record, so the client can reconcile. */
  record?: Transaction | LedgerDay | Customer;
  error?: { code: string; message: string };
}

export interface SyncBatchResponse {
  results: SyncOperationResultItem[];
  serverTime: number;
}

export interface AnalyticsToday {
  date: string;
  transactionCount: number;
  totalInr: number;
  totalUsdt: number;
  totalRub: number;
  totalExtras: number;
  completedCount: number;
  pendingCount: number;
  completionPct: number;
  dayStatus: LedgerDayStatus;
}

export interface AnalyticsDailyPoint {
  date: string;
  count: number;
  inr: number;
  usdt: number;
  rub: number;
  extras: number;
  completed: number;
  isDayOff: boolean;
}

export interface AnalyticsWindow {
  from: string;
  to: string;
  days: AnalyticsDailyPoint[];
  transactionCount: number;
  totalInr: number;
  totalUsdt: number;
  totalRub: number;
  totalExtras: number;
  completedCount: number;
  pendingCount: number;
  tradingDayCount: number;
  dayOffCount: number;
  avgTransactionsPerTradingDay: number;
  /** Present for 30d (and 7d): change vs the immediately preceding window. */
  previous?: {
    transactionCount: number;
    totalExtras: number;
    totalInr: number;
    extrasChangePct: number | null;
    countChangePct: number | null;
  };
}

export interface AnalyticsMonthly {
  month: string; // 'YYYY-MM'
  transactionCount: number;
  totalInr: number;
  totalUsdt: number;
  totalRub: number;
  totalExtras: number;
  completedCount: number;
  pendingCount: number;
  avgTransactionValueInr: number;
  days: AnalyticsDailyPoint[];
  bestDaysByExtras: { date: string; value: number }[];
  bestDaysByVolume: { date: string; value: number }[];
}

export interface AnalyticsAllTime {
  firstDate: string | null;
  lastDate: string | null;
  transactionCount: number;
  totalInr: number;
  totalUsdt: number;
  totalRub: number;
  totalExtras: number;
  completedCount: number;
  pendingCount: number;
  avgTransactionValueInr: number;
  tradingDayCount: number;
  dayOffCount: number;
  mostActiveDays: { date: string; value: number }[];
  topCustomers: { customerId: string | null; name: string; count: number; extras: number }[];
  monthly: { month: string; count: number; extras: number; inr: number }[];
}

export interface HealthReport {
  worker: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  d1: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  r2: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'NOT_CONFIGURED';
  auth: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  dbLatencyMs: number;
  lastBackupAt: number | null;
  lastBackupStatus: BackupStatus | null;
  userCount: number;
  maxUsers: number;
  syncErrorCount: number;
  checkedAt: number;
}

export interface OwnerStats {
  totalUsers: number;
  activeUsers: number;
  totalTransactions: number;
  totalCustomers: number;
  totalLedgerDays: number;
  totalAuditEntries: number;
  storageEstimateBytes: number;
  maxUsers: number;
}

export interface OwnerUserRow {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  authProvider: AuthProvider;
  createdAt: number;
  lastLoginAt: number | null;
  transactionCount: number;
}

export interface BackupStatusResponse {
  lastSyncAt: number | null;
  lastExportAt: number | null;
  lastExportType: BackupType | null;
  lastExportStatus: BackupStatus | null;
  recent: BackupRecord[];
}

export interface ExportDayPayload {
  date: string;
  status: LedgerDayStatus;
  transactions: Transaction[];
  totals: DayTotals;
}

export interface ExportFullPage {
  days: ExportDayPayload[];
  page: number;
  pageSize: number;
  totalDays: number;
  profile: { displayName: string; fullName: string | null };
  columns: ColumnDefinition[];
  grandTotals: DayTotals;
}

/* ------------------------------------------------- client-only shapes ---- */

/** Dexie row = Transaction + offline bookkeeping (13 section 2.3). */
export interface LocalTransaction extends Transaction {
  /** Always present locally: Dexie indexes day lookups on it. */
  date: string;
  localId: string;
  serverConfirmedAt: number | null;
  syncStatus: SyncStatus;
  retryCount: number;
  lastSyncAttemptAt: number | null;
  lastSyncError: string | null;
  operationType: SyncOperationType | null;
}

export interface LocalLedgerDay extends LedgerDay {
  syncStatus: SyncStatus;
  serverConfirmedAt: number | null;
  lastSyncError: string | null;
}

export interface LocalCustomer extends Customer {
  syncStatus: SyncStatus;
  serverConfirmedAt: number | null;
  lastSyncError: string | null;
}

export interface SyncQueueItem {
  operationId: string;
  entity: SyncOperationInput['entity'];
  entityId: string;
  type: SyncOperationType;
  /** FIFO ordering key. */
  createdAt: number;
  status: 'PENDING' | 'SYNCING' | 'FAILED';
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  /** Frozen payload for DELETE/RESTORE; CREATE/UPDATE read live Dexie state. */
  payload?: Record<string, unknown>;
}

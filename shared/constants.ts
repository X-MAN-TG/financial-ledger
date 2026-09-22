/**
 * Shared constants used by BOTH the React client and the Cloudflare Worker.
 *
 * NOTE ON MAX_USERS (02-architecture.txt section 6.1):
 *   MAX_USERS is NOT defined here as a literal that route handlers read.
 *   It is an environment/binding value (wrangler.toml [vars] MAX_USERS).
 *   `DEFAULT_MAX_USERS` below exists only as the fallback used when the
 *   binding is absent (e.g. a misconfigured local dev shell), and every
 *   enforcement site reads `getMaxUsers(env)` from worker/lib/config.ts,
 *   which is the single source of truth. The UI never hard-codes "10";
 *   it renders the value returned by the API.
 */
export const DEFAULT_MAX_USERS = 10;

export const ROLES = ['OWNER', 'USER'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const AUTH_PROVIDERS = ['PASSWORD', 'GOOGLE', 'BOTH'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const LEDGER_DAY_STATUSES = ['TRADING_DAY', 'DAY_OFF'] as const;
export type LedgerDayStatus = (typeof LEDGER_DAY_STATUSES)[number];

/** 07-transaction-business-rules.txt section 3.1 */
export const TRANSACTION_STATUSES = ['INCOMPLETE', 'READY', 'COMPLETED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const COLUMN_TYPES = [
  'TEXT',
  'NUMBER',
  'CURRENCY',
  'CHECKBOX',
  'DATE',
  'LONG_TEXT',
  'SELECT',
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const SYNC_OPERATION_TYPES = ['CREATE', 'UPDATE', 'DELETE', 'RESTORE'] as const;
export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];

export const SYNC_OPERATION_RESULTS = ['APPLIED', 'DUPLICATE_IGNORED', 'REJECTED'] as const;
export type SyncOperationResult = (typeof SYNC_OPERATION_RESULTS)[number];

/** 13-offline-first-and-sync.txt section 2.3 */
export const SYNC_STATUSES = [
  'LOCAL_ONLY',
  'PENDING_SYNC',
  'SYNCING',
  'SYNCED',
  'SYNC_FAILED',
] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const AUDIT_SCOPES = ['USER', 'GLOBAL'] as const;
export type AuditScope = (typeof AUDIT_SCOPES)[number];

export const AUDIT_ACTOR_ROLES = ['USER', 'OWNER', 'SYSTEM'] as const;
export type AuditActorRole = (typeof AUDIT_ACTOR_ROLES)[number];

export const AUDIT_RESULTS = ['SUCCESS', 'FAILURE'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const BACKUP_TYPES = [
  'USER_EXPORT_JSON',
  'USER_EXPORT_CSV',
  'USER_EXPORT_PDF',
  'SYSTEM_R2_BACKUP',
] as const;
export type BackupType = (typeof BACKUP_TYPES)[number];

export const BACKUP_STATUSES = ['SUCCESS', 'FAILURE', 'IN_PROGRESS'] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

/** 12-audit-logging.txt section 3 - action catalogue. */
export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'SIGNUP_SUCCESS',
  'SIGNUP_FAILURE',
  'PROFILE_CREATED',
  'PROFILE_UPDATED',
  'AVATAR_UPDATED',
  'DISPLAY_NAME_CHANGED',
  'BIO_CHANGED',
  'TRANSACTION_CREATED',
  'TRANSACTION_UPDATED',
  'TRANSACTION_DELETED',
  'TRANSACTION_RESTORED',
  'TRANSACTION_PURGED',
  'TRANSACTION_COMPLETION_REJECTED',
  'NOTE_ADDED',
  'NOTE_EDITED',
  'NOTE_REMOVED',
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'CUSTOMER_DELETED',
  'DAY_MARKED_OFF',
  'DAY_REOPENED',
  'EXPORT_GENERATED',
  'IMPORT_RESTORED',
  'BACKUP_TRIGGERED',
  'BACKUP_SUCCEEDED',
  'BACKUP_FAILED',
  'SYNC_BATCH_APPLIED',
  'SYNC_CONFLICT_DETECTED',
  'THEME_CHANGED',
  'SETTINGS_UPDATED',
  'USER_CREATED',
  'USER_DEACTIVATED',
  'USER_REACTIVATED',
  'USER_PURGED',
  'MAX_USERS_LIMIT_REACHED',
  'COLUMN_CREATED',
  'COLUMN_UPDATED',
  'COLUMN_ARCHIVED',
  'COLUMN_REACTIVATED',
  'COLUMN_DELETED',
  'OWNER_LOGIN_SUCCESS',
  'OWNER_LOGIN_FAILURE',
  'HEALTH_CHECK_RUN',
  'CONFIG_CHANGED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 06-daily-ledger-specification.txt 2.2 - seed 3..5 empty rows. */
export const SEED_EMPTY_ROW_COUNT = 4;

/** The 9 standard system columns (07 section 1). `key` maps to a real
 *  transactions table column, never to transaction_custom_values. */
export const SYSTEM_COLUMN_KEYS = [
  'sr_number',
  'customer_name',
  'inr_amount',
  'inr_received',
  'usdt_amount',
  'final_rub_amount',
  'extras_amount',
  'order_done',
  'note',
] as const;
export type SystemColumnKey = (typeof SYSTEM_COLUMN_KEYS)[number];

/** Validation limits (07 section 8). */
export const LIMITS = {
  customerNameMin: 1,
  customerNameMax: 120,
  noteMax: 2000,
  passwordMin: 10,
  passwordMax: 200,
  displayNameMin: 1,
  displayNameMax: 80,
  fullNameMax: 120,
  bioMax: 500,
  phoneMax: 40,
  customerNotesMax: 2000,
  columnLabelMax: 60,
  columnKeyMax: 40,
  /** Hard ceiling on a single money value; guards against typo/overflow. */
  moneyMax: 1_000_000_000_000,
  /** Max avatar data URL size in bytes (client resizes before upload). */
  avatarMaxBytes: 256 * 1024,
  /** Max operations accepted in one POST /api/sync/batch call. */
  syncBatchMax: 100,
  /** Max JSON import size in bytes. */
  importMaxBytes: 12 * 1024 * 1024,
} as const;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Session lifetime: 30 days sliding, refreshed on activity (04 s2.2). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Only rewrite expires_at when more than this much of the TTL elapsed. */
export const SESSION_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'ledger_session';
export const CSRF_COOKIE = 'ledger_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Minimum user-visible audit retention (12 section 2.1). */
export const USER_AUDIT_MIN_RETENTION_DAYS = 7;

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'MAX_USERS_REACHED',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'STALE_VERSION',
  'COMPLETION_REQUIREMENTS_UNMET',
  'RATE_LIMITED',
  'CSRF_FAILED',
  'SYSTEM_COLUMN_PROTECTED',
  'COLUMN_HAS_DATA',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

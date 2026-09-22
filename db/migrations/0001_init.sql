-- 0001_init.sql
-- Full initial schema, transcribed from 03-database-schema.txt.
-- Conventions: TEXT uuid PKs, INTEGER epoch-ms timestamps, INTEGER 0/1
-- booleans, REAL money, soft delete via is_deleted/deleted_at, and every
-- user-owned table indexed leading with user_id (03 section 1.6).

PRAGMA foreign_keys = ON;

-- 2. users -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NULL,
  auth_provider  TEXT NOT NULL CHECK (auth_provider IN ('PASSWORD','GOOGLE','BOTH')),
  google_sub     TEXT NULL UNIQUE,
  role           TEXT NOT NULL CHECK (role IN ('OWNER','USER')) DEFAULT 'USER',
  status         TEXT NOT NULL CHECK (status IN ('ACTIVE','DISABLED')) DEFAULT 'ACTIVE',
  last_login_at  INTEGER NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

-- 3. profiles ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  display_name TEXT NOT NULL,
  full_name    TEXT NULL,
  avatar_url   TEXT NULL,
  bio          TEXT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 4. user_settings -----------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  theme       TEXT NOT NULL DEFAULT 'light',
  date_format TEXT NOT NULL DEFAULT 'DD MMM YYYY',
  updated_at  INTEGER NOT NULL
);

-- 5. sessions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NULL,
  ip_hash    TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 6. customers ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  phone      TEXT NULL,
  notes      TEXT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_user_name ON customers(user_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_user_deleted ON customers(user_id, is_deleted);

-- 7. ledger_days -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_days (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('TRADING_DAY','DAY_OFF')) DEFAULT 'TRADING_DAY',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_days_user_date ON ledger_days(user_id, date);

-- 8. transactions ------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id),
  ledger_day_id          TEXT NOT NULL REFERENCES ledger_days(id),
  sr_number              INTEGER NOT NULL,
  customer_id            TEXT NULL REFERENCES customers(id),
  customer_name_snapshot TEXT NULL,
  inr_amount             REAL NULL,
  inr_received           INTEGER NOT NULL DEFAULT 0,
  usdt_amount            REAL NULL,
  final_rub_amount       REAL NULL,
  extras_amount          REAL NULL,
  order_done             INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL CHECK (status IN ('INCOMPLETE','READY','COMPLETED')) DEFAULT 'INCOMPLETE',
  note                   TEXT NULL,
  sort_order             INTEGER NOT NULL,
  is_deleted             INTEGER NOT NULL DEFAULT 0,
  deleted_at             INTEGER NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  client_created_at      INTEGER NOT NULL,
  sync_version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tx_user_day_sort ON transactions(user_id, ledger_day_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tx_user_customer ON transactions(user_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_tx_user_created ON transactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tx_user_deleted ON transactions(user_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_tx_day ON transactions(ledger_day_id);
-- Supports timeline/analytics status filtering scoped per user.
CREATE INDEX IF NOT EXISTS idx_tx_user_status ON transactions(user_id, status);

-- 9. column_definitions ------------------------------------------------
CREATE TABLE IF NOT EXISTS column_definitions (
  id             TEXT PRIMARY KEY,
  key            TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('TEXT','NUMBER','CURRENCY','CHECKBOX','DATE','LONG_TEXT','SELECT')),
  position       INTEGER NOT NULL,
  is_required    INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  is_system      INTEGER NOT NULL DEFAULT 0,
  select_options TEXT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_columns_position ON column_definitions(position);

-- 10. transaction_custom_values ---------------------------------------
CREATE TABLE IF NOT EXISTS transaction_custom_values (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  column_id      TEXT NOT NULL REFERENCES column_definitions(id),
  value          TEXT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tcv_tx_col ON transaction_custom_values(transaction_id, column_id);
CREATE INDEX IF NOT EXISTS idx_tcv_col ON transaction_custom_values(column_id);

-- 11. audit_logs -------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NULL REFERENCES users(id),
  actor_role    TEXT NOT NULL CHECK (actor_role IN ('USER','OWNER','SYSTEM')),
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NULL,
  scope         TEXT NOT NULL CHECK (scope IN ('USER','GLOBAL')),
  result        TEXT NOT NULL CHECK (result IN ('SUCCESS','FAILURE')),
  metadata      TEXT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_scope_created ON audit_logs(scope, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action_created ON audit_logs(action, created_at);

-- 12. backup_records ---------------------------------------------------
CREATE TABLE IF NOT EXISTS backup_records (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NULL,
  type          TEXT NOT NULL CHECK (type IN ('USER_EXPORT_JSON','USER_EXPORT_CSV','USER_EXPORT_PDF','SYSTEM_R2_BACKUP')),
  status        TEXT NOT NULL CHECK (status IN ('SUCCESS','FAILURE','IN_PROGRESS')),
  file_ref      TEXT NULL,
  size_bytes    INTEGER NULL,
  error_message TEXT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_user_created ON backup_records(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_backup_type_created ON backup_records(type, created_at);

-- 13. sync_operations (idempotency ledger) -----------------------------
CREATE TABLE IF NOT EXISTS sync_operations (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  transaction_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('CREATE','UPDATE','DELETE','RESTORE')),
  applied_at     INTEGER NOT NULL,
  result         TEXT NOT NULL CHECK (result IN ('APPLIED','DUPLICATE_IGNORED','REJECTED'))
);
CREATE INDEX IF NOT EXISTS idx_syncops_user_tx ON sync_operations(user_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_syncops_applied ON sync_operations(applied_at);

-- Lightweight rate-limit counters (20-security.txt section 2.4).
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key  TEXT PRIMARY KEY,
  hits        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_window ON rate_limits(window_start);

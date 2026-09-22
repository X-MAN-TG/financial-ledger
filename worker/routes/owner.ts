/**
 * Owner Panel API (05 section 12, 11-owner-panel.txt).
 * Every route here is behind requireOwner (403 for USER sessions).
 */
import type { HealthReport, OwnerStats, OwnerUserRow } from '../../shared/types';
import {
  columnCreateSchema,
  columnUpdateSchema,
  ownerAuditQuerySchema,
  ownerCreateUserSchema,
  ownerUpdateUserSchema,
} from '../../shared/validation';
import { auditStatement, writeAudit } from '../lib/audit';
import type { Env } from '../lib/config';
import { getMaxUsers } from '../lib/config';
import { newId } from '../lib/crypto';
import {
  batch,
  boolToInt,
  countRows,
  mapAuditEntry,
  mapBackupRecord,
  mapColumnDefinition,
  queryAll,
  queryFirst,
  stmt,
} from '../lib/db';
import { ApiException, conflict, json, notFound } from '../lib/http';
import { countCappedUsers, createUser } from '../lib/users';
import type { SessionContext } from '../middleware/auth';
import { parseBody, parseQuery } from '../middleware/validation';
import { runR2Backup } from '../lib/backup-job';

/* -------------------------------------------------------------- users ---- */

export async function ownerListUsers(env: Env): Promise<Response> {
  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT u.id, u.email, u.role, u.status, u.auth_provider, u.created_at, u.last_login_at,
            p.display_name,
            (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id AND t.is_deleted = 0) AS tx_count
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
      ORDER BY u.created_at ASC`,
  );

  const items: OwnerUserRow[] = rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    displayName: String(r.display_name ?? ''),
    role: r.role as OwnerUserRow['role'],
    status: r.status as OwnerUserRow['status'],
    authProvider: r.auth_provider as OwnerUserRow['authProvider'],
    createdAt: Number(r.created_at),
    lastLoginAt: r.last_login_at === null ? null : Number(r.last_login_at),
    transactionCount: Number(r.tx_count),
  }));

  return json({
    items,
    userCount: await countCappedUsers(env),
    maxUsers: getMaxUsers(env),
  });
}

export async function ownerCreateUser(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, ownerCreateUserSchema);
  // Identical capacity check to self-signup - same function, same source.
  const user = await createUser(
    env,
    {
      email: body.email,
      password: body.tempPassword,
      displayName: body.displayName,
      authProvider: 'PASSWORD',
      role: 'USER',
    },
    { userId: session.userId, actorRole: 'OWNER', action: 'USER_CREATED', scope: 'GLOBAL' },
  );
  return json({ user }, 201);
}

export async function ownerUpdateUser(
  req: Request,
  env: Env,
  session: SessionContext,
  userId: string,
): Promise<Response> {
  const body = await parseBody(req, ownerUpdateUserSchema);
  const target = await queryFirst<{ id: string; role: string; status: string }>(
    env,
    'SELECT id, role, status FROM users WHERE id = ?',
    [userId],
  );
  if (!target) throw notFound('User not found');
  if (target.role === 'OWNER') throw conflict('CONFLICT', 'The owner account cannot be modified here');

  // Reactivating must respect the cap (04 section 6.2).
  if (body.status === 'ACTIVE' && target.status !== 'ACTIVE') {
    const max = getMaxUsers(env);
    const current = await countCappedUsers(env);
    if (current >= max) {
      throw conflict(
        'MAX_USERS_REACHED',
        `Reactivating would exceed the ${max}-account limit. Deactivate another account first.`,
      );
    }
  }

  const now = Date.now();
  const statements = [
    stmt(env, 'UPDATE users SET status = ?, updated_at = ? WHERE id = ?', [
      body.status,
      now,
      userId,
    ]),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'OWNER',
        action: body.status === 'ACTIVE' ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
        resourceType: 'user',
        resourceId: userId,
        scope: 'GLOBAL',
        result: 'SUCCESS',
        metadata: { status: body.status },
      },
      now,
    ),
  ];
  // Revoke live sessions so a disabled user is logged out immediately.
  if (body.status === 'DISABLED') {
    statements.push(stmt(env, 'DELETE FROM sessions WHERE user_id = ?', [userId]));
  }
  await batch(env, statements);

  return json({ ok: true, id: userId, status: body.status });
}

/** DELETE = soft deactivation by default (04 section 6.3, 11 section 2.4). */
export async function ownerDeleteUser(
  env: Env,
  session: SessionContext,
  userId: string,
  url: URL,
): Promise<Response> {
  const target = await queryFirst<{ id: string; role: string }>(
    env,
    'SELECT id, role FROM users WHERE id = ?',
    [userId],
  );
  if (!target) throw notFound('User not found');
  if (target.role === 'OWNER') throw conflict('CONFLICT', 'The owner account cannot be deleted');

  const purge = url.searchParams.get('purge') === 'true';
  const now = Date.now();

  if (!purge) {
    await batch(env, [
      stmt(env, "UPDATE users SET status = 'DISABLED', updated_at = ? WHERE id = ?", [now, userId]),
      stmt(env, 'DELETE FROM sessions WHERE user_id = ?', [userId]),
      auditStatement(
        env,
        {
          userId: session.userId,
          actorRole: 'OWNER',
          action: 'USER_DEACTIVATED',
          resourceType: 'user',
          resourceId: userId,
          scope: 'GLOBAL',
          result: 'SUCCESS',
          metadata: { via: 'DELETE_DEFAULT' },
        },
        now,
      ),
    ]);
    return json({ ok: true, mode: 'DEACTIVATED', id: userId });
  }

  // Explicit, dangerous purge path (11 section 2.4).
  await batch(env, [
    stmt(
      env,
      `DELETE FROM transaction_custom_values
        WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)`,
      [userId],
    ),
    stmt(env, 'DELETE FROM transactions WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM ledger_days WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM customers WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM sync_operations WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM sessions WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM user_settings WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM profiles WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM backup_records WHERE user_id = ?', [userId]),
    // audit_logs rows are intentionally retained (12 section 7.1); detach
    // the FK by nulling the actor rather than destroying the trail.
    stmt(env, 'UPDATE audit_logs SET user_id = NULL WHERE user_id = ?', [userId]),
    stmt(env, 'DELETE FROM users WHERE id = ?', [userId]),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'OWNER',
        action: 'USER_PURGED',
        resourceType: 'user',
        resourceId: userId,
        scope: 'GLOBAL',
        result: 'SUCCESS',
      },
      now,
    ),
  ]);
  return json({ ok: true, mode: 'PURGED', id: userId });
}

/* ------------------------------------------------------------- health ---- */

export async function ownerHealth(
  env: Env,
  session: SessionContext,
  runFresh: boolean,
): Promise<Response> {
  const started = Date.now();
  let d1: HealthReport['d1'] = 'HEALTHY';
  let dbLatencyMs = 0;
  try {
    const t0 = Date.now();
    await queryFirst(env, 'SELECT 1 AS ok');
    dbLatencyMs = Date.now() - t0;
    if (dbLatencyMs > 750) d1 = 'DEGRADED';
  } catch {
    d1 = 'DOWN';
  }

  // Honest R2 probing: an unconfigured bucket is reported as such, never
  // as green (14 section 4).
  let r2: HealthReport['r2'] = 'NOT_CONFIGURED';
  if (env.BACKUP_BUCKET) {
    try {
      await env.BACKUP_BUCKET.head('healthcheck/probe');
      r2 = 'HEALTHY';
    } catch {
      r2 = 'DOWN';
    }
  }

  let auth: HealthReport['auth'] = 'HEALTHY';
  try {
    await countRows(env, 'SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?', [Date.now()]);
  } catch {
    auth = 'DOWN';
  }

  const lastBackup = await queryFirst<{ created_at: number; status: string }>(
    env,
    "SELECT created_at, status FROM backup_records WHERE type = 'SYSTEM_R2_BACKUP' ORDER BY created_at DESC LIMIT 1",
  );

  const syncErrorCount = await countRows(
    env,
    "SELECT COUNT(*) AS c FROM sync_operations WHERE result = 'REJECTED' AND applied_at > ?",
    [Date.now() - 7 * 24 * 60 * 60 * 1000],
  );

  const report: HealthReport = {
    worker: 'HEALTHY',
    d1,
    r2,
    auth,
    dbLatencyMs,
    lastBackupAt: lastBackup ? Number(lastBackup.created_at) : null,
    lastBackupStatus: lastBackup ? (lastBackup.status as HealthReport['lastBackupStatus']) : null,
    userCount: await countCappedUsers(env),
    maxUsers: getMaxUsers(env),
    syncErrorCount,
    checkedAt: started,
  };

  if (runFresh) {
    await writeAudit(env, {
      userId: session.userId,
      actorRole: 'OWNER',
      action: 'HEALTH_CHECK_RUN',
      resourceType: 'system',
      scope: 'GLOBAL',
      result: d1 === 'DOWN' || auth === 'DOWN' ? 'FAILURE' : 'SUCCESS',
      metadata: { d1, r2, auth, dbLatencyMs },
    });
  }

  return json(report);
}

export async function ownerStats(env: Env): Promise<Response> {
  const [users, activeUsers, tx, customers, days, audits] = await Promise.all([
    countRows(env, 'SELECT COUNT(*) AS c FROM users'),
    countRows(env, "SELECT COUNT(*) AS c FROM users WHERE status = 'ACTIVE'"),
    countRows(env, 'SELECT COUNT(*) AS c FROM transactions'),
    countRows(env, 'SELECT COUNT(*) AS c FROM customers'),
    countRows(env, 'SELECT COUNT(*) AS c FROM ledger_days'),
    countRows(env, 'SELECT COUNT(*) AS c FROM audit_logs'),
  ]);

  // Rough byte estimate from row counts; D1 exposes no cheap size query and
  // 11 section 6 only asks for an approximate figure.
  const storageEstimateBytes = tx * 420 + customers * 220 + days * 120 + audits * 260;

  const payload: OwnerStats = {
    totalUsers: users,
    activeUsers,
    totalTransactions: tx,
    totalCustomers: customers,
    totalLedgerDays: days,
    totalAuditEntries: audits,
    storageEstimateBytes,
    maxUsers: getMaxUsers(env),
  };
  return json(payload);
}

/* ------------------------------------------------------------ columns ---- */

export async function ownerListColumns(env: Env): Promise<Response> {
  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT c.*, (SELECT COUNT(*) FROM transaction_custom_values v WHERE v.column_id = c.id) AS value_count
       FROM column_definitions c ORDER BY c.position ASC`,
  );
  return json({
    items: rows.map((r) => ({
      ...mapColumnDefinition(r),
      valueCount: Number(r.value_count ?? 0),
    })),
  });
}

export async function ownerCreateColumn(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, columnCreateSchema);

  const existing = await queryFirst<{ id: string }>(
    env,
    'SELECT id FROM column_definitions WHERE key = ?',
    [body.key],
  );
  if (existing) throw conflict('CONFLICT', 'A column with that key already exists');

  // Custom columns always sort AFTER the 9 system columns (11 section 7.4).
  const maxPos = await queryFirst<{ p: number }>(
    env,
    'SELECT COALESCE(MAX(position), 99) AS p FROM column_definitions WHERE is_system = 0',
  );
  const basePosition = Math.max(100, Number(maxPos?.p ?? 99) + 1);
  const position =
    body.position !== undefined && body.position >= 100 ? body.position : basePosition;

  const id = newId();
  const now = Date.now();
  await batch(env, [
    stmt(
      env,
      `INSERT INTO column_definitions (id, key, label, type, position, is_required, is_active, is_system, select_options, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
      [
        id,
        body.key,
        body.label,
        body.type,
        position,
        boolToInt(body.isRequired),
        body.selectOptions ? JSON.stringify(body.selectOptions) : null,
        now,
        now,
      ],
    ),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'OWNER',
        action: 'COLUMN_CREATED',
        resourceType: 'column_definition',
        resourceId: id,
        scope: 'GLOBAL',
        result: 'SUCCESS',
        metadata: { key: body.key, type: body.type, position },
      },
      now,
    ),
  ]);

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM column_definitions WHERE id = ?',
    [id],
  );
  return json({ column: row ? mapColumnDefinition(row) : null }, 201);
}

export async function ownerUpdateColumn(
  req: Request,
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  const body = await parseBody(req, columnUpdateSchema);
  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM column_definitions WHERE id = ?',
    [id],
  );
  if (!row) throw notFound('Column not found');
  const column = mapColumnDefinition(row);

  const valueCount = await countRows(
    env,
    'SELECT COUNT(*) AS c FROM transaction_custom_values WHERE column_id = ?',
    [id],
  );

  /**
   * 11 section 7.7: system columns cannot be archived, retyped, reordered
   * or made required through this API - only their label may change. This
   * is enforced server-side, not just hidden in the UI (11 section 7.8).
   */
  if (column.isSystem) {
    const attempted = Object.keys(body).filter((k) => k !== 'label' && k !== 'confirmTypeChange');
    if (attempted.length > 0) {
      await writeAudit(env, {
        userId: session.userId,
        actorRole: 'OWNER',
        action: 'COLUMN_UPDATED',
        resourceType: 'column_definition',
        resourceId: id,
        scope: 'GLOBAL',
        result: 'FAILURE',
        metadata: { reason: 'SYSTEM_COLUMN_PROTECTED', attempted },
      });
      throw new ApiException(
        409,
        'SYSTEM_COLUMN_PROTECTED',
        'Standard columns may only have their label changed',
      );
    }
  }

  // 11 section 7.5(a): disallow retyping a column that already holds data.
  if (body.type && body.type !== column.type && valueCount > 0 && !body.confirmTypeChange) {
    throw new ApiException(
      409,
      'COLUMN_HAS_DATA',
      `This column already holds ${valueCount} values. Confirm the type change to proceed; stored values are preserved as text.`,
    );
  }

  const now = Date.now();
  const nextActive = body.isActive !== undefined ? body.isActive : column.isActive;
  const archived = column.isActive && nextActive === false;
  const reactivated = !column.isActive && nextActive === true;

  await batch(env, [
    stmt(
      env,
      `UPDATE column_definitions
          SET label = ?, position = ?, is_required = ?, is_active = ?, type = ?, select_options = ?, updated_at = ?
        WHERE id = ?`,
      [
        body.label ?? column.label,
        column.isSystem ? column.position : (body.position ?? column.position),
        column.isSystem ? boolToInt(column.isRequired) : boolToInt(body.isRequired ?? column.isRequired),
        boolToInt(nextActive),
        column.isSystem ? column.type : (body.type ?? column.type),
        body.selectOptions
          ? JSON.stringify(body.selectOptions)
          : column.selectOptions
            ? JSON.stringify(column.selectOptions)
            : null,
        now,
        id,
      ],
    ),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'OWNER',
        action: archived ? 'COLUMN_ARCHIVED' : reactivated ? 'COLUMN_REACTIVATED' : 'COLUMN_UPDATED',
        resourceType: 'column_definition',
        resourceId: id,
        scope: 'GLOBAL',
        result: 'SUCCESS',
        metadata: { fields: Object.keys(body), preservedValues: valueCount },
      },
      now,
    ),
  ]);

  const fresh = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM column_definitions WHERE id = ?',
    [id],
  );
  return json({ column: fresh ? mapColumnDefinition(fresh) : null, preservedValues: valueCount });
}

/**
 * DELETE = archive (is_active = 0). Data-bearing columns are NEVER truly
 * deleted (11 section 7.6). A column with zero stored values may be hard
 * deleted only with ?hard=true.
 */
export async function ownerDeleteColumn(
  env: Env,
  session: SessionContext,
  id: string,
  url: URL,
): Promise<Response> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM column_definitions WHERE id = ?',
    [id],
  );
  if (!row) throw notFound('Column not found');
  const column = mapColumnDefinition(row);

  if (column.isSystem) {
    await writeAudit(env, {
      userId: session.userId,
      actorRole: 'OWNER',
      action: 'COLUMN_ARCHIVED',
      resourceType: 'column_definition',
      resourceId: id,
      scope: 'GLOBAL',
      result: 'FAILURE',
      metadata: { reason: 'SYSTEM_COLUMN_PROTECTED' },
    });
    throw new ApiException(
      409,
      'SYSTEM_COLUMN_PROTECTED',
      'Standard ledger columns cannot be removed',
    );
  }

  const valueCount = await countRows(
    env,
    'SELECT COUNT(*) AS c FROM transaction_custom_values WHERE column_id = ?',
    [id],
  );
  const hard = url.searchParams.get('hard') === 'true';
  const now = Date.now();

  if (hard && valueCount === 0) {
    await batch(env, [
      stmt(env, 'DELETE FROM column_definitions WHERE id = ?', [id]),
      auditStatement(
        env,
        {
          userId: session.userId,
          actorRole: 'OWNER',
          action: 'COLUMN_DELETED',
          resourceType: 'column_definition',
          resourceId: id,
          scope: 'GLOBAL',
          result: 'SUCCESS',
          metadata: { key: column.key, hadValues: 0 },
        },
        now,
      ),
    ]);
    return json({ ok: true, mode: 'DELETED', preservedValues: 0 });
  }

  if (hard && valueCount > 0) {
    throw new ApiException(
      409,
      'COLUMN_HAS_DATA',
      `This column holds ${valueCount} stored values and can only be archived, never deleted.`,
    );
  }

  await batch(env, [
    stmt(env, 'UPDATE column_definitions SET is_active = 0, updated_at = ? WHERE id = ?', [
      now,
      id,
    ]),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'OWNER',
        action: 'COLUMN_ARCHIVED',
        resourceType: 'column_definition',
        resourceId: id,
        scope: 'GLOBAL',
        result: 'SUCCESS',
        metadata: { key: column.key, preservedValues: valueCount },
      },
      now,
    ),
  ]);
  return json({ ok: true, mode: 'ARCHIVED', preservedValues: valueCount });
}

/* -------------------------------------------------------------- audit ---- */

export async function ownerAudit(env: Env, url: URL): Promise<Response> {
  const q = parseQuery(url, ownerAuditQuerySchema);
  const offset = (q.page - 1) * q.pageSize;

  const params: unknown[] = [];
  const where: string[] = ['1 = 1'];
  if (q.userId) {
    where.push('a.user_id = ?');
    params.push(q.userId);
  }
  if (q.action) {
    where.push('a.action = ?');
    params.push(q.action);
  }
  if (q.scope && q.scope !== 'ANY') {
    where.push('a.scope = ?');
    params.push(q.scope);
  }
  if (q.from) {
    where.push('a.created_at >= ?');
    params.push(new Date(`${q.from}T00:00:00`).getTime());
  }
  if (q.to) {
    where.push('a.created_at <= ?');
    params.push(new Date(`${q.to}T23:59:59.999`).getTime());
  }

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT a.*, u.email AS actor_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset],
  );
  const totalRow = await queryFirst<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM audit_logs a WHERE ${where.join(' AND ')}`,
    params,
  );

  return json({
    items: rows.map(mapAuditEntry),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow ? Number(totalRow.c) : 0,
  });
}

/* ------------------------------------------------------------- backup ---- */

export async function ownerTriggerBackup(
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const result = await runR2Backup(env, { actorId: session.userId, actorRole: 'OWNER' });
  return json(result, result.status === 'SUCCESS' ? 200 : 500);
}

export async function ownerBackupHistory(env: Env, url: URL): Promise<Response> {
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = 25;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = await queryAll<Record<string, unknown>>(
    env,
    'SELECT * FROM backup_records ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [pageSize, offset],
  );
  const total = await countRows(env, 'SELECT COUNT(*) AS c FROM backup_records');
  return json({ items: rows.map(mapBackupRecord), page, pageSize, total });
}

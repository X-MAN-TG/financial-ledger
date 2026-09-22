/**
 * User creation shared by self-signup and Owner-created accounts, so the
 * MAX_USERS check and the provisioning steps are literally the same code
 * path (11-owner-panel.txt 2.2, 21-testing section 11 first bullet).
 */
import type { AuthProvider, Role } from '../../shared/constants';
import type { SessionUser } from '../../shared/types';
import type { Env } from './config';
import { getMaxUsers } from './config';
import { auditStatement } from './audit';
import { hashPassword, newId } from './crypto';
import { batch, countRows, queryFirst, stmt, type DbUserRow } from './db';
import { conflict } from './http';

export function toSessionUser(row: DbUserRow, displayName: string): SessionUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role as Role,
    status: row.status as SessionUser['status'],
    authProvider: row.auth_provider as AuthProvider,
    displayName,
    createdAt: Number(row.created_at),
  };
}

/** Active, non-OWNER accounts count against the cap (04 section 2.1). */
export async function countCappedUsers(env: Env): Promise<number> {
  return countRows(
    env,
    "SELECT COUNT(*) AS c FROM users WHERE role != 'OWNER' AND status = 'ACTIVE'",
  );
}

export async function assertCapacity(
  env: Env,
  actor: { userId: string | null; actorRole: 'USER' | 'OWNER' | 'SYSTEM' },
): Promise<void> {
  const max = getMaxUsers(env);
  const current = await countCappedUsers(env);
  if (current >= max) {
    // Logged so the Owner can see the cap being hit (12 section 3).
    const { writeAudit } = await import('./audit');
    await writeAudit(env, {
      userId: actor.userId,
      actorRole: actor.actorRole,
      action: 'MAX_USERS_LIMIT_REACHED',
      resourceType: 'user',
      scope: 'GLOBAL',
      result: 'FAILURE',
      metadata: { current, max },
    });
    throw conflict(
      'MAX_USERS_REACHED',
      `This deployment is limited to ${max} accounts and is currently full.`,
    );
  }
}

export async function findUserByEmail(env: Env, email: string): Promise<DbUserRow | null> {
  return queryFirst<DbUserRow>(env, 'SELECT * FROM users WHERE email = ?', [email]);
}

export async function findUserById(env: Env, id: string): Promise<DbUserRow | null> {
  return queryFirst<DbUserRow>(env, 'SELECT * FROM users WHERE id = ?', [id]);
}

export interface CreateUserInput {
  email: string;
  password?: string | null;
  googleSub?: string | null;
  displayName: string;
  role?: Role;
  authProvider: AuthProvider;
}

export interface CreateUserActor {
  userId: string | null;
  actorRole: 'USER' | 'OWNER' | 'SYSTEM';
  action: 'SIGNUP_SUCCESS' | 'USER_CREATED';
  scope: 'USER' | 'GLOBAL';
}

/**
 * Creates users + profiles + user_settings + the audit row in one D1 batch
 * so a half-provisioned account can never exist.
 */
export async function createUser(
  env: Env,
  input: CreateUserInput,
  actor: CreateUserActor,
): Promise<SessionUser> {
  const existing = await findUserByEmail(env, input.email);
  if (existing) throw conflict('EMAIL_TAKEN', 'An account with that email already exists');

  const role: Role = input.role ?? 'USER';
  if (role !== 'OWNER') {
    await assertCapacity(env, { userId: actor.userId, actorRole: actor.actorRole });
  }

  const id = newId();
  const now = Date.now();
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  await batch(env, [
    stmt(
      env,
      `INSERT INTO users (id, email, password_hash, auth_provider, google_sub, role, status, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, ?)`,
      [id, input.email, passwordHash, input.authProvider, input.googleSub ?? null, role, now, now],
    ),
    stmt(
      env,
      `INSERT INTO profiles (user_id, display_name, full_name, avatar_url, bio, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, ?, ?)`,
      [id, input.displayName, now, now],
    ),
    stmt(
      env,
      `INSERT INTO user_settings (user_id, theme, date_format, updated_at)
       VALUES (?, 'light', 'DD MMM YYYY', ?)`,
      [id, now],
    ),
    auditStatement(
      env,
      {
        userId: actor.userId ?? id,
        actorRole: actor.actorRole,
        action: actor.action,
        resourceType: 'user',
        resourceId: id,
        scope: actor.scope,
        result: 'SUCCESS',
        metadata: { email: input.email, role, authProvider: input.authProvider },
      },
      now,
    ),
  ]);

  return {
    id,
    email: input.email,
    role,
    status: 'ACTIVE',
    authProvider: input.authProvider,
    displayName: input.displayName,
    createdAt: now,
  };
}

export async function getDisplayName(env: Env, userId: string): Promise<string> {
  const row = await queryFirst<{ display_name: string }>(
    env,
    'SELECT display_name FROM profiles WHERE user_id = ?',
    [userId],
  );
  return row?.display_name ?? '';
}

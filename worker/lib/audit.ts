/**
 * Audit logging (12-audit-logging.txt).
 *
 * `auditStatement` returns a prepared statement so callers can include the
 * audit row in the SAME D1 batch as the mutation it describes (12 s6.1) -
 * an audit entry is never silently dropped while the mutation succeeds.
 * `writeAudit` is the fire-and-forget variant for standalone events
 * (logins, health checks) that have no accompanying row mutation.
 */
import type { AuditAction, AuditActorRole, AuditResult, AuditScope } from '../../shared/constants';
import type { Env } from './config';
import { newId } from './crypto';
import { execute, stmt } from './db';

export interface AuditInput {
  userId: string | null;
  actorRole: AuditActorRole;
  action: AuditAction | string;
  resourceType: string;
  resourceId?: string | null;
  scope: AuditScope;
  result: AuditResult;
  metadata?: Record<string, unknown> | null;
}

/**
 * Defence in depth: even though callers are expected to pass only safe
 * fields, strip anything that looks like a credential before persisting
 * (12 section 5 / 20 section 5.2).
 */
const FORBIDDEN_META_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'session',
  'sessionid',
  'secret',
  'authorization',
  'cookie',
  'csrf',
  'ip',
  'accesstoken',
  'idtoken',
  'refreshtoken',
];

export function sanitizeMetadata(
  meta: Record<string, unknown> | null | undefined,
): string | null {
  if (!meta) return null;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const norm = k.toLowerCase().replace(/[^a-z]/g, '');
    if (FORBIDDEN_META_KEYS.some((f) => norm.includes(f))) continue;
    if (v === null || v === undefined) {
      safe[k] = null;
    } else if (typeof v === 'string') {
      safe[k] = v.length > 300 ? `${v.slice(0, 300)}...` : v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      safe[k] = v;
    } else if (Array.isArray(v)) {
      safe[k] = v.slice(0, 40).map((x) => (typeof x === 'object' ? '[object]' : x));
    } else {
      safe[k] = '[object]';
    }
  }
  const json = JSON.stringify(safe);
  return json.length > 4000 ? json.slice(0, 4000) : json;
}

const INSERT_SQL = `INSERT INTO audit_logs
  (id, user_id, actor_role, action, resource_type, resource_id, scope, result, metadata, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function auditStatement(env: Env, input: AuditInput, at = Date.now()): D1PreparedStatement {
  return stmt(env, INSERT_SQL, [
    newId(),
    input.userId,
    input.actorRole,
    input.action,
    input.resourceType,
    input.resourceId ?? null,
    input.scope,
    input.result,
    sanitizeMetadata(input.metadata),
    at,
  ]);
}

export async function writeAudit(env: Env, input: AuditInput, at = Date.now()): Promise<void> {
  try {
    await execute(env, INSERT_SQL, [
      newId(),
      input.userId,
      input.actorRole,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.scope,
      input.result,
      sanitizeMetadata(input.metadata),
      at,
    ]);
  } catch (e) {
    // Never let audit failure break the user-facing operation, but make it
    // loud in logs so it can be investigated.
    console.error('AUDIT_WRITE_FAILED', input.action, e instanceof Error ? e.message : String(e));
  }
}

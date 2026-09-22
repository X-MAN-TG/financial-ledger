/**
 * GET /api/audit/me (05 section 11, 12 section 2.1).
 * Always filtered to user_id = self regardless of scope, so a USER can
 * never see another user's or a GLOBAL-only administrative entry.
 */
import { auditMeQuerySchema } from '../../shared/validation';
import { USER_AUDIT_MIN_RETENTION_DAYS } from '../../shared/constants';
import type { Env } from '../lib/config';
import { mapAuditEntry, queryAll, queryFirst } from '../lib/db';
import { json } from '../lib/http';
import type { SessionContext } from '../middleware/auth';
import { parseQuery } from '../middleware/validation';

export async function getMyAudit(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, auditMeQuerySchema);
  const offset = (q.page - 1) * q.pageSize;

  const params: unknown[] = [session.userId];
  let where = 'user_id = ?';
  if (q.from) {
    where += ' AND created_at >= ?';
    params.push(new Date(`${q.from}T00:00:00`).getTime());
  }
  if (q.to) {
    where += ' AND created_at <= ?';
    params.push(new Date(`${q.to}T23:59:59.999`).getTime());
  }

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset],
  );
  const totalRow = await queryFirst<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM audit_logs WHERE ${where}`,
    params,
  );

  return json({
    items: rows.map(mapAuditEntry),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow ? Number(totalRow.c) : 0,
    minRetentionDays: USER_AUDIT_MIN_RETENTION_DAYS,
  });
}

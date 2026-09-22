/**
 * R2 backup job (14-backup-and-recovery.txt, 22 section 5.1).
 *
 * HARD RULE (14 section 4): never report success unless the R2 PUT actually
 * succeeded AND a basic integrity check passed. A partial/failed backup is
 * recorded with status FAILURE and surfaced, never silently swallowed.
 */
import { writeAudit } from './audit';
import type { Env } from './config';
import { getBackupRetentionDays } from './config';
import { newId } from './crypto';
import { execute, queryAll, queryFirst } from './db';

export interface BackupOutcome {
  backupRecordId: string;
  status: 'SUCCESS' | 'FAILURE';
  fileRef?: string;
  sizeBytes?: number;
  error?: string;
}

const TABLES = [
  'users',
  'profiles',
  'user_settings',
  'customers',
  'ledger_days',
  'transactions',
  'column_definitions',
  'transaction_custom_values',
  'backup_records',
] as const;

/** Columns we must never copy into a backup artifact (20 section 5). */
const REDACT: Record<string, string[]> = {
  users: ['password_hash', 'google_sub'],
};

export async function runR2Backup(
  env: Env,
  actor: { actorId: string | null; actorRole: 'OWNER' | 'SYSTEM' },
): Promise<BackupOutcome> {
  const id = newId();
  const now = Date.now();

  await execute(
    env,
    `INSERT INTO backup_records (id, user_id, type, status, file_ref, size_bytes, error_message, created_at)
     VALUES (?, NULL, 'SYSTEM_R2_BACKUP', 'IN_PROGRESS', NULL, NULL, NULL, ?)`,
    [id, now],
  );
  await writeAudit(env, {
    userId: actor.actorId,
    actorRole: actor.actorRole,
    action: 'BACKUP_TRIGGERED',
    resourceType: 'backup_record',
    resourceId: id,
    scope: 'GLOBAL',
    result: 'SUCCESS',
  });

  const fail = async (message: string): Promise<BackupOutcome> => {
    await execute(
      env,
      "UPDATE backup_records SET status = 'FAILURE', error_message = ? WHERE id = ?",
      [message.slice(0, 400), id],
    );
    await writeAudit(env, {
      userId: actor.actorId,
      actorRole: actor.actorRole,
      action: 'BACKUP_FAILED',
      resourceType: 'backup_record',
      resourceId: id,
      scope: 'GLOBAL',
      result: 'FAILURE',
      metadata: { reason: message.slice(0, 200) },
    });
    return { backupRecordId: id, status: 'FAILURE', error: message };
  };

  if (!env.BACKUP_BUCKET) {
    return fail('R2 bucket binding is not configured for this environment');
  }

  try {
    const snapshot: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const table of TABLES) {
      const rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM ${table}`);
      const redactCols = REDACT[table] ?? [];
      snapshot[table] = rows.map((r) => {
        if (redactCols.length === 0) return r;
        const copy = { ...r };
        for (const c of redactCols) if (c in copy) copy[c] = null;
        return copy;
      });
      counts[table] = rows.length;
    }

    const body = JSON.stringify({
      version: 1,
      generatedAt: now,
      counts,
      tables: snapshot,
    });
    const bytes = new TextEncoder().encode(body);
    const key = `backups/${new Date(now).toISOString().slice(0, 10)}/${id}.json`;

    await env.BACKUP_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { generatedAt: String(now), transactions: String(counts.transactions ?? 0) },
    });

    // Integrity verification: read back the object and compare size/rows.
    const head = await env.BACKUP_BUCKET.head(key);
    if (!head) return fail('Backup object could not be verified after upload');
    if (head.size !== bytes.byteLength) {
      return fail(`Size mismatch after upload (expected ${bytes.byteLength}, got ${head.size})`);
    }

    const liveTxCount = await queryFirst<{ c: number }>(
      env,
      'SELECT COUNT(*) AS c FROM transactions',
    );
    if (liveTxCount && Number(liveTxCount.c) !== (counts.transactions ?? -1)) {
      return fail('Row-count sanity check failed between snapshot and database');
    }

    await execute(
      env,
      "UPDATE backup_records SET status = 'SUCCESS', file_ref = ?, size_bytes = ? WHERE id = ?",
      [key, bytes.byteLength, id],
    );
    await writeAudit(env, {
      userId: actor.actorId,
      actorRole: actor.actorRole,
      action: 'BACKUP_SUCCEEDED',
      resourceType: 'backup_record',
      resourceId: id,
      scope: 'GLOBAL',
      result: 'SUCCESS',
      metadata: { sizeBytes: bytes.byteLength, transactions: counts.transactions },
    });

    await pruneOldBackups(env).catch(() => undefined);

    return { backupRecordId: id, status: 'SUCCESS', fileRef: key, sizeBytes: bytes.byteLength };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Unknown backup failure');
  }
}

/** Retention is configuration-driven, not a hard-coded constant (22 s9). */
async function pruneOldBackups(env: Env): Promise<void> {
  if (!env.BACKUP_BUCKET) return;
  const days = getBackupRetentionDays(env);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const old = await queryAll<{ id: string; file_ref: string | null }>(
    env,
    "SELECT id, file_ref FROM backup_records WHERE type = 'SYSTEM_R2_BACKUP' AND status = 'SUCCESS' AND created_at < ?",
    [cutoff],
  );
  for (const row of old) {
    if (!row.file_ref) continue;
    await env.BACKUP_BUCKET.delete(row.file_ref).catch(() => undefined);
    await execute(env, "UPDATE backup_records SET file_ref = NULL, error_message = 'pruned' WHERE id = ?", [
      row.id,
    ]).catch(() => undefined);
  }
}

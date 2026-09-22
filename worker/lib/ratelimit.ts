/**
 * Lightweight fixed-window rate limiting for auth endpoints
 * (20-security.txt section 2.4). Backed by a small D1 table because a
 * Worker holds no cross-request memory (02 section 4.2).
 *
 * Kept deliberately cheap: one UPSERT + one read per guarded request.
 */
import type { Env } from './config';
import { getRateLimitScale } from './config';
import { queryFirst, execute } from './db';
import { sha256Hex } from './crypto';
import { rateLimited } from './http';

export interface RateLimitRule {
  /** Window length in ms. */
  windowMs: number;
  /** Max hits allowed inside the window. */
  max: number;
}

export const LOGIN_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 10 };
export const SIGNUP_RULE: RateLimitRule = { windowMs: 60 * 60 * 1000, max: 5 };
export const OWNER_LOGIN_RULE: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 8 };

/**
 * @param scope   logical bucket, e.g. 'login:ip' or 'login:email'
 * @param subject the raw identifier; hashed before storage so no raw IP or
 *                email is persisted in the counters table (12 section 5).
 */
export async function enforceRateLimit(
  env: Env,
  scope: string,
  subject: string | null,
  rule: RateLimitRule,
): Promise<void> {
  if (!subject) return;
  const max = rule.max * getRateLimitScale(env);
  const key = `${scope}:${(await sha256Hex(subject)).slice(0, 24)}`;
  const now = Date.now();
  const windowStart = now - (now % rule.windowMs);

  const row = await queryFirst<{ hits: number; window_start: number }>(
    env,
    'SELECT hits, window_start FROM rate_limits WHERE bucket_key = ?',
    [key],
  );

  if (!row || Number(row.window_start) !== windowStart) {
    await execute(
      env,
      `INSERT INTO rate_limits (bucket_key, hits, window_start) VALUES (?, 1, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET hits = 1, window_start = excluded.window_start`,
      [key, windowStart],
    );
    return;
  }

  if (Number(row.hits) >= max) throw rateLimited();

  await execute(env, 'UPDATE rate_limits SET hits = hits + 1 WHERE bucket_key = ?', [key]);
}

/** Clear a bucket after a successful auth so honest users aren't punished. */
export async function clearRateLimit(
  env: Env,
  scope: string,
  subject: string | null,
): Promise<void> {
  if (!subject) return;
  const key = `${scope}:${(await sha256Hex(subject)).slice(0, 24)}`;
  await execute(env, 'DELETE FROM rate_limits WHERE bucket_key = ?', [key]).catch(
    () => undefined,
  );
}

/** Housekeeping, called from the cron trigger. */
export async function purgeOldRateLimits(env: Env): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  await execute(env, 'DELETE FROM rate_limits WHERE window_start < ?', [cutoff]).catch(
    () => undefined,
  );
}

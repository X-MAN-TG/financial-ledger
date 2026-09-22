/**
 * Worker environment + configuration.
 *
 * MAX_USERS (02-architecture.txt 6.1, 22-deployment 3): read from the
 * environment binding at request time. `getMaxUsers` is the ONLY place any
 * code may obtain the limit; no route handler, UI string or test may inline
 * the number.
 */
import { DEFAULT_MAX_USERS } from '../../shared/constants';

export interface Env {
  DB: D1Database;
  BACKUP_BUCKET?: R2Bucket;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };

  // Vars
  MAX_USERS?: string;
  APP_ENV?: string;
  BACKUP_RETENTION_DAYS?: string;
  /** Test-only; ignored when APP_ENV=production. See getRateLimitScale. */
  RELAX_RATE_LIMITS?: string;

  // Secrets
  SESSION_SIGNING_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  OWNER_BOOTSTRAP_SECRET?: string;
}

/** Single source of truth for the account cap. */
export function getMaxUsers(env: Env): number {
  const raw = env.MAX_USERS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_MAX_USERS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_USERS;
  return Math.floor(n);
}

export function getAppEnv(env: Env): string {
  return env.APP_ENV ?? 'development';
}

export function isProduction(env: Env): boolean {
  return getAppEnv(env) === 'production';
}

/**
 * Auth rate limits may be relaxed for automated test runs, but NEVER in
 * production: the guard below ignores the flag when APP_ENV=production, so
 * a misconfigured secret can't silently disable brute-force protection.
 */
export function getRateLimitScale(env: Env): number {
  if (isProduction(env)) return 1;
  if (env.RELAX_RATE_LIMITS !== '1') return 1;
  return 50;
}

export function getBackupRetentionDays(env: Env): number {
  const n = Number(env.BACKUP_RETENTION_DAYS ?? '30');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

/**
 * Cookies must be Secure in production. Local dev over plain http would
 * otherwise drop the session cookie entirely.
 */
export function useSecureCookies(env: Env, url: URL): boolean {
  if (isProduction(env)) return true;
  return url.protocol === 'https:';
}

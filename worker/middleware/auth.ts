/**
 * Session resolution, role enforcement and CSRF.
 *
 * 04-authentication-and-authorization.txt section 4:
 *   - resolve the session from the cookie (never from the body)
 *   - 401 if missing/expired
 *   - user_id comes from the session, never from client input
 *   - DISABLED accounts are rejected with 403 (section 6.1)
 * 20-security.txt 6.2: cookie sessions + a custom-header CSRF check that a
 * cross-site form post cannot replicate.
 */
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  SESSION_REFRESH_THRESHOLD_MS,
  SESSION_TTL_MS,
} from '../../shared/constants';
import type { Role } from '../../shared/constants';
import type { Env } from '../lib/config';
import { useSecureCookies } from '../lib/config';
import { constantTimeStringEqual, generateToken, newId } from '../lib/crypto';
import { execute, queryFirst } from '../lib/db';
import { ApiException, forbidden, unauthenticated } from '../lib/http';

export interface SessionContext {
  sessionId: string;
  userId: string;
  role: Role;
  email: string;
  status: string;
  displayName: string;
  csrfToken: string;
  expiresAt: number;
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie');
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

interface SessionJoinRow {
  id: string;
  user_id: string;
  role: string;
  csrf_token: string;
  expires_at: number;
  email: string;
  status: string;
  user_role: string;
  display_name: string | null;
}

/** Resolve the caller's session, or null when unauthenticated. */
export async function resolveSession(req: Request, env: Env): Promise<SessionContext | null> {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const row = await queryFirst<SessionJoinRow>(
    env,
    `SELECT s.id, s.user_id, s.role, s.csrf_token, s.expires_at,
            u.email, u.status, u.role AS user_role, p.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
      WHERE s.id = ?`,
    [token],
  );
  if (!row) return null;

  const now = Date.now();
  if (Number(row.expires_at) <= now) {
    // Expired: clean it up opportunistically.
    await execute(env, 'DELETE FROM sessions WHERE id = ?', [row.id]).catch(() => undefined);
    return null;
  }

  return {
    sessionId: row.id,
    userId: row.user_id,
    // The user table's role is authoritative; the session copy is a cache.
    role: (row.user_role as Role) ?? 'USER',
    email: row.email,
    status: row.status,
    displayName: row.display_name ?? row.email,
    csrfToken: row.csrf_token,
    expiresAt: Number(row.expires_at),
  };
}

/** Sliding expiry, rewritten at most once a day to avoid a write per request. */
export async function touchSession(env: Env, session: SessionContext): Promise<void> {
  const now = Date.now();
  const newExpiry = now + SESSION_TTL_MS;
  if (newExpiry - session.expiresAt < SESSION_REFRESH_THRESHOLD_MS) return;
  await execute(env, 'UPDATE sessions SET expires_at = ? WHERE id = ?', [
    newExpiry,
    session.sessionId,
  ]).catch(() => undefined);
}

export async function requireSession(req: Request, env: Env): Promise<SessionContext> {
  const session = await resolveSession(req, env);
  if (!session) throw unauthenticated();
  if (session.status === 'DISABLED') {
    // 04 section 6.1 - force sign-out client-side.
    throw new ApiException(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  }
  return session;
}

/** User-surface routes. An OWNER session is NOT a user session (11 s1.2). */
export async function requireUser(req: Request, env: Env): Promise<SessionContext> {
  const session = await requireSession(req, env);
  if (session.role !== 'USER') {
    throw forbidden('This area is for user accounts only');
  }
  return session;
}

/** /api/owner/* routes: role must be OWNER (04 section 4.3 -> 403). */
export async function requireOwner(req: Request, env: Env): Promise<SessionContext> {
  const session = await requireSession(req, env);
  if (session.role !== 'OWNER') {
    throw forbidden('Owner access required');
  }
  return session;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF double-submit: mutating requests must echo the CSRF cookie in a
 * custom header. A cross-site <form> post cannot set custom headers, and
 * cross-origin JS cannot read the cookie.
 */
export function enforceCsrf(req: Request, session: SessionContext): void {
  if (SAFE_METHODS.has(req.method)) return;
  const header = req.headers.get(CSRF_HEADER);
  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE];
  if (!header || !cookieToken) {
    throw new ApiException(403, 'CSRF_FAILED', 'Missing CSRF token');
  }
  if (
    !constantTimeStringEqual(header, cookieToken) ||
    !constantTimeStringEqual(header, session.csrfToken)
  ) {
    throw new ApiException(403, 'CSRF_FAILED', 'Invalid CSRF token');
  }
}

export interface CreatedSession {
  sessionId: string;
  csrfToken: string;
  cookies: string[];
}

export async function createSession(
  env: Env,
  url: URL,
  user: { id: string; role: Role },
  req: Request,
  ipHash: string | null,
): Promise<CreatedSession> {
  const sessionId = generateToken(32);
  const csrfToken = generateToken(24);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;

  await execute(
    env,
    `INSERT INTO sessions (id, user_id, role, csrf_token, created_at, expires_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, user.id, user.role, csrfToken, now, expiresAt, ua, ipHash],
  );

  return {
    sessionId,
    csrfToken,
    cookies: buildSessionCookies(env, url, sessionId, csrfToken, expiresAt),
  };
}

export function buildSessionCookies(
  env: Env,
  url: URL,
  sessionId: string,
  csrfToken: string,
  expiresAt: number,
): string[] {
  const secure = useSecureCookies(env, url) ? '; Secure' : '';
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return [
    // HttpOnly: unreachable from injected script (20 section 2.2).
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`,
    // Readable by our own JS so it can be echoed in the CSRF header.
    `${CSRF_COOKIE}=${csrfToken}; Path=/${secure}; SameSite=Lax; Max-Age=${maxAge}`,
  ];
}

export function clearSessionCookies(env: Env, url: URL): string[] {
  const secure = useSecureCookies(env, url) ? '; Secure' : '';
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/${secure}; SameSite=Lax; Max-Age=0`,
  ];
}

export async function destroySession(env: Env, sessionId: string): Promise<void> {
  await execute(env, 'DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export function withCookies(res: Response, cookies: string[]): Response {
  const headers = new Headers(res.headers);
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function clientIp(req: Request): string | null {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}

export function newOperationId(): string {
  return newId();
}

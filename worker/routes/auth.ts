/**
 * Auth routes (05 section 2, 04 sections 2-3).
 * Public: signup, login, google start/callback, owner login, owner bootstrap.
 */
import { CSRF_COOKIE, SESSION_COOKIE } from '../../shared/constants';
import {
  loginSchema,
  ownerBootstrapSchema,
  ownerLoginSchema,
  signupSchema,
} from '../../shared/validation';
import type { Env } from '../lib/config';
import { getMaxUsers, useSecureCookies } from '../lib/config';
import { writeAudit } from '../lib/audit';
import { hashIp, verifyPassword, newId } from '../lib/crypto';
import { execute, queryFirst, type DbUserRow } from '../lib/db';
import { ApiException, json, noContent, badRequest, unauthenticated, forbidden } from '../lib/http';
import {
  LOGIN_RULE,
  OWNER_LOGIN_RULE,
  SIGNUP_RULE,
  clearRateLimit,
  enforceRateLimit,
} from '../lib/ratelimit';
import {
  clientIp,
  clearSessionCookies,
  createSession,
  destroySession,
  resolveSession,
  withCookies,
} from '../middleware/auth';
import { parseBody } from '../middleware/validation';
import { createUser, findUserByEmail, getDisplayName, toSessionUser } from '../lib/users';

const IP_SALT = 'ledger-ip-salt-v1';

async function ipHashOf(req: Request): Promise<string | null> {
  return hashIp(clientIp(req), IP_SALT);
}

export async function handleSignup(req: Request, env: Env, url: URL): Promise<Response> {
  const ip = clientIp(req);
  await enforceRateLimit(env, 'signup:ip', ip, SIGNUP_RULE);

  const body = await parseBody(req, signupSchema);
  await enforceRateLimit(env, 'signup:email', body.email, SIGNUP_RULE);

  const user = await createUser(
    env,
    {
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      authProvider: 'PASSWORD',
      role: 'USER',
    },
    { userId: null, actorRole: 'USER', action: 'SIGNUP_SUCCESS', scope: 'USER' },
  );

  const session = await createSession(env, url, user, req, await ipHashOf(req));
  await execute(env, 'UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), user.id]);
  await writeAudit(env, {
    userId: user.id,
    actorRole: 'USER',
    action: 'LOGIN_SUCCESS',
    resourceType: 'session',
    resourceId: null,
    scope: 'USER',
    result: 'SUCCESS',
    metadata: { via: 'signup' },
  });

  return withCookies(json({ user }, 201), session.cookies);
}

export async function handleLogin(req: Request, env: Env, url: URL): Promise<Response> {
  const ip = clientIp(req);
  await enforceRateLimit(env, 'login:ip', ip, LOGIN_RULE);

  const body = await parseBody(req, loginSchema);
  await enforceRateLimit(env, 'login:email', body.email, LOGIN_RULE);

  const row = await findUserByEmail(env, body.email);
  const ok = row ? await verifyPassword(body.password, row.password_hash) : false;

  if (!row || !ok) {
    await writeAudit(env, {
      userId: row?.id ?? null,
      actorRole: row?.role === 'OWNER' ? 'OWNER' : 'USER',
      action: 'LOGIN_FAILURE',
      resourceType: 'session',
      scope: row?.role === 'OWNER' ? 'GLOBAL' : 'USER',
      result: 'FAILURE',
      metadata: { email: body.email, reason: row ? 'BAD_PASSWORD' : 'NO_ACCOUNT' },
    });
    throw new ApiException(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  if (row.status === 'DISABLED') {
    await writeAudit(env, {
      userId: row.id,
      actorRole: 'USER',
      action: 'LOGIN_FAILURE',
      resourceType: 'session',
      scope: 'USER',
      result: 'FAILURE',
      metadata: { reason: 'DISABLED' },
    });
    throw new ApiException(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  }

  // The owner must use the dedicated owner path (04 section 3.1).
  if (row.role === 'OWNER') {
    await writeAudit(env, {
      userId: row.id,
      actorRole: 'OWNER',
      action: 'LOGIN_FAILURE',
      resourceType: 'session',
      scope: 'GLOBAL',
      result: 'FAILURE',
      metadata: { reason: 'WRONG_LOGIN_SURFACE' },
    });
    throw new ApiException(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  const displayName = await getDisplayName(env, row.id);
  const user = toSessionUser(row, displayName);
  const session = await createSession(env, url, user, req, await ipHashOf(req));

  await execute(env, 'UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), row.id]);
  await clearRateLimit(env, 'login:email', body.email);
  await writeAudit(env, {
    userId: row.id,
    actorRole: 'USER',
    action: 'LOGIN_SUCCESS',
    resourceType: 'session',
    scope: 'USER',
    result: 'SUCCESS',
  });

  return withCookies(json({ user }), session.cookies);
}

export async function handleOwnerLogin(req: Request, env: Env, url: URL): Promise<Response> {
  const ip = clientIp(req);
  await enforceRateLimit(env, 'ownerlogin:ip', ip, OWNER_LOGIN_RULE);

  const body = await parseBody(req, ownerLoginSchema);
  await enforceRateLimit(env, 'ownerlogin:email', body.email, OWNER_LOGIN_RULE);

  const row = await findUserByEmail(env, body.email);
  const ok = row ? await verifyPassword(body.password, row.password_hash) : false;

  if (!row || !ok || row.role !== 'OWNER') {
    await writeAudit(env, {
      userId: row?.id ?? null,
      actorRole: 'OWNER',
      action: 'OWNER_LOGIN_FAILURE',
      resourceType: 'session',
      scope: 'GLOBAL',
      result: 'FAILURE',
      metadata: { email: body.email, reason: !row ? 'NO_ACCOUNT' : !ok ? 'BAD_PASSWORD' : 'NOT_OWNER' },
    });
    throw new ApiException(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  if (row.status === 'DISABLED') {
    throw new ApiException(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  }

  const displayName = await getDisplayName(env, row.id);
  const user = toSessionUser(row, displayName);
  const session = await createSession(env, url, user, req, await ipHashOf(req));

  await execute(env, 'UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), row.id]);
  await clearRateLimit(env, 'ownerlogin:email', body.email);
  await writeAudit(env, {
    userId: row.id,
    actorRole: 'OWNER',
    action: 'OWNER_LOGIN_SUCCESS',
    resourceType: 'session',
    scope: 'GLOBAL',
    result: 'SUCCESS',
  });

  return withCookies(json({ user }), session.cookies);
}

export async function handleLogout(req: Request, env: Env, url: URL): Promise<Response> {
  const session = await resolveSession(req, env);
  if (session) {
    await destroySession(env, session.sessionId);
    await writeAudit(env, {
      userId: session.userId,
      actorRole: session.role === 'OWNER' ? 'OWNER' : 'USER',
      action: 'LOGOUT',
      resourceType: 'session',
      scope: session.role === 'OWNER' ? 'GLOBAL' : 'USER',
      result: 'SUCCESS',
    });
  }
  return withCookies(noContent(), clearSessionCookies(env, url));
}

export async function handleSessionInfo(req: Request, env: Env): Promise<Response> {
  const session = await resolveSession(req, env);
  if (!session) throw unauthenticated();
  if (session.status === 'DISABLED') {
    throw new ApiException(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  }
  const row = await queryFirst<DbUserRow>(env, 'SELECT * FROM users WHERE id = ?', [
    session.userId,
  ]);
  if (!row) throw unauthenticated();
  return json({
    user: toSessionUser(row, session.displayName),
    csrfToken: session.csrfToken,
    maxUsers: getMaxUsers(env),
  });
}

/**
 * One-time owner bootstrap (04 section 3.2). Requires OWNER_BOOTSTRAP_SECRET
 * from Cloudflare secrets and refuses to run once an OWNER already exists.
 */
export async function handleOwnerBootstrap(req: Request, env: Env): Promise<Response> {
  const configured = env.OWNER_BOOTSTRAP_SECRET;
  if (!configured) throw forbidden('Owner bootstrap is not enabled');

  const body = await parseBody(req, ownerBootstrapSchema);
  if (body.bootstrapSecret !== configured) {
    await writeAudit(env, {
      userId: null,
      actorRole: 'SYSTEM',
      action: 'OWNER_LOGIN_FAILURE',
      resourceType: 'user',
      scope: 'GLOBAL',
      result: 'FAILURE',
      metadata: { reason: 'BAD_BOOTSTRAP_SECRET' },
    });
    throw forbidden('Invalid bootstrap secret');
  }

  const existing = await queryFirst<{ c: number }>(
    env,
    "SELECT COUNT(*) AS c FROM users WHERE role = 'OWNER'",
  );
  if (existing && Number(existing.c) > 0) {
    throw new ApiException(409, 'CONFLICT', 'An owner account already exists');
  }

  const user = await createUser(
    env,
    {
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      authProvider: 'PASSWORD',
      role: 'OWNER',
    },
    { userId: null, actorRole: 'SYSTEM', action: 'USER_CREATED', scope: 'GLOBAL' },
  );

  return json({ user }, 201);
}

/* ------------------------------------------------------ Google OAuth ---- */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const OAUTH_STATE_COOKIE = 'ledger_oauth_state';

function redirectUri(url: URL): string {
  return `${url.origin}/api/auth/google/callback`;
}

export function handleGoogleStart(req: Request, env: Env, url: URL): Response {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw badRequest('Google sign-in is not configured for this deployment');

  const state = newId();
  const target = new URL(GOOGLE_AUTH_URL);
  target.searchParams.set('client_id', clientId);
  target.searchParams.set('redirect_uri', redirectUri(url));
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('scope', 'openid email profile');
  target.searchParams.set('state', state);
  target.searchParams.set('prompt', 'select_account');

  const secure = useSecureCookies(env, url) ? '; Secure' : '';
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=600`,
    },
  });
}

interface GoogleJwk {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  kty: string;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Full ID-token verification: signature via JWKS, issuer, audience, expiry. */
async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<{ sub: string; email: string; name?: string; emailVerified: boolean }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw unauthenticated('Malformed Google token');

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as {
    kid?: string;
    alg?: string;
  };
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as {
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) throw unauthenticated('Unsupported token algorithm');

  const jwksRes = await fetch(GOOGLE_JWKS_URL);
  if (!jwksRes.ok) throw unauthenticated('Could not verify Google token');
  const jwks = (await jwksRes.json()) as { keys: GoogleJwk[] };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw unauthenticated('Unknown Google signing key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parts[2]) as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw unauthenticated('Invalid Google token signature');

  const iss = payload.iss ?? '';
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    throw unauthenticated('Unexpected token issuer');
  }
  if (payload.aud !== clientId) throw unauthenticated('Token was not issued for this application');
  if (!payload.exp || payload.exp * 1000 <= Date.now()) throw unauthenticated('Token expired');
  if (!payload.sub || !payload.email) throw unauthenticated('Token missing identity claims');

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name,
    emailVerified: payload.email_verified !== false,
  };
}

export async function handleGoogleCallback(req: Request, env: Env, url: URL): Promise<Response> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw badRequest('Google sign-in is not configured');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = req.headers.get('cookie') ?? '';
  const expectedState = /ledger_oauth_state=([^;]+)/.exec(cookies)?.[1];

  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.redirect(`${url.origin}/login?error=oauth_state`, 302);
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(url),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return Response.redirect(`${url.origin}/login?error=oauth_exchange`, 302);

  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return Response.redirect(`${url.origin}/login?error=oauth_token`, 302);

  let identity: Awaited<ReturnType<typeof verifyGoogleIdToken>>;
  try {
    identity = await verifyGoogleIdToken(tokens.id_token, clientId);
  } catch {
    return Response.redirect(`${url.origin}/login?error=oauth_verify`, 302);
  }
  if (!identity.emailVerified) {
    return Response.redirect(`${url.origin}/login?error=oauth_unverified`, 302);
  }

  // Link by google_sub first, then by email (upgrading PASSWORD -> BOTH).
  let row = await queryFirst<DbUserRow>(env, 'SELECT * FROM users WHERE google_sub = ?', [
    identity.sub,
  ]);
  if (!row) {
    const byEmail = await findUserByEmail(env, identity.email);
    if (byEmail) {
      const provider = byEmail.password_hash ? 'BOTH' : 'GOOGLE';
      await execute(
        env,
        'UPDATE users SET google_sub = ?, auth_provider = ?, updated_at = ? WHERE id = ?',
        [identity.sub, provider, Date.now(), byEmail.id],
      );
      row = { ...byEmail, google_sub: identity.sub, auth_provider: provider };
    }
  }

  if (!row) {
    try {
      const created = await createUser(
        env,
        {
          email: identity.email,
          googleSub: identity.sub,
          displayName: identity.name?.slice(0, 80) || identity.email.split('@')[0],
          authProvider: 'GOOGLE',
          role: 'USER',
        },
        { userId: null, actorRole: 'USER', action: 'SIGNUP_SUCCESS', scope: 'USER' },
      );
      row = await queryFirst<DbUserRow>(env, 'SELECT * FROM users WHERE id = ?', [created.id]);
    } catch (e) {
      const code = e instanceof ApiException ? e.code : 'oauth_signup';
      return Response.redirect(`${url.origin}/login?error=${encodeURIComponent(String(code))}`, 302);
    }
  }
  if (!row) return Response.redirect(`${url.origin}/login?error=oauth_signup`, 302);
  if (row.status === 'DISABLED') {
    return Response.redirect(`${url.origin}/login?error=account_disabled`, 302);
  }
  if (row.role === 'OWNER') {
    return Response.redirect(`${url.origin}/login?error=use_owner_login`, 302);
  }

  const displayName = await getDisplayName(env, row.id);
  const session = await createSession(
    env,
    url,
    toSessionUser(row, displayName),
    req,
    await hashIp(clientIp(req), IP_SALT),
  );
  await execute(env, 'UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), row.id]);
  await writeAudit(env, {
    userId: row.id,
    actorRole: 'USER',
    action: 'LOGIN_SUCCESS',
    resourceType: 'session',
    scope: 'USER',
    result: 'SUCCESS',
    metadata: { provider: 'GOOGLE' },
  });

  const secure = useSecureCookies(env, url) ? '; Secure' : '';
  const headers = new Headers({ location: `${url.origin}/` });
  for (const c of session.cookies) headers.append('set-cookie', c);
  headers.append('set-cookie', `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly${secure}; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

export const AUTH_COOKIE_NAMES = { SESSION_COOKIE, CSRF_COOKIE };

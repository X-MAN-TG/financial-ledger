/**
 * HTTP helpers: uniform JSON responses, the standard error shape from
 * 05-worker-api-contract.txt section 1.2, and the security headers required
 * by 20-security.txt section 6.3.
 */
import type { ApiErrorCode } from '../../shared/constants';

export class ApiException extends Error {
  status: number;
  code: ApiErrorCode | string;
  fields?: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode | string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (m = 'Invalid request', f?: Record<string, string>) =>
  new ApiException(400, 'VALIDATION_ERROR', m, f);
export const unauthenticated = (m = 'Sign in to continue') =>
  new ApiException(401, 'UNAUTHENTICATED', m);
export const forbidden = (m = 'You do not have access to this resource') =>
  new ApiException(403, 'FORBIDDEN', m);
/** 404 is also used for "exists but not owned by caller" (04 section 4.2). */
export const notFound = (m = 'Not found') => new ApiException(404, 'NOT_FOUND', m);
export const conflict = (code: ApiErrorCode, m: string) => new ApiException(409, code, m);
export const rateLimited = (m = 'Too many attempts. Please try again shortly.') =>
  new ApiException(429, 'RATE_LIMITED', m);
export const internalError = (m = 'Something went wrong') =>
  new ApiException(500, 'INTERNAL_ERROR', m);

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=()',
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function noContent(headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(null, { status: 204, headers: h });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiException) {
    return json(
      { error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } },
      e.status,
    );
  }
  // Never leak internals (05 section 13, 20 section 5.2).
  console.error('Unhandled worker error:', e instanceof Error ? e.message : String(e));
  return json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500);
}

export function applySecurityHeaders(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

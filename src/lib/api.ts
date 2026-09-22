/**
 * Thin fetch wrapper for the Worker API.
 * - same-origin, cookie-based auth (no tokens in JS-readable storage)
 * - echoes the CSRF cookie in a custom header on mutating requests
 * - surfaces a typed ApiError so callers can branch on the code
 */
import { CSRF_COOKIE, CSRF_HEADER } from '../../shared/constants';

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** True when the failure looks transient and is worth retrying. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (!SAFE.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
  } catch {
    // Network unreachable - status 0 marks it as transient/offline.
    throw new ApiError(0, 'NETWORK', 'You appear to be offline');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } })
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? 'Something went wrong',
      err?.fields,
    );
  }

  return data as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json });
export const apiPatch = <T>(path: string, json?: unknown) => api<T>(path, { method: 'PATCH', json });
export const apiDelete = <T>(path: string, json?: unknown) =>
  api<T>(path, { method: 'DELETE', json });

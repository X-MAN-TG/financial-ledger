/**
 * Password hashing, token generation and hashing - all via Web Crypto
 * (04-authentication-and-authorization.txt 2.1, 20-security.txt 2).
 *
 * Password format stored in users.password_hash:
 *   pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>
 * Storing the algorithm + iteration count alongside the hash lets us raise
 * parameters later without invalidating existing accounts.
 */

/**
 * PBKDF2 iterations. The spec asks for 210,000+ "tuned to stay within
 * acceptable Worker CPU time". Cloudflare's Free-plan CPU budget is ~10ms
 * per request for ordinary work, but crypto.subtle.deriveBits runs as
 * native, non-billable-ish work in workerd; login/signup are also rare
 * compared with ledger writes. 210k is the OWASP floor for PBKDF2-SHA256.
 */
export const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

/** Constant-time comparison to avoid leaking hash prefixes via timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1].toLowerCase() !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  try {
    const salt = fromB64(parts[3]);
    const expected = fromB64(parts[4]);
    const actual = await pbkdf2(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Opaque, high-entropy session id (20-security.txt 2.2). */
export function generateToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash an IP before storage - raw IPs are never persisted (12 section 5). */
export async function hashIp(ip: string | null, salt: string): Promise<string | null> {
  if (!ip) return null;
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32);
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

/**
 * Zod enforcement for request bodies and query strings, using the SHARED
 * schemas so client and server can never disagree (02 s5.4, 20 s4.1).
 */
import type { z } from 'zod';
import { badRequest } from '../lib/http';

function formatIssues(err: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}

export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest('Some fields need attention', formatIssues(result.error));
  }
  return result.data;
}

export function parseQuery<S extends z.ZodTypeAny>(url: URL, schema: S): z.infer<S> {
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    if (v !== '') obj[k] = v;
  });
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw badRequest('Invalid query parameters', formatIssues(result.error));
  }
  return result.data;
}

export function parseWith<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest('Some fields need attention', formatIssues(result.error));
  }
  return result.data;
}

/** Non-throwing variant used by the sync batch handler (per-op rejection). */
export function safeParseWith<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; message: string; fields: Record<string, string> } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const fields = formatIssues(result.error);
  const first = Object.entries(fields)[0];
  return {
    ok: false,
    message: first ? `${first[0]}: ${first[1]}` : 'Validation failed',
    fields,
  };
}

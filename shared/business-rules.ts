/**
 * TRANSACTION BUSINESS RULES - the completion state machine and totals
 * formula, implemented ONCE and imported by both the Worker (authoritative
 * recomputation, 07 section 3.6) and the client (optimistic UI).
 *
 * Source: 07-transaction-business-rules.txt sections 3 and 5, cross-checked
 * against 10-analytics-specification.txt section 5 and 15-pdf-export.txt
 * section 6, which must agree with it.
 */
import type { DayTotals, Transaction } from './types';
import type { TransactionStatus } from './constants';

/** The subset of fields the state machine depends on. */
export interface CompletionFields {
  customerNameSnapshot?: string | null;
  inrAmount?: number | null;
  usdtAmount?: number | null;
  finalRubAmount?: number | null;
  orderDone?: boolean | null;
}

const hasName = (t: CompletionFields): boolean =>
  typeof t.customerNameSnapshot === 'string' && t.customerNameSnapshot.trim().length > 0;

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * READY (07 section 3.3): Customer Name non-empty AND at least one of
 * (INR, USDT, Final RUB) is a non-null, NON-ZERO number.
 */
export function meetsReadyRequirements(t: CompletionFields): boolean {
  if (!hasName(t)) return false;
  const vals = [t.inrAmount, t.usdtAmount, t.finalRubAmount];
  return vals.some((v) => isNum(v) && v !== 0);
}

/**
 * COMPLETED eligibility (07 section 3.4): Customer Name non-empty AND INR,
 * USDT and Final RUB are ALL non-null numbers.
 *
 * NOTE (spec nuance, documented in README "Assumptions"): 3.4 requires the
 * three amounts to be "non-null numbers" - it does NOT add the non-zero
 * requirement that 3.3 states for READY. A legitimately zero-value leg (e.g.
 * a zero-fee settlement) is therefore completable. We implement 3.4 exactly
 * as written rather than silently importing 3.3's stricter non-zero rule.
 */
export function meetsCompletionRequirements(t: CompletionFields): boolean {
  return hasName(t) && isNum(t.inrAmount) && isNum(t.usdtAmount) && isNum(t.finalRubAmount);
}

/** Which required fields are missing, for inline UI highlighting (07 s3.4). */
export function missingCompletionFields(t: CompletionFields): string[] {
  const missing: string[] = [];
  if (!hasName(t)) missing.push('customerNameSnapshot');
  if (!isNum(t.inrAmount)) missing.push('inrAmount');
  if (!isNum(t.usdtAmount)) missing.push('usdtAmount');
  if (!isNum(t.finalRubAmount)) missing.push('finalRubAmount');
  return missing;
}

/**
 * Derive the persisted `status` column. Authoritative on the Worker; the
 * client uses the same function so optimistic UI never disagrees.
 *
 * orderDone=true is only honoured when the completion rule is satisfied;
 * otherwise the row falls back to READY/INCOMPLETE. Callers that accept
 * client input must ALSO reject the orderDone flag itself (see
 * resolveOrderDone) so we never persist orderDone=1 on a non-COMPLETED row.
 */
export function deriveStatus(t: CompletionFields): TransactionStatus {
  if (t.orderDone && meetsCompletionRequirements(t)) return 'COMPLETED';
  if (meetsReadyRequirements(t)) return 'READY';
  return 'INCOMPLETE';
}

/**
 * Server-side guard for the Order Done flag (07 sections 3.4, 3.5, 8).
 * Returns the flag that may actually be persisted given the row's fields.
 */
export function resolveOrderDone(t: CompletionFields): boolean {
  return Boolean(t.orderDone) && meetsCompletionRequirements(t);
}

const n = (v: number | null | undefined): number => (isNum(v) ? v : 0);

/**
 * Totals (07 section 5.1). NULL is treated as 0. Soft-deleted rows are
 * excluded by the caller filter below; PENDING_SYNC/LOCAL_ONLY rows ARE
 * included (07 section 5.4).
 */
export function computeTotals(rows: Array<Partial<Transaction>>): DayTotals {
  let totalInr = 0;
  let totalUsdt = 0;
  let totalRub = 0;
  let totalExtras = 0;
  let completedCount = 0;
  let rowCount = 0;

  for (const r of rows) {
    if (r.isDeleted) continue;
    rowCount += 1;
    totalInr += n(r.inrAmount);
    totalUsdt += n(r.usdtAmount);
    totalRub += n(r.finalRubAmount);
    totalExtras += n(r.extrasAmount);
    if (r.status === 'COMPLETED') completedCount += 1;
  }

  return {
    totalInr: round2(totalInr),
    totalUsdt: round2(totalUsdt),
    totalRub: round2(totalRub),
    totalExtras: round2(totalExtras),
    completedCount,
    pendingCount: rowCount - completedCount,
    rowCount,
  };
}

export const EMPTY_TOTALS: DayTotals = {
  totalInr: 0,
  totalUsdt: 0,
  totalRub: 0,
  totalExtras: 0,
  completedCount: 0,
  pendingCount: 0,
  rowCount: 0,
};

/**
 * Float summation guard: money is stored as REAL (03 section 1.4) so a long
 * column of decimals can accumulate representation error. We round the
 * aggregate to 2dp so the totals bar, the PDF and the SQL aggregates agree.
 */
export function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** A row that has never been given any data - used to decide seeding. */
export function isBlankRow(t: Partial<Transaction>): boolean {
  return (
    !t.customerId &&
    !(t.customerNameSnapshot && t.customerNameSnapshot.trim()) &&
    t.inrAmount == null &&
    t.usdtAmount == null &&
    t.finalRubAmount == null &&
    t.extrasAmount == null &&
    !t.inrReceived &&
    !t.orderDone &&
    !(t.note && t.note.trim())
  );
}

/** Recompute 1-based sr_number from sort order (07 section 4.1/4.3). */
export function resequence<T extends { sortOrder: number; srNumber: number }>(rows: T[]): T[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r, i) => ({ ...r, srNumber: i + 1 }));
}

/** Local-date 'YYYY-MM-DD' for the user's device (06 section 1.3). */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateKey(dt);
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

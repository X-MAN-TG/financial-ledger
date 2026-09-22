/**
 * Row-level ownership enforcement (04 section 4.2 step 4, 20 section 3.2).
 *
 * Every row-level read/write funnels through these helpers. A row that
 * exists but belongs to another user returns 404 - never 403 - so a caller
 * cannot probe for the existence of another user's records.
 */
import type { Customer, LedgerDay, Transaction } from '../../shared/types';
import type { Env } from '../lib/config';
import { mapCustomer, mapLedgerDay, mapTransaction, queryFirst } from '../lib/db';
import { notFound } from '../lib/http';

export async function getOwnedTransaction(
  env: Env,
  userId: string,
  transactionId: string,
): Promise<Transaction> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.id = ? AND t.user_id = ?`,
    [transactionId, userId],
  );
  if (!row) throw notFound('Transaction not found');
  return mapTransaction(row);
}

export async function findOwnedTransaction(
  env: Env,
  userId: string,
  transactionId: string,
): Promise<Transaction | null> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.id = ? AND t.user_id = ?`,
    [transactionId, userId],
  );
  return row ? mapTransaction(row) : null;
}

export async function getOwnedCustomer(
  env: Env,
  userId: string,
  customerId: string,
): Promise<Customer> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM customers WHERE id = ? AND user_id = ?',
    [customerId, userId],
  );
  if (!row) throw notFound('Customer not found');
  return mapCustomer(row);
}

export async function findOwnedCustomer(
  env: Env,
  userId: string,
  customerId: string,
): Promise<Customer | null> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM customers WHERE id = ? AND user_id = ?',
    [customerId, userId],
  );
  return row ? mapCustomer(row) : null;
}

export async function getOwnedLedgerDayById(
  env: Env,
  userId: string,
  ledgerDayId: string,
): Promise<LedgerDay> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM ledger_days WHERE id = ? AND user_id = ?',
    [ledgerDayId, userId],
  );
  if (!row) throw notFound('Ledger day not found');
  return mapLedgerDay(row);
}

export async function findLedgerDayByDate(
  env: Env,
  userId: string,
  date: string,
): Promise<LedgerDay | null> {
  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM ledger_days WHERE user_id = ? AND date = ?',
    [userId, date],
  );
  return row ? mapLedgerDay(row) : null;
}

/**
 * Verify a customer id supplied by the client actually belongs to the
 * caller before it is written onto a transaction row. Returns the row's
 * current name for the snapshot (08 section 5.2).
 */
export async function assertCustomerOwnedOrNull(
  env: Env,
  userId: string,
  customerId: string | null | undefined,
): Promise<Customer | null> {
  if (!customerId) return null;
  return getOwnedCustomer(env, userId, customerId);
}

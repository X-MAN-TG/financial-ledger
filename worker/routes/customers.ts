/**
 * Customer routes (05 section 7, 08-customer-system.txt).
 * Aggregates are computed with indexed SQL, never by pulling rows into the
 * Worker (08 section 4, 19 section 3.3).
 */
import { z } from 'zod';
import type { Customer, CustomerSummary } from '../../shared/types';
import {
  customerCreateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
  pageSchema,
  pageSizeSchema,
} from '../../shared/validation';
import { auditStatement } from '../lib/audit';
import type { Env } from '../lib/config';
import { newId } from '../lib/crypto';
import { batch, mapCustomer, mapTransaction, queryAll, queryFirst, stmt } from '../lib/db';
import { conflict, json, notFound } from '../lib/http';
import { deleteCustomerById, upsertCustomerFromSync } from '../lib/customer-service';
import { getOwnedCustomer } from '../middleware/ownership';
import type { SessionContext } from '../middleware/auth';
import { parseBody, parseQuery } from '../middleware/validation';

export async function listCustomers(
  env: Env,
  session: SessionContext,
  url: URL,
): Promise<Response> {
  const q = parseQuery(url, customerListQuerySchema);
  const offset = (q.page - 1) * q.pageSize;
  const includeDeleted = q.includeDeleted === '1';

  const params: unknown[] = [session.userId];
  let where = 'user_id = ?';
  if (!includeDeleted) where += ' AND is_deleted = 0';
  if (q.search) {
    where += ' AND (name LIKE ? OR phone LIKE ?)';
    const like = `%${q.search}%`;
    params.push(like, like);
  }

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT * FROM customers WHERE ${where} ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, offset],
  );
  const totalRow = await queryFirst<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM customers WHERE ${where}`,
    params,
  );

  return json({
    items: rows.map(mapCustomer),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow ? Number(totalRow.c) : 0,
  });
}

export async function createCustomer(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, customerCreateSchema);
  const customer = await upsertCustomerFromSync(env, session.userId, body);
  return json({ customer }, 201);
}

export async function getCustomer(
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  const customer = await getOwnedCustomer(env, session.userId, id);
  return json({ customer });
}

export async function patchCustomer(
  req: Request,
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  const body = await parseBody(req, customerUpdateSchema);
  const existing = await getOwnedCustomer(env, session.userId, id);
  const now = Date.now();

  await batch(env, [
    stmt(
      env,
      `UPDATE customers SET name = ?, phone = ?, notes = ?, is_active = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`,
      [
        body.name ?? existing.name,
        body.phone !== undefined ? body.phone : existing.phone,
        body.notes !== undefined ? body.notes : existing.notes,
        body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.isActive ? 1 : 0,
        now,
        id,
        session.userId,
      ],
    ),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'CUSTOMER_UPDATED',
        resourceType: 'customer',
        resourceId: id,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { fields: Object.keys(body) },
      },
      now,
    ),
  ]);

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM customers WHERE id = ? AND user_id = ?',
    [id, session.userId],
  );
  return json({ customer: row ? mapCustomer(row) : null });
}

export async function deleteCustomer(
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  const customer = await deleteCustomerById(env, session.userId, id);
  return json({ customer });
}

export async function customerTransactions(
  env: Env,
  session: SessionContext,
  id: string,
  url: URL,
): Promise<Response> {
  await getOwnedCustomer(env, session.userId, id);
  const q = parseQuery(url, z.object({ page: pageSchema, pageSize: pageSizeSchema }));
  const offset = (q.page - 1) * q.pageSize;

  const rows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT t.*, d.date AS date FROM transactions t
       JOIN ledger_days d ON d.id = t.ledger_day_id
      WHERE t.user_id = ? AND t.customer_id = ? AND t.is_deleted = 0
      ORDER BY d.date DESC, t.sort_order ASC
      LIMIT ? OFFSET ?`,
    [session.userId, id, q.pageSize, offset],
  );
  const totalRow = await queryFirst<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM transactions
      WHERE user_id = ? AND customer_id = ? AND is_deleted = 0`,
    [session.userId, id],
  );

  return json({
    items: rows.map(mapTransaction),
    page: q.page,
    pageSize: q.pageSize,
    total: totalRow ? Number(totalRow.c) : 0,
  });
}

export async function customerSummary(
  env: Env,
  session: SessionContext,
  id: string,
): Promise<Response> {
  await getOwnedCustomer(env, session.userId, id);
  const row = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT COUNT(*) AS c,
            COALESCE(SUM(inr_amount), 0) AS inr,
            COALESCE(SUM(usdt_amount), 0) AS usdt,
            COALESCE(SUM(final_rub_amount), 0) AS rub,
            COALESCE(SUM(extras_amount), 0) AS extras,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed
       FROM transactions
      WHERE user_id = ? AND customer_id = ? AND is_deleted = 0`,
    [session.userId, id],
  );

  const count = row ? Number(row.c) : 0;
  const completed = row ? Number(row.completed) : 0;
  const summary: CustomerSummary = {
    totalTransactions: count,
    totalInr: row ? Number(row.inr) : 0,
    totalUsdt: row ? Number(row.usdt) : 0,
    totalRub: row ? Number(row.rub) : 0,
    totalExtras: row ? Number(row.extras) : 0,
    completedCount: completed,
    pendingCount: count - completed,
  };
  return json({ summary });
}

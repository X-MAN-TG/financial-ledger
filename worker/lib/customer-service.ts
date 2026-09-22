/**
 * Customer write path shared by the REST routes and the sync batch
 * (08-customer-system.txt, 13 section 6.2).
 */
import type { Customer } from '../../shared/types';
import type { CustomerCreateInput } from '../../shared/validation';
import { auditStatement } from './audit';
import type { Env } from './config';
import { newId } from './crypto';
import { batch, mapCustomer, queryFirst, stmt } from './db';
import { notFound } from './http';

/**
 * Offline-created customers arrive with a client-generated UUID. Upsert by
 * id so a retried sync never creates a duplicate directory entry.
 */
export async function upsertCustomerFromSync(
  env: Env,
  userId: string,
  input: CustomerCreateInput,
): Promise<Customer> {
  const id = input.id ?? newId();
  const now = Date.now();

  const existing = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM customers WHERE id = ? AND user_id = ?',
    [id, userId],
  );

  if (existing) {
    await batch(env, [
      stmt(
        env,
        `UPDATE customers SET name = ?, phone = ?, notes = ?, updated_at = ?
          WHERE id = ? AND user_id = ?`,
        [input.name, input.phone ?? null, input.notes ?? null, now, id, userId],
      ),
      auditStatement(
        env,
        {
          userId,
          actorRole: 'USER',
          action: 'CUSTOMER_UPDATED',
          resourceType: 'customer',
          resourceId: id,
          scope: 'USER',
          result: 'SUCCESS',
          metadata: { via: 'SYNC' },
        },
        now,
      ),
    ]);
  } else {
    await batch(env, [
      stmt(
        env,
        `INSERT INTO customers (id, user_id, name, phone, notes, is_active, is_deleted, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [id, userId, input.name, input.phone ?? null, input.notes ?? null, now, now],
      ),
      auditStatement(
        env,
        {
          userId,
          actorRole: 'USER',
          action: 'CUSTOMER_CREATED',
          resourceType: 'customer',
          resourceId: id,
          scope: 'USER',
          result: 'SUCCESS',
          metadata: { name: input.name },
        },
        now,
      ),
    ]);
  }

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM customers WHERE id = ? AND user_id = ?',
    [id, userId],
  );
  if (!row) throw notFound('Customer not found');
  return mapCustomer(row);
}

/**
 * Soft delete (08 section 3.5). Historical transactions keep both their
 * customer_id reference and their customer_name_snapshot untouched.
 */
export async function deleteCustomerById(
  env: Env,
  userId: string,
  customerId: string,
): Promise<Customer> {
  const existing = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM customers WHERE id = ? AND user_id = ?',
    [customerId, userId],
  );
  if (!existing) throw notFound('Customer not found');

  const now = Date.now();
  await batch(env, [
    stmt(
      env,
      `UPDATE customers SET is_deleted = 1, is_active = 0, deleted_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`,
      [now, now, customerId, userId],
    ),
    auditStatement(
      env,
      {
        userId,
        actorRole: 'USER',
        action: 'CUSTOMER_DELETED',
        resourceType: 'customer',
        resourceId: customerId,
        scope: 'USER',
        result: 'SUCCESS',
      },
      now,
    ),
  ]);

  const row = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM customers WHERE id = ? AND user_id = ?',
    [customerId, userId],
  );
  return mapCustomer(row as Record<string, unknown>);
}

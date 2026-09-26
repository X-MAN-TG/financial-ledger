/**
 * SHARED ZOD SCHEMAS - the single source of truth for validation, imported by
 * both React Hook Form (client) and the Worker route validation layer
 * (02-architecture.txt section 5.4, 20-security.txt section 4.1).
 *
 * Rules encoded here come from 07-transaction-business-rules.txt section 8.
 */
import { z } from 'zod';
import {
  AUTH_PROVIDERS,
  BACKUP_TYPES,
  COLUMN_TYPES,
  DEFAULT_PAGE_SIZE,
  LEDGER_DAY_STATUSES,
  LIMITS,
  MAX_PAGE_SIZE,
  SYNC_OPERATION_TYPES,
  TRANSACTION_STATUSES,
} from './constants';

/* ------------------------------------------------------------ helpers ---- */

export const uuidSchema = z.string().uuid();

/** 'YYYY-MM-DD' and a real calendar date. */
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Not a valid calendar date');

export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM')
  .refine((v) => {
    const m = Number(v.slice(5, 7));
    return m >= 1 && m <= 12;
  }, 'Not a valid month');

/**
 * Money field: non-negative, finite (07 section 2.2). Accepts null/'' for an
 * unfinished row and normalizes empty string to null so form inputs and API
 * payloads agree.
 */
export const moneySchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return null;
      const n = Number(t);
      return Number.isNaN(n) ? Number.NaN : n;
    }
    return v;
  })
  .refine((v) => v === null || Number.isFinite(v), { message: 'Must be a number' })
  .refine((v) => v === null || v >= 0, { message: 'Must be zero or greater' })
  .refine((v) => v === null || v <= LIMITS.moneyMax, { message: 'Amount is unrealistically large' });

const boolish = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((v) => (typeof v === 'boolean' ? v : v === 1));

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `Password must be at least ${LIMITS.passwordMin} characters`)
  .max(LIMITS.passwordMax);

export const displayNameSchema = z
  .string()
  .trim()
  .min(LIMITS.displayNameMin, 'Display name is required')
  .max(LIMITS.displayNameMax);

export const pageSchema = z.coerce.number().int().min(1).default(1);
export const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .default(DEFAULT_PAGE_SIZE);

/* --------------------------------------------------------------- auth ---- */

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(LIMITS.passwordMax),
});

export const ownerLoginSchema = loginSchema.extend({
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

export const ownerBootstrapSchema = z.object({
  bootstrapSecret: z.string().min(16),
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

/* ------------------------------------------------------------ profile ---- */

export const profileUpdateSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    fullName: z.string().trim().max(LIMITS.fullNameMax).nullable().optional(),
    bio: z.string().trim().max(LIMITS.bioMax).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export const avatarSchema = z.object({
  imageDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Unsupported image format')
    .max(LIMITS.avatarMaxBytes, 'Image is too large'),
});

export const settingsUpdateSchema = z
  .object({
    theme: z.string().min(1).max(40).optional(),
    dateFormat: z.string().min(1).max(40).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

/* -------------------------------------------------------- transactions ---- */

/** Fields a client may send when creating a transaction (05 section 5). */
export const transactionCreateSchema = z.object({
  operationId: uuidSchema,
  id: uuidSchema,
  ledgerDayId: uuidSchema,
  date: dateKeySchema,
  srNumber: z.number().int().min(1).max(100000),
  customerId: uuidSchema.nullable().optional(),
  customerNameSnapshot: z
    .string()
    .trim()
    .max(LIMITS.customerNameMax)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? null))),
  inrAmount: moneySchema.optional(),
  inrReceived: boolish.default(false),
  usdtAmount: moneySchema.optional(),
  finalRubAmount: moneySchema.optional(),
  extrasAmount: moneySchema.optional(),
  orderDone: boolish.default(false),
  note: z
    .string()
    .max(LIMITS.noteMax)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? null))),
  attachments: z.array(z.object({ id: uuidSchema, name: z.string().max(200), type: z.string().regex(/^image\//), dataUrl: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(8_000_000) })).max(5).default([]),
  sortOrder: z.number().int(),
  clientCreatedAt: z.number().int().positive(),
  customValues: z.record(z.string(), z.string().max(5000).nullable()).optional(),
});

export const transactionUpdateSchema = z.object({
  operationId: uuidSchema,
  syncVersion: z.number().int().min(1).optional(),
  clientUpdatedAt: z.number().int().positive().optional(),
  customerId: uuidSchema.nullable().optional(),
  customerNameSnapshot: z
    .string()
    .trim()
    .max(LIMITS.customerNameMax)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  inrAmount: moneySchema.optional(),
  inrReceived: boolish.optional(),
  usdtAmount: moneySchema.optional(),
  finalRubAmount: moneySchema.optional(),
  extrasAmount: moneySchema.optional(),
  orderDone: boolish.optional(),
  note: z
    .string()
    .max(LIMITS.noteMax)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  attachments: z.array(z.object({ id: uuidSchema, name: z.string().max(200), type: z.string().regex(/^image\//), dataUrl: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(8_000_000) })).max(5).default([]),
  srNumber: z.number().int().min(1).max(100000).optional(),
  sortOrder: z.number().int().optional(),
  customValues: z.record(z.string(), z.string().max(5000).nullable()).optional(),
});

export const operationOnlySchema = z.object({ operationId: uuidSchema });

export const transactionReorderSchema = z.object({
  operationId: uuidSchema,
  order: z.array(uuidSchema).min(1).max(1000),
});

/* --------------------------------------------------------- ledger days ---- */

export const ledgerDayCreateSchema = z.object({
  id: uuidSchema,
  date: dateKeySchema,
  status: z.enum(LEDGER_DAY_STATUSES).default('TRADING_DAY'),
});

export const ledgerDayRangeSchema = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
});

/* ----------------------------------------------------------- customers ---- */

export const customerCreateSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(LIMITS.customerNameMin, 'Name is required').max(LIMITS.customerNameMax),
  phone: z
    .string()
    .trim()
    .max(LIMITS.phoneMax)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? null))),
  notes: z
    .string()
    .trim()
    .max(LIMITS.customerNotesMax)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? null))),
});

export const customerUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.customerNameMax).optional(),
    phone: z.string().trim().max(LIMITS.phoneMax).nullable().optional(),
    notes: z.string().trim().max(LIMITS.customerNotesMax).nullable().optional(),
    isActive: boolish.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
  includeDeleted: z.enum(['0', '1']).optional(),
});

/* ------------------------------------------------------------ timeline ---- */

export const timelineQuerySchema = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  customerId: uuidSchema.optional(),
  status: z.enum(['COMPLETED', 'PENDING', 'INCOMPLETE', 'READY', 'ANY']).optional(),
  amountField: z.enum(['inr', 'usdt', 'rub', 'extras']).optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  q: z.string().trim().max(120).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

/* ----------------------------------------------------------- analytics ---- */

export const monthlyQuerySchema = z.object({ month: monthKeySchema });

/* ---------------------------------------------------------------- sync ---- */

export const syncOperationSchema = z.object({
  operationId: uuidSchema,
  type: z.enum(SYNC_OPERATION_TYPES),
  entity: z.enum(['transaction', 'ledgerDay', 'customer']),
  payload: z.record(z.string(), z.unknown()),
});

export const syncBatchSchema = z.object({
  operations: z.array(syncOperationSchema).min(1).max(LIMITS.syncBatchMax),
});

/* -------------------------------------------------------------- export ---- */

export const exportFullQuerySchema = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  page: pageSchema,
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
});

export const backupExportSchema = z.object({
  type: z.enum(['JSON', 'CSV', 'PDF']),
  sizeBytes: z.number().int().min(0).optional(),
  status: z.enum(['SUCCESS', 'FAILURE']).default('SUCCESS'),
  errorMessage: z.string().max(500).optional(),
});

/** Import/restore (14 section 2 + 7): validated exactly like normal writes. */
export const importPayloadSchema = z.object({
  version: z.number().int().min(1).max(1),
  exportedAt: z.number().int().positive(),
  customers: z
    .array(
      z.object({
        id: uuidSchema,
        name: z.string().trim().min(1).max(LIMITS.customerNameMax),
        phone: z.string().max(LIMITS.phoneMax).nullable().optional(),
        notes: z.string().max(LIMITS.customerNotesMax).nullable().optional(),
        isActive: boolish.optional(),
        isDeleted: boolish.optional(),
        createdAt: z.number().int().positive(),
        updatedAt: z.number().int().positive(),
      }),
    )
    .max(20000),
  ledgerDays: z
    .array(
      z.object({
        id: uuidSchema,
        date: dateKeySchema,
        status: z.enum(LEDGER_DAY_STATUSES),
        createdAt: z.number().int().positive(),
        updatedAt: z.number().int().positive(),
      }),
    )
    .max(20000),
  transactions: z
    .array(
      z.object({
        id: uuidSchema,
        ledgerDayId: uuidSchema,
        date: dateKeySchema,
        srNumber: z.number().int().min(1),
        customerId: uuidSchema.nullable().optional(),
        customerNameSnapshot: z.string().max(LIMITS.customerNameMax).nullable().optional(),
        inrAmount: moneySchema.optional(),
        inrReceived: boolish.optional(),
        usdtAmount: moneySchema.optional(),
        finalRubAmount: moneySchema.optional(),
        extrasAmount: moneySchema.optional(),
        orderDone: boolish.optional(),
        note: z.string().max(LIMITS.noteMax).nullable().optional(),
        sortOrder: z.number().int(),
        isDeleted: boolish.optional(),
        createdAt: z.number().int().positive(),
        updatedAt: z.number().int().positive(),
        clientCreatedAt: z.number().int().positive().optional(),
        customValues: z.record(z.string(), z.string().max(5000).nullable()).optional(),
      }),
    )
    .max(100000),
});

/* --------------------------------------------------------------- owner ---- */

export const ownerCreateUserSchema = z.object({
  email: emailSchema,
  tempPassword: passwordSchema,
  displayName: displayNameSchema,
});

export const ownerUpdateUserSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
});

const columnKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(LIMITS.columnKeyMax)
  .regex(/^[a-z][a-z0-9_]*$/, 'Key must be lowercase letters, numbers and underscores');

export const columnCreateSchema = z.object({
  key: columnKeySchema,
  label: z.string().trim().min(1).max(LIMITS.columnLabelMax),
  type: z.enum(COLUMN_TYPES),
  position: z.number().int().min(0).max(1000).optional(),
  isRequired: boolish.default(false),
  selectOptions: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
});

export const columnUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(LIMITS.columnLabelMax).optional(),
    position: z.number().int().min(0).max(1000).optional(),
    isRequired: boolish.optional(),
    isActive: boolish.optional(),
    type: z.enum(COLUMN_TYPES).optional(),
    selectOptions: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    confirmTypeChange: boolish.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

export const ownerAuditQuerySchema = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  userId: uuidSchema.optional(),
  action: z.string().trim().max(60).optional(),
  scope: z.enum(['USER', 'GLOBAL', 'ANY']).optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

export const auditMeQuerySchema = z.object({
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});

/* --------------------------------------------------------------- types ---- */

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OwnerLoginInput = z.infer<typeof ownerLoginSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type SyncBatchInput = z.infer<typeof syncBatchSchema>;
export type ColumnCreateInput = z.infer<typeof columnCreateSchema>;
export type ColumnUpdateInput = z.infer<typeof columnUpdateSchema>;
export type OwnerCreateUserInput = z.infer<typeof ownerCreateUserSchema>;
export type ImportPayload = z.infer<typeof importPayloadSchema>;
export type BackupExportInput = z.infer<typeof backupExportSchema>;

export const TRANSACTION_STATUS_VALUES = TRANSACTION_STATUSES;
export const AUTH_PROVIDER_VALUES = AUTH_PROVIDERS;
export const BACKUP_TYPE_VALUES = BACKUP_TYPES;

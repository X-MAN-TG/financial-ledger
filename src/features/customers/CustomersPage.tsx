/**
 * Customers (08-customer-system.txt).
 *
 * A lightweight directory, NOT a CRM (00 s3). Renaming a customer updates
 * future rows only - historical customer_name_snapshot values are never
 * rewritten (08 s4), and the UI says so explicitly.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerCreateSchema, type CustomerCreateInput } from '../../../shared/validation';
import type {
  Customer,
  CustomerSummary,
  ListResponse,
  Transaction,
} from '../../../shared/types';
import { Page } from '../../components/AppShell';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldError,
  Hint,
  Input,
  Label,
  SectionTitle,
  Skeleton,
  Textarea,
} from '../../components/ui/primitives';
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlays';
import { PillButton } from '../../components/ui/shell-primitives';
import { IcPlus } from '../../components/ui/icons';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatDateMedium, formatMoney, formatNumber, initials } from '../../lib/format';
import { cn } from '../../lib/cn';

export function CustomersPage() {
  const { id } = useParams();
  return id ? <CustomerDetail id={id} /> : <CustomerList />;
}

/* ---------------------------------------------------------------- list ---- */

function CustomerList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 280);
    return () => window.clearTimeout(t);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', debounced],
    queryFn: () =>
      apiGet<ListResponse<Customer>>(
        `/api/customers?pageSize=100${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`,
      ),
  });

  const create = useMutation({
    mutationFn: (input: CustomerCreateInput) => apiPost<{ customer: Customer }>('/api/customers', input),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      setCreateOpen(false);
      toast({ title: 'Customer added', description: res.customer.name, tone: 'success' });
    },
  });

  const items = data?.items ?? [];

  return (
    <Page
      breadcrumbs={[{ label: 'Workspace', to: '/home' }, { label: 'Customers' }]}
      eyebrow="Directory"
      title="Customers"
      subtitle={data ? `${data.total} customer${data.total === 1 ? '' : 's'}` : undefined}
      actions={
        <PillButton
          size="sm"
          variant="primary"
          icon={<IcPlus size={15} />}
          onClick={() => setCreateOpen(true)}
        >
          Add customer
        </PillButton>
      }
    >
      <div className="relative mb-4">
        <svg
          viewBox="0 0 24 24"
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-3)] pointer-events-none"
          fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone"
          className="pl-9"
          aria-label="Search customers"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="flex items-center gap-3.5">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <EmptyState
            title="Could not load customers"
            description={error instanceof ApiError && error.isTransient ? 'You appear to be offline. Customers you have used recently are still available in the ledger.' : 'Please try again.'}
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M16 19v-1.5a4 4 0 00-4-4H7a4 4 0 00-4 4V19M9.5 9.5a3.25 3.25 0 100-6.5 3.25 3.25 0 000 6.5" />
              </svg>
            }
            title={debounced ? 'No matching customers' : 'No customers yet'}
            description={
              debounced
                ? 'Try a different name or phone number.'
                : 'Customers are created automatically as you type names in the ledger, or you can add them here.'
            }
            action={<Button variant="primary" onClick={() => setCreateOpen(true)}>Add customer</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-1.5">
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(`/customers/${c.id}`)}
              className="w-full card px-3.5 py-3 flex items-center gap-3.5 text-left hover:bg-[var(--surface-2)] transition-colors"
            >
              <span
                className="grid place-items-center h-10 w-10 rounded-full shrink-0 text-[13px] font-semibold"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                aria-hidden
              >
                {initials(c.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-[var(--text-1)] truncate">{c.name}</p>
                <p className="text-[12px] text-[var(--text-3)] truncate">
                  {c.phone || 'No phone number'}
                </p>
              </div>
              {!c.isActive && <Badge tone="neutral">Inactive</Badge>}
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-[var(--text-3)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      )}

      <CustomerFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(v) => create.mutate(v)}
        submitting={create.isPending}
        error={create.error instanceof ApiError ? create.error.message : null}
      />
    </Page>
  );
}

/* -------------------------------------------------------------- detail ---- */

function CustomerDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const customer = useQuery({
    queryKey: ['customer', id],
    queryFn: () => apiGet<{ customer: Customer }>(`/api/customers/${id}`),
  });

  const summary = useQuery({
    queryKey: ['customer', id, 'summary'],
    queryFn: () => apiGet<{ summary: CustomerSummary }>(`/api/customers/${id}/summary`),
  });

  const transactions = useQuery({
    queryKey: ['customer', id, 'transactions'],
    queryFn: () => apiGet<ListResponse<Transaction>>(`/api/customers/${id}/transactions?pageSize=50`),
  });

  const update = useMutation({
    mutationFn: (input: CustomerCreateInput) => apiPatch(`/api/customers/${id}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customer', id] });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      setEditOpen(false);
      toast({
        title: 'Customer updated',
        description: 'Past transactions keep the name recorded at the time.',
        tone: 'success',
      });
    },
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/api/customers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      toast({ title: 'Customer removed', tone: 'neutral' });
      navigate('/customers');
    },
  });

  if (customer.isLoading) {
    return (
      <Page>
        <Card className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-32" />
        </Card>
      </Page>
    );
  }

  if (customer.error || !customer.data) {
    return (
      <Page>
        <Card>
          <EmptyState
            title="Customer not found"
            description="This customer does not exist or is not yours."
            action={<Button variant="secondary" onClick={() => navigate('/customers')}>Back to customers</Button>}
          />
        </Card>
      </Page>
    );
  }

  const c = customer.data.customer;
  const s = summary.data?.summary;

  return (
    <Page>
      <button
        type="button"
        onClick={() => navigate('/customers')}
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-3)] hover:text-[var(--text-1)] mb-4 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Customers
      </button>

      <Card className="mb-4">
        <div className="flex items-start gap-4">
          <span
            className="grid place-items-center h-14 w-14 rounded-full shrink-0 text-[17px] font-semibold"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            aria-hidden
          >
            {initials(c.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-semibold text-[var(--text-1)] leading-tight truncate">
              {c.name}
            </h1>
            <p className="text-[13px] text-[var(--text-3)] mt-1">
              {c.phone || 'No phone number'} · Added {formatDateMedium(new Date(c.createdAt).toISOString().slice(0, 10))}
            </p>
            {c.notes && (
              <p className="text-[13px] text-[var(--text-2)] mt-2.5 leading-relaxed">{c.notes}</p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>Remove</Button>
          </div>
        </div>
      </Card>

      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatTile label="Transactions" value={formatNumber(s.totalTransactions)} />
          <StatTile label="Total INR" value={formatMoney(s.totalInr, 'INR')} />
          <StatTile label="Total USDT" value={formatMoney(s.totalUsdt, 'USDT')} />
          <StatTile label="Total Extras" value={formatMoney(s.totalExtras, 'EXTRAS')} />
        </div>
      )}

      <Card>
        <SectionTitle title="Transaction history" subtitle="Most recent first" />
        {transactions.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (transactions.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="Rows linked to this customer will appear here."
          />
        ) : (
          <div className="divide-y divide-[var(--border)] -mx-1">
            {transactions.data?.items.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => t.date && navigate(`/ledger?date=${t.date}`)}
                className="w-full flex items-center gap-3 px-1 py-2.5 hover:bg-[var(--surface-2)] transition-colors text-left rounded"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{
                    background:
                      t.status === 'COMPLETED'
                        ? 'var(--success)'
                        : t.status === 'READY'
                          ? 'var(--warning)'
                          : 'var(--text-3)',
                  }}
                />
                <span className="text-[12.5px] text-[var(--text-3)] w-[86px] shrink-0">
                  {t.date ? formatDateMedium(t.date) : '—'}
                </span>
                <span className="text-[13px] text-[var(--text-2)] truncate flex-1">
                  {/* The snapshot is historical - it may differ from the
                      customer's current name, and that is correct. */}
                  {t.customerNameSnapshot ?? c.name}
                </span>
                <span className="num text-[12.5px] text-[var(--text-1)] shrink-0">
                  {formatMoney(t.inrAmount, 'INR')}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <CustomerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        defaultValues={{ name: c.name, phone: c.phone ?? '', notes: c.notes ?? '' }}
        onSubmit={(v) => update.mutate(v)}
        submitting={update.isPending}
        error={update.error instanceof ApiError ? update.error.message : null}
        isEdit
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title={`Remove ${c.name}?`}
        description="Their transaction history is preserved - rows keep the customer name recorded at the time."
        confirmLabel="Remove customer"
        destructive
        loading={remove.isPending}
      />
    </Page>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
        {label}
      </p>
      <p className="num text-[19px] font-medium text-[var(--text-1)] mt-2 leading-none truncate">
        {value}
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------- form ---- */

function CustomerFormModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
  defaultValues,
  isEdit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: CustomerCreateInput) => void;
  submitting: boolean;
  error: string | null;
  defaultValues?: Partial<CustomerCreateInput>;
  isEdit?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CustomerCreateInput>({
    resolver: zodResolver(customerCreateSchema),
    defaultValues: defaultValues as CustomerCreateInput,
  });

  useEffect(() => {
    if (open) reset(defaultValues as CustomerCreateInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = handleSubmit((v) => onSubmit(v));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit customer' : 'Add customer'}
      description={
        isEdit
          ? 'Renaming affects future rows only. Past transactions keep the name recorded at the time.'
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-close>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={submitting}>
            {isEdit ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-md px-3.5 py-3 text-[13px]"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {error}
          </div>
        )}
        <div>
          <Label htmlFor="c-name" required>Name</Label>
          <Input id="c-name" invalid={Boolean(errors.name)} {...register('name')} />
          <FieldError>{errors.name?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" type="tel" inputMode="tel" invalid={Boolean(errors.phone)} {...register('phone')} />
          <FieldError>{errors.phone?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="c-notes">Notes</Label>
          <Textarea id="c-notes" rows={3} {...register('notes')} />
          <FieldError>{errors.notes?.message}</FieldError>
          <Hint>Private to you. Not shown on exports.</Hint>
        </div>
      </form>
    </Modal>
  );
}

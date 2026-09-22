/**
 * Column management (11 section 7).
 *
 * The protective rules live in the Worker; this UI makes them legible:
 *  - system columns (is_system=1) show a lock and expose no destructive
 *    controls at all (11 s7.7)
 *  - "Delete" on a custom column ARCHIVES it (is_active=0); historical
 *    values are preserved and it can be reactivated (11 s7.6)
 *  - a true hard delete is only offered when the column has zero stored
 *    values, and still requires confirmation
 *  - retyping a column with existing data requires explicit confirmation
 *    (11 s7.5)
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COLUMN_TYPES } from '../../../shared/constants';
import { columnCreateSchema, type ColumnCreateInput } from '../../../shared/validation';
import type { ColumnDefinition } from '../../../shared/types';
import { Page } from '../../components/AppShell';
import {
  Badge,
  Button,
  Card,
  FieldError,
  Hint,
  Input,
  Label,
  SectionTitle,
  Skeleton,
} from '../../components/ui/primitives';
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlays';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';

interface ColumnsResponse {
  items: Array<ColumnDefinition & { valueCount?: number }>;
}

export function OwnerColumns() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ColumnDefinition | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<ColumnDefinition | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['owner', 'columns'],
    queryFn: () => apiGet<ColumnsResponse>('/api/owner/columns'),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['owner', 'columns'] });

  const create = useMutation({
    mutationFn: (v: ColumnCreateInput) => apiPost('/api/owner/columns', v),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      toast({ title: 'Column added', description: 'It appears at the end of the ledger table.', tone: 'success' });
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiPatch(`/api/owner/columns/${id}`, body),
    onSuccess: () => {
      invalidate();
      setRenameTarget(null);
      toast({ title: 'Column updated', tone: 'success' });
    },
    onError: (e) =>
      toast({
        title: 'Could not update column',
        description: e instanceof ApiError ? e.message : undefined,
        tone: 'danger',
      }),
  });

  const archive = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/owner/columns/${id}`),
    onSuccess: () => {
      invalidate();
      setArchiveTarget(null);
      toast({
        title: 'Column archived',
        description: 'Existing values are preserved and it can be restored.',
        tone: 'neutral',
      });
    },
    onError: (e) =>
      toast({
        title: 'Could not archive column',
        description: e instanceof ApiError ? e.message : undefined,
        tone: 'danger',
      }),
  });

  const items = data?.items ?? [];
  const system = items.filter((c) => c.isSystem).sort((a, b) => a.position - b.position);
  const custom = items.filter((c) => !c.isSystem).sort((a, b) => a.position - b.position);

  return (
    <Page
      title="Ledger columns"
      subtitle="Applies to the ledger table for every user"
      actions={
        <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
          Add column
        </Button>
      }
    >
      <Card className="mb-3">
        <SectionTitle
          title="Standard columns"
          subtitle="Protected — these cannot be archived, retyped or reordered"
        />
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)] -mx-1">
            {system.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-1 py-2.5">
                <span className="num text-[11.5px] text-[var(--text-3)] w-5 shrink-0">{c.position}</span>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[var(--text-3)] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 018 0v3" />
                </svg>
                <span className="text-[13px] text-[var(--text-1)] flex-1 truncate">{c.label}</span>
                <Badge tone="neutral">{c.type}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Custom columns"
          subtitle="Appear to the right of the standard set, in position order"
        />
        {isLoading ? (
          <Skeleton className="h-9" />
        ) : custom.length === 0 ? (
          <p className="text-[13px] text-[var(--text-3)] py-6 text-center">
            No custom columns. The ledger shows the 9 standard columns only.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] -mx-1">
            {custom.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-1 py-3">
                <span className="num text-[11.5px] text-[var(--text-3)] w-5 shrink-0">{c.position}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] text-[var(--text-1)] truncate">{c.label}</span>
                    <Badge tone="neutral">{c.type}</Badge>
                    {c.isRequired && <Badge tone="warning">Required</Badge>}
                    {!c.isActive && <Badge tone="danger">Archived</Badge>}
                  </div>
                  <p className="text-[11.5px] text-[var(--text-3)] mt-0.5 font-mono">{c.key}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenameTarget(c);
                      setRenameValue(c.label);
                    }}
                  >
                    Rename
                  </Button>
                  {c.isActive ? (
                    <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(c)}>
                      Archive
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={patch.isPending && patch.variables?.id === c.id}
                      onClick={() => patch.mutate({ id: c.id, body: { isActive: true } })}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AddColumnModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(v) => create.mutate(v)}
        submitting={create.isPending}
        error={create.error instanceof ApiError ? create.error.message : null}
      />

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename column"
        description="Changes the display label only. The storage key and existing values are untouched."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)} data-close>Cancel</Button>
            <Button
              variant="primary"
              loading={patch.isPending}
              onClick={() =>
                renameTarget && patch.mutate({ id: renameTarget.id, body: { label: renameValue.trim() } })
              }
            >
              Save label
            </Button>
          </>
        }
      >
        <Label htmlFor="rename-label" required>Label</Label>
        <Input
          id="rename-label"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          maxLength={60}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archive.mutate(archiveTarget.id)}
        title={`Archive "${archiveTarget?.label}"?`}
        description="It disappears from the ledger table for all users. Every historical value is preserved and the column can be restored later."
        confirmLabel="Archive column"
        loading={archive.isPending}
      />
    </Page>
  );
}

function AddColumnModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: ColumnCreateInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ColumnCreateInput>({
    resolver: zodResolver(columnCreateSchema),
    defaultValues: { type: 'TEXT', isRequired: false },
  });

  const label = watch('label');
  const submit = handleSubmit((v) => onSubmit(v));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a custom column"
      description="New columns appear to the right of the 9 standard columns for every user."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-close>Cancel</Button>
          <Button variant="primary" loading={submitting} onClick={() => void submit()}>
            Add column
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
          <Label htmlFor="col-label" required>Label</Label>
          <Input
            id="col-label"
            invalid={Boolean(errors.label)}
            {...register('label', {
              onChange: (e) => {
                // Derive a stable snake_case storage key from the label.
                const slug = String(e.target.value)
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '_')
                  .replace(/^_+|_+$/g, '')
                  .slice(0, 40);
                setValue('key', slug, { shouldValidate: Boolean(slug) });
              },
            })}
          />
          <FieldError>{errors.label?.message}</FieldError>
        </div>

        <div>
          <Label htmlFor="col-key" required>Storage key</Label>
          <Input id="col-key" className="font-mono text-[13px]" invalid={Boolean(errors.key)} {...register('key')} />
          <FieldError>{errors.key?.message}</FieldError>
          <Hint>Permanent. Used to store values and cannot be changed later.</Hint>
        </div>

        <div>
          <Label htmlFor="col-type" required>Type</Label>
          <select
            id="col-type"
            {...register('type')}
            className="w-full h-11 px-3 rounded-md bg-[var(--surface-1)] text-[var(--text-1)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[14px]"
          >
            {COLUMN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
          <Hint>Values are always stored as text and cast for display.</Hint>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input type="checkbox" {...register('isRequired')} className="h-4 w-4 accent-[var(--accent)]" />
          <span className="text-[13px] text-[var(--text-2)]">Required field</span>
        </label>

        {label && (
          <p className="text-[12px] text-[var(--text-3)] pt-1">
            Preview: this appears as a new column labelled “{label}” in every user's ledger.
          </p>
        )}
      </form>
    </Modal>
  );
}

/**
 * User management (11 section 2).
 *
 * MAX_USERS is enforced by the SAME server-side check as self-signup - the
 * count shown here comes from the Worker, never computed client-side.
 * Delete defaults to deactivation; permanent purge is a separate, clearly
 * dangerous action behind extra confirmation (11 s2.4).
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ownerCreateUserSchema, type OwnerCreateUserInput } from '../../../shared/validation';
import type { OwnerUserRow } from '../../../shared/types';
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
  Skeleton,
} from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlays';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../lib/api';
import { formatDateMedium, formatNumber, formatRelative, initials } from '../../lib/format';
import { CapacityCard } from './HealthCard';

interface UsersResponse {
  items: OwnerUserRow[];
  userCount: number;
  maxUsers: number;
}

export function OwnerUsers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<OwnerUserRow | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['owner', 'users'],
    queryFn: () => apiGet<UsersResponse>('/api/owner/users'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['owner'] });
  };

  const create = useMutation({
    mutationFn: (input: OwnerCreateUserInput) => apiPost('/api/owner/users', input),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      toast({ title: 'User created', description: 'Share the temporary password securely.', tone: 'success' });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'DISABLED' }) =>
      apiPatch(`/api/owner/users/${id}`, { status }),
    onSuccess: (_d, v) => {
      invalidate();
      toast({
        title: v.status === 'ACTIVE' ? 'User reactivated' : 'User deactivated',
        description: v.status === 'DISABLED' ? 'Their data is fully retained.' : undefined,
        tone: 'success',
      });
    },
  });

  const purge = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/owner/users/${id}?purge=true`),
    onSuccess: () => {
      invalidate();
      setPurgeTarget(null);
      setPurgeConfirmText('');
      toast({ title: 'User data purged', tone: 'neutral' });
    },
    onError: (e) =>
      toast({ title: 'Purge failed', description: e instanceof ApiError ? e.message : undefined, tone: 'danger' }),
  });

  const atCapacity = data ? data.userCount >= data.maxUsers : false;

  return (
    <Page
      title="Users"
      actions={
        <Button size="sm" variant="primary" disabled={atCapacity} onClick={() => setAddOpen(true)}>
          Add user
        </Button>
      }
    >
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <CapacityCard used={data.userCount} max={data.maxUsers} />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="flex items-center gap-3.5">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </Card>
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <EmptyState title="No users yet" description="Create the first account to get started." />
        </Card>
      ) : (
        <div className="space-y-1.5">
          {data?.items.map((u) => (
            <Card key={u.id} className="flex flex-wrap items-center gap-3">
              <span
                className="grid place-items-center h-10 w-10 rounded-full shrink-0 text-[13px] font-semibold"
                style={{
                  background: u.role === 'OWNER' ? 'var(--accent-soft)' : 'var(--surface-3)',
                  color: u.role === 'OWNER' ? 'var(--accent)' : 'var(--text-2)',
                }}
                aria-hidden
              >
                {initials(u.displayName || u.email)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13.5px] font-medium text-[var(--text-1)] truncate">
                    {u.displayName || '—'}
                  </p>
                  {u.role === 'OWNER' && <Badge tone="accent">Owner</Badge>}
                  {u.status === 'DISABLED' && <Badge tone="danger">Disabled</Badge>}
                  {u.authProvider === 'GOOGLE' && <Badge tone="neutral">Google</Badge>}
                </div>
                <p className="text-[12px] text-[var(--text-3)] truncate mt-0.5">{u.email}</p>
                <p className="text-[11.5px] text-[var(--text-3)] mt-0.5">
                  Joined {formatDateMedium(new Date(u.createdAt).toISOString().slice(0, 10))} ·{' '}
                  {formatNumber(u.transactionCount)} transactions · last seen{' '}
                  {formatRelative(u.lastLoginAt)}
                </p>
              </div>

              {u.role !== 'OWNER' && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={setStatus.isPending && setStatus.variables?.id === u.id}
                    onClick={() =>
                      setStatus.mutate({
                        id: u.id,
                        status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                      })
                    }
                  >
                    {u.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPurgeTarget(u)}>
                    Purge
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(v) => create.mutate(v)}
        submitting={create.isPending}
        error={create.error instanceof ApiError ? create.error.message : null}
      />

      {/* Purge requires typing the email: a deliberate friction step. */}
      <Modal
        open={Boolean(purgeTarget)}
        onClose={() => {
          setPurgeTarget(null);
          setPurgeConfirmText('');
        }}
        title="Permanently purge user data"
        description="This deletes all of their transactions, customers and ledger days. Audit records are retained without a user reference."
        footer={
          <>
            <Button
              variant="ghost"
              data-close
              onClick={() => {
                setPurgeTarget(null);
                setPurgeConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={purge.isPending}
              disabled={purgeConfirmText !== purgeTarget?.email}
              onClick={() => purgeTarget && purge.mutate(purgeTarget.id)}
            >
              Purge permanently
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed mb-3">
          Deactivating is almost always the right choice — it blocks access while keeping every
          record intact. Purging cannot be undone.
        </p>
        <Label htmlFor="purge-confirm">
          Type <span className="font-mono text-[var(--text-1)]">{purgeTarget?.email}</span> to confirm
        </Label>
        <Input
          id="purge-confirm"
          value={purgeConfirmText}
          onChange={(e) => setPurgeConfirmText(e.target.value)}
          autoComplete="off"
        />
      </Modal>

    </Page>
  );
}

function AddUserModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: OwnerCreateUserInput) => void;
  submitting: boolean;
  error: string | null;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<OwnerCreateUserInput>({ resolver: zodResolver(ownerCreateUserSchema) });

  const submit = handleSubmit((v) => onSubmit(v));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a user"
      description="Counts against MAX_USERS, enforced by the same server-side check as self-signup."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-close>Cancel</Button>
          <Button variant="primary" loading={submitting} onClick={() => void submit()}>
            Create user
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
          <Label htmlFor="ou-name" required>Display name</Label>
          <Input id="ou-name" invalid={Boolean(errors.displayName)} {...register('displayName')} />
          <FieldError>{errors.displayName?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="ou-email" required>Email</Label>
          <Input id="ou-email" type="email" autoCapitalize="none" spellCheck={false} invalid={Boolean(errors.email)} {...register('email')} />
          <FieldError>{errors.email?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="ou-pw" required>Temporary password</Label>
          <Input id="ou-pw" type="text" autoComplete="off" invalid={Boolean(errors.tempPassword)} {...register('tempPassword')} />
          <FieldError>{errors.tempPassword?.message}</FieldError>
          <Hint>Share it through a secure channel. It is stored only as a hash.</Hint>
        </div>
      </form>
    </Modal>
  );
}

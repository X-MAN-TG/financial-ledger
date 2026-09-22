/**
 * Global audit log (11 section 3 / 12 section 7).
 * Filterable by user, action and date range. Secrets are never written to
 * audit_logs server-side, so nothing here needs redaction at render time.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditEntry, ListResponse, OwnerUserRow } from '../../../shared/types';
import { Page } from '../../components/AppShell';
import { Badge, Button, Card, EmptyState, Input, Label, Skeleton } from '../../components/ui/primitives';
import { apiGet } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

const ACTION_GROUPS = [
  { value: '', label: 'All actions' },
  { value: 'LOGIN', label: 'Sign-in' },
  { value: 'TRANSACTION', label: 'Transactions' },
  { value: 'CUSTOMER', label: 'Customers' },
  { value: 'LEDGER_DAY', label: 'Ledger days' },
  { value: 'SYNC', label: 'Sync' },
  { value: 'BACKUP', label: 'Backup' },
  { value: 'OWNER', label: 'Owner actions' },
  { value: 'COLUMN', label: 'Columns' },
];

export function OwnerAudit() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [from, to, userId, action]);

  const { data: users } = useQuery({
    queryKey: ['owner', 'users'],
    queryFn: () => apiGet<{ items: OwnerUserRow[] }>('/api/owner/users'),
  });

  const buildQs = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (userId) qs.set('userId', userId);
    if (action) qs.set('action', action);
    return qs.toString();
  }, [page, from, to, userId, action]);

  const { data, isLoading } = useQuery({
    queryKey: ['owner', 'audit', buildQs()],
    queryFn: () => apiGet<ListResponse<AuditEntry>>(`/api/owner/audit?${buildQs()}`),
  });

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Page title="Audit log" subtitle={data ? `${data.total} entries` : undefined}>
      <Card className="mb-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label htmlFor="a-from">From</Label>
            <Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="a-to">To</Label>
            <Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="a-user">User</Label>
            <select
              id="a-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full h-11 px-3 rounded-md bg-[var(--surface-1)] text-[var(--text-1)] border border-[var(--border)] text-[14px] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="">All users</option>
              {users?.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName || u.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="a-action">Action</Label>
            <select
              id="a-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full h-11 px-3 rounded-md bg-[var(--surface-1)] text-[var(--text-1)] border border-[var(--border)] text-[14px] focus:outline-none focus:border-[var(--accent)]"
            >
              {ACTION_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(from || to || userId || action) && (
          <div className="flex justify-end mt-3 pt-3 border-t border-[var(--border)]">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFrom('');
                setTo('');
                setUserId('');
                setAction('');
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      <Card padded={false}>
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="No audit entries" description="No activity matches these filters." />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {items.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: e.result === 'FAILURE' ? 'var(--danger)' : 'var(--success)' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12.5px] font-medium text-[var(--text-1)] font-mono">
                      {e.action}
                    </span>
                    {e.scope === 'GLOBAL' && <Badge tone="accent">Global</Badge>}
                    {e.result === 'FAILURE' && <Badge tone="danger">Failure</Badge>}
                  </div>
                  <p className="text-[11.5px] text-[var(--text-3)] mt-0.5 truncate">
                    {e.actorEmail ?? 'system'} · {e.resourceType}
                    {e.resourceId ? ` · ${e.resourceId.slice(0, 8)}…` : ''}
                  </p>
                </div>
                <span className="text-[11.5px] text-[var(--text-3)] shrink-0 hidden sm:block">
                  {formatDateTime(e.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-[12.5px] text-[var(--text-3)]">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Page>
  );
}

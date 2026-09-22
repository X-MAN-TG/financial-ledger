/**
 * Trash (07 section 6): soft-deleted rows, restorable. Permanent purge is
 * explicit and irreversible, and the Worker refuses to purge anything that
 * is not already soft-deleted.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListResponse, Transaction } from '../../../shared/types';
import { Button, Card, EmptyState, SectionTitle, Skeleton } from '../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../components/ui/overlays';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { formatDateMedium, formatMoney, formatRelative } from '../../lib/format';

export function TrashTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [purgeTarget, setPurgeTarget] = useState<Transaction | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => apiGet<ListResponse<Transaction>>('/api/transactions/trash?pageSize=100'),
  });

  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/api/transactions/${id}/restore`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trash'] });
      toast({ title: 'Row restored', description: 'It is back on its original day.', tone: 'success' });
    },
  });

  const purge = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/transactions/${id}/purge`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trash'] });
      setPurgeTarget(null);
      toast({ title: 'Permanently deleted', tone: 'neutral' });
    },
  });

  const items = data?.items ?? [];

  return (
    <Card>
      <SectionTitle
        title="Trash"
        subtitle="Deleted rows are kept here so nothing is ever lost by accident"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4.5A.5.5 0 019.5 4h5a.5.5 0 01.5.5V7" />
            </svg>
          }
          title="Trash is empty"
          description="Rows you delete from the ledger appear here and can be restored."
        />
      ) : (
        <div className="divide-y divide-[var(--border)] -mx-1">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-[var(--text-1)] truncate">
                  {t.customerNameSnapshot ?? 'Unnamed row'}
                </p>
                <p className="text-[12px] text-[var(--text-3)] mt-0.5">
                  {t.date ? formatDateMedium(t.date) : '—'} · {formatMoney(t.inrAmount, 'INR')} ·
                  deleted {formatRelative(t.deletedAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={restore.isPending && restore.variables === t.id}
                onClick={() => restore.mutate(t.id)}
              >
                Restore
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPurgeTarget(t)}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(purgeTarget)}
        onClose={() => setPurgeTarget(null)}
        onConfirm={() => purgeTarget && purge.mutate(purgeTarget.id)}
        title="Permanently delete this row?"
        description="This cannot be undone. The row will be removed from the database entirely."
        confirmLabel="Delete forever"
        destructive
        loading={purge.isPending}
      />
    </Card>
  );
}

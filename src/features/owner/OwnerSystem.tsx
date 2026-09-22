/**
 * Owner Backup Center (11 section 5 / 14 section 3).
 *
 * The status shown here mirrors backup_records exactly: an unverified or
 * failed backup is never displayed as green (14 s4).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupRecord, HealthReport, ListResponse } from '../../../shared/types';
import { Page } from '../../components/AppShell';
import { Badge, Button, Card, EmptyState, SectionTitle, Skeleton } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlays';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import { HealthCard } from './HealthCard';

export function OwnerSystem() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const health = useQuery({
    queryKey: ['owner', 'health'],
    queryFn: () => apiGet<HealthReport>('/api/owner/health'),
  });

  const history = useQuery({
    queryKey: ['owner', 'backup', 'history'],
    queryFn: () => apiGet<ListResponse<BackupRecord>>('/api/owner/backup/history'),
  });

  const trigger = async () => {
    try {
      const res = await apiPost<{ status: string; record?: BackupRecord }>('/api/owner/backup/trigger');
      void qc.invalidateQueries({ queryKey: ['owner'] });
      // The Worker reports the real outcome; we never assume success.
      if (res.status === 'SUCCESS') {
        toast({ title: 'Backup completed and verified', tone: 'success' });
      } else if (res.status === 'NOT_CONFIGURED') {
        toast({
          title: 'R2 is not configured',
          description: 'Bind a BACKUP_BUCKET to enable scheduled backups.',
          tone: 'warning',
        });
      } else {
        toast({
          title: 'Backup failed',
          description: res.record?.errorMessage ?? 'See backup history for detail.',
          tone: 'danger',
        });
      }
    } catch (e) {
      toast({
        title: 'Backup failed',
        description: e instanceof ApiError ? e.message : undefined,
        tone: 'danger',
      });
    }
  };

  const h = health.data;
  const items = history.data?.items ?? [];

  return (
    <Page
      title="Backup and storage"
      subtitle="R2 snapshots, history and manual controls"
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={h?.r2 === 'NOT_CONFIGURED'}
          onClick={() => void trigger()}
        >
          Trigger backup now
        </Button>
      }
    >
      {health.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : h ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          <HealthCard
            title="R2 bucket"
            status={h.r2}
            detail={h.r2 === 'NOT_CONFIGURED' ? 'Bind BACKUP_BUCKET to enable' : 'Object storage reachable'}
          />
          <HealthCard title="D1 database" status={h.d1} detail={`${h.dbLatencyMs} ms ping`} />
          <Card>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
              Last backup
            </p>
            <p className="text-[15px] font-medium text-[var(--text-1)] mt-2.5 leading-none">
              {h.lastBackupAt ? formatRelative(h.lastBackupAt) : 'Never'}
            </p>
            <p
              className="text-[11.5px] mt-2"
              style={{
                color:
                  h.lastBackupStatus === 'SUCCESS'
                    ? 'var(--success)'
                    : h.lastBackupStatus === 'FAILURE'
                      ? 'var(--danger)'
                      : 'var(--text-3)',
              }}
            >
              {h.lastBackupStatus ?? 'No backup recorded yet'}
            </p>
          </Card>
        </div>
      ) : null}

      {h?.r2 === 'NOT_CONFIGURED' && (
        <div
          className="rounded-lg px-4 py-3.5 mb-4 text-[13px] leading-relaxed"
          style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
          role="status"
        >
          <span className="font-semibold">Automated backups are not active.</span> No R2 bucket is
          bound to this deployment, so scheduled snapshots cannot run. D1 Time Travel still provides
          short-term recovery, and users can export their own data at any time.
        </div>
      )}

      <Card padded={false}>
        <div className="px-4 pt-4">
          <SectionTitle
            title="Backup history"
            subtitle="Every attempt, including failures"
          />
        </div>
        {history.isLoading ? (
          <div className="px-4 pb-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No backups recorded"
            description="Scheduled and manual backup attempts will be listed here."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {items.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <Badge
                  tone={
                    r.status === 'SUCCESS' ? 'success' : r.status === 'IN_PROGRESS' ? 'info' : 'danger'
                  }
                >
                  {r.status === 'SUCCESS' ? 'Success' : r.status === 'IN_PROGRESS' ? 'Running' : 'Failed'}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[var(--text-1)] truncate">
                    {r.type.replace(/_/g, ' ')}
                  </p>
                  {r.errorMessage && (
                    <p className="text-[11.5px] text-[var(--danger)] truncate mt-0.5">
                      {r.errorMessage}
                    </p>
                  )}
                  {r.fileRef && !r.errorMessage && (
                    <p className="text-[11.5px] text-[var(--text-3)] truncate mt-0.5 font-mono">
                      {r.fileRef}
                    </p>
                  )}
                </div>
                {r.sizeBytes ? (
                  <span className="num text-[12px] text-[var(--text-3)] shrink-0">
                    {formatBytes(r.sizeBytes)}
                  </span>
                ) : null}
                <span className="text-[11.5px] text-[var(--text-3)] shrink-0 hidden sm:block">
                  {formatDateTime(r.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}

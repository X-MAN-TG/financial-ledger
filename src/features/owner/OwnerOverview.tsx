/**
 * Owner overview: health at a glance + database statistics (11 s4 + s6).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { HealthReport, OwnerStats } from '../../../shared/types';
import { Page } from '../../components/AppShell';
import { Button, Card, SectionTitle, Skeleton } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlays';
import { apiGet, apiPost } from '../../lib/api';
import { formatBytes, formatNumber, formatRelative } from '../../lib/format';
import { CapacityCard, HealthCard } from './HealthCard';

export function OwnerOverview() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  const health = useQuery({
    queryKey: ['owner', 'health'],
    queryFn: () => apiGet<HealthReport>('/api/owner/health'),
    refetchInterval: 60_000,
  });

  const stats = useQuery({
    queryKey: ['owner', 'stats'],
    queryFn: () => apiGet<OwnerStats>('/api/owner/stats'),
  });

  const runCheck = async () => {
    try {
      await apiPost('/api/owner/health/ping');
      await qc.invalidateQueries({ queryKey: ['owner', 'health'] });
      toast({ title: 'Health check complete', tone: 'success' });
    } catch {
      toast({ title: 'Health check failed', tone: 'danger' });
    }
  };

  const h = health.data;
  const s = stats.data;

  return (
    <Page
      title="System overview"
      subtitle={h ? `Last checked ${formatRelative(h.checkedAt)}` : undefined}
      actions={
        <Button size="sm" variant="secondary" loading={health.isFetching} onClick={() => void runCheck()}>
          Run health check
        </Button>
      }
    >
      {health.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-6 w-24 mt-3" />
            </Card>
          ))}
        </div>
      ) : h ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <HealthCard title="Worker" status={h.worker} detail="Request handling" />
            <HealthCard title="D1 Database" status={h.d1} detail={`${h.dbLatencyMs} ms ping`} />
            <HealthCard
              title="R2 Backups"
              status={h.r2}
              detail={h.r2 === 'NOT_CONFIGURED' ? 'No bucket bound' : 'Object storage'}
            />
            <HealthCard title="Authentication" status={h.auth} detail="Sessions and hashing" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <CapacityCard used={h.userCount} max={h.maxUsers} />
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
                {h.lastBackupStatus ?? 'No backup recorded'}
              </p>
            </Card>
            <Card>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
                DB latency
              </p>
              <p className="num text-[24px] font-semibold text-[var(--text-1)] mt-2 leading-none">
                {h.dbLatencyMs}
                <span className="text-[14px] font-medium text-[var(--text-3)]"> ms</span>
              </p>
            </Card>
            <Card>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
                Sync errors
              </p>
              <p
                className="num text-[24px] font-semibold mt-2 leading-none"
                style={{ color: h.syncErrorCount > 0 ? 'var(--warning)' : 'var(--text-1)' }}
              >
                {formatNumber(h.syncErrorCount)}
              </p>
              <p className="text-[11.5px] text-[var(--text-3)] mt-2">Rejected operations</p>
            </Card>
          </div>
        </>
      ) : null}

      <Card>
        <SectionTitle
          title="Database statistics"
          subtitle="Aggregate counts across all users"
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate('/owner/users')}>
              Manage users
            </Button>
          }
        />
        {stats.isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : s ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            <StatLine label="Total users" value={formatNumber(s.totalUsers)} sub={`${s.activeUsers} active`} />
            <StatLine label="Transactions" value={formatNumber(s.totalTransactions)} sub="all users" />
            <StatLine label="Customers" value={formatNumber(s.totalCustomers)} sub="all users" />
            <StatLine label="Ledger days" value={formatNumber(s.totalLedgerDays)} sub="all users" />
            <StatLine label="Audit entries" value={formatNumber(s.totalAuditEntries)} sub="retained" />
            <StatLine label="Storage estimate" value={formatBytes(s.storageEstimateBytes)} sub="approximate" />
          </div>
        ) : null}
      </Card>
    </Page>
  );
}

function StatLine({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-[var(--text-3)] leading-none">{label}</p>
      <p className="num text-[19px] font-semibold text-[var(--text-1)] mt-1.5 leading-none">{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-3)] mt-1">{sub}</p>}
    </div>
  );
}

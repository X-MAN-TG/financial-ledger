/**
 * Personal activity log (12-audit-logging.txt section 7: users see their own
 * scope, at least the last 7 days). Secrets are never logged server-side, so
 * there is nothing sensitive to hide here.
 */
import { useQuery } from '@tanstack/react-query';
import type { AuditEntry, ListResponse } from '../../../shared/types';
import { Badge, Card, EmptyState, SectionTitle, Skeleton } from '../../components/ui/primitives';
import { apiGet } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

/** Human phrasing for audit action codes. */
const LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILURE: 'Failed sign-in attempt',
  LOGOUT: 'Signed out',
  SIGNUP: 'Account created',
  PROFILE_UPDATED: 'Profile updated',
  SETTINGS_UPDATED: 'Settings updated',
  TRANSACTION_CREATED: 'Transaction added',
  TRANSACTION_UPDATED: 'Transaction edited',
  TRANSACTION_DELETED: 'Transaction deleted',
  TRANSACTION_RESTORED: 'Transaction restored',
  TRANSACTION_PURGED: 'Transaction permanently deleted',
  TRANSACTION_COMPLETION_REJECTED: 'Completion rejected — required fields missing',
  NOTE_UPDATED: 'Note updated',
  CUSTOMER_CREATED: 'Customer added',
  CUSTOMER_UPDATED: 'Customer updated',
  CUSTOMER_DELETED: 'Customer removed',
  LEDGER_DAY_CREATED: 'Ledger day opened',
  LEDGER_DAY_MARKED_OFF: 'Day marked as Day Off',
  LEDGER_DAY_REOPENED: 'Day reopened',
  SYNC_BATCH_APPLIED: 'Offline changes synced',
  SYNC_CONFLICT_DETECTED: 'Sync conflict resolved',
  EXPORT_GENERATED: 'Data exported',
  BACKUP_IMPORTED: 'Backup imported',
};

export function ActivityTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', 'me'],
    queryFn: () => apiGet<ListResponse<AuditEntry>>('/api/audit/me?pageSize=60'),
  });

  const items = data?.items ?? [];

  return (
    <Card>
      <SectionTitle title="Activity" subtitle="A record of actions taken on your account" />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="Could not load activity" description="Please try again in a moment." />
      ) : items.length === 0 ? (
        <EmptyState title="No activity recorded" description="Your account actions will appear here." />
      ) : (
        <div className="divide-y divide-[var(--border)] -mx-1">
          {items.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-1 py-2.5">
              <span
                aria-hidden
                className="mt-[7px] h-1.5 w-1.5 rounded-full shrink-0"
                style={{
                  background: e.result === 'FAILURE' ? 'var(--danger)' : 'var(--success)',
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-[var(--text-1)]">
                  {LABELS[e.action] ?? e.action.replace(/_/g, ' ').toLowerCase()}
                </p>
                <p className="text-[11.5px] text-[var(--text-3)] mt-0.5">
                  {formatDateTime(e.createdAt)}
                  {e.resourceType ? ` · ${e.resourceType.replace(/_/g, ' ')}` : ''}
                </p>
              </div>
              {e.result === 'FAILURE' && <Badge tone="danger">Failed</Badge>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

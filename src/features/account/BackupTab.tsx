/**
 * User Backup Center (14 section 2).
 *
 * Honesty rule (14 s4): an export is only recorded as SUCCESS if it really
 * completed. Every failure path reports FAILURE to /api/backup/export with
 * the reason, so the history never lies.
 */
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import type { BackupRecord } from '../../../shared/types';
import { Badge, Button, Card, EmptyState, SectionTitle, Skeleton } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlays';
import { useSession } from '../../hooks/use-session';
import { useSyncState } from '../../components/SyncStatusPill';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import type { PdfProgress } from '../backup/pdf';

interface BackupStatusResponse {
  lastSyncAt: number | null;
  lastExportAt: number | null;
  lastExportType: string | null;
  lastExportStatus: string | null;
  recent: BackupRecord[];
}

export function BackupTab() {
  const { db } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const sync = useSyncState();
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const status = useQuery({
    queryKey: ['backup', 'status'],
    queryFn: () => apiGet<BackupStatusResponse>('/api/backup/status'),
  });

  const pending = useLiveQuery(
    async () => (db ? await db.syncQueue.where('status').anyOf('PENDING', 'FAILED', 'SYNCING').count() : 0),
    [db],
    0,
  );

  /** Reports the true outcome of a client-side export (14 s4). */
  const report = async (
    type: 'JSON' | 'CSV' | 'PDF',
    outcome: 'SUCCESS' | 'FAILURE',
    sizeBytes?: number,
    errorMessage?: string,
  ) => {
    try {
      await apiPost('/api/backup/export', {
        type,
        status: outcome,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        ...(errorMessage ? { errorMessage: errorMessage.slice(0, 500) } : {}),
      });
    } catch {
      /* recording the record must never mask the export result itself */
    }
    void qc.invalidateQueries({ queryKey: ['backup', 'status'] });
  };

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = async () => {
    setBusy('JSON');
    try {
      const data = await apiGet<Record<string, unknown>>('/api/export/all');
      const text = JSON.stringify(data, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      download(blob, `ledger-backup-${new Date().toISOString().slice(0, 10)}.json`);
      await report('JSON', 'SUCCESS', blob.size);
      toast({ title: 'JSON backup downloaded', tone: 'success' });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Export failed';
      await report('JSON', 'FAILURE', undefined, msg);
      toast({ title: 'Backup failed', description: msg, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setBusy('CSV');
    try {
      const data = await apiGet<{ transactions: Array<Record<string, unknown>> }>('/api/export/all');
      const csv = toCsv(data.transactions ?? []);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      download(blob, `ledger-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
      await report('CSV', 'SUCCESS', blob.size);
      toast({ title: 'CSV downloaded', tone: 'success' });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Export failed';
      await report('CSV', 'FAILURE', undefined, msg);
      toast({ title: 'Export failed', description: msg, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async () => {
    setBusy('PDF');
    setPdfProgress(null);
    try {
      // Loaded lazily so jsPDF never enters the initial bundle (15 s2).
      const { generateFullPdf } = await import('../backup/pdf');
      await generateFullPdf((p) => setPdfProgress(p));
      await report('PDF', 'SUCCESS');
      toast({ title: 'PDF generated', tone: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PDF generation failed';
      if (msg === 'NO_DATA') {
        toast({ title: 'Nothing to export yet', description: 'Record some transactions first.', tone: 'info' });
      } else {
        // The ledger data itself is untouched - PDF export is read-only (15 s5).
        await report('PDF', 'FAILURE', undefined, msg);
        toast({
          title: 'PDF generation failed',
          description: 'Your ledger data is unaffected. Try a smaller range or retry.',
          tone: 'danger',
        });
      }
    } finally {
      setBusy(null);
      setPdfProgress(null);
    }
  };

  const onPickFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ImportPayloadShape;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.transactions)) {
        throw new Error('This does not look like a Ledger backup file.');
      }
      setImportPreview({
        fileName: file.name,
        exportedAt: parsed.exportedAt,
        customers: parsed.customers?.length ?? 0,
        ledgerDays: parsed.ledgerDays?.length ?? 0,
        transactions: parsed.transactions.length,
        payload: parsed,
      });
    } catch (e) {
      toast({
        title: 'Could not read that file',
        description: e instanceof Error ? e.message : 'Invalid JSON',
        tone: 'danger',
      });
    }
  };

  const runImport = async () => {
    if (!importPreview) return;
    setBusy('IMPORT');
    try {
      const res = await apiPost<{ customersInserted: number; daysInserted: number; transactionsInserted: number; transactionsSkipped: number }>(
        '/api/backup/import',
        importPreview.payload,
      );
      toast({
        title: 'Backup restored',
        description: `${res.transactionsInserted} added, ${res.transactionsSkipped} already present`,
        tone: 'success',
      });
      setImportPreview(null);
      void qc.invalidateQueries();
    } catch (e) {
      toast({
        title: 'Import failed',
        description: e instanceof ApiError ? e.message : 'Please try again',
        tone: 'danger',
      });
    } finally {
      setBusy(null);
    }
  };

  const s = status.data;

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------- data status */}
      <Card>
        <SectionTitle title="Data status" subtitle="Where your records currently live" />
        {status.isLoading ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <StatusRow
              label="On this device"
              value={pending > 0 ? `${pending} item${pending === 1 ? '' : 's'} pending sync` : 'All synced'}
              tone={pending > 0 ? 'warning' : 'success'}
              detail={sync.lastSyncAt ? `Last sync ${formatRelative(sync.lastSyncAt)}` : 'Not synced yet'}
            />
            <StatusRow
              label="In the cloud"
              value={s?.lastSyncAt ? `Confirmed ${formatRelative(s.lastSyncAt)}` : 'No writes recorded yet'}
              tone={s?.lastSyncAt ? 'success' : 'neutral'}
              detail="Cloudflare D1"
            />
            <StatusRow
              label="Last export"
              value={s?.lastExportAt ? `${s.lastExportType?.replace('USER_EXPORT_', '')} · ${formatRelative(s.lastExportAt)}` : 'Never exported'}
              tone={s?.lastExportStatus === 'SUCCESS' ? 'success' : s?.lastExportAt ? 'danger' : 'neutral'}
              detail={s?.lastExportAt ? formatDateTime(s.lastExportAt) : 'Download a copy you own'}
            />
            <StatusRow
              label="Sync queue"
              value={sync.failed > 0 ? `${sync.failed} failed` : sync.pending > 0 ? `${sync.pending} queued` : 'Empty'}
              tone={sync.failed > 0 ? 'danger' : sync.pending > 0 ? 'warning' : 'success'}
              detail={sync.lastError ?? 'No errors'}
            />
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------ exports */}
      <Card>
        <SectionTitle
          title="Export your data"
          subtitle="An independent copy you own, outside this application"
        />
        <div className="grid sm:grid-cols-3 gap-2.5">
          <ExportButton
            title="JSON"
            description="Complete backup, re-importable"
            loading={busy === 'JSON'}
            disabled={Boolean(busy)}
            onClick={() => void exportJson()}
          />
          <ExportButton
            title="CSV"
            description="Flat transaction rows for spreadsheets"
            loading={busy === 'CSV'}
            disabled={Boolean(busy)}
            onClick={() => void exportCsv()}
          />
          <ExportButton
            title="PDF"
            description="Formatted full history document"
            loading={busy === 'PDF'}
            disabled={Boolean(busy)}
            onClick={() => void exportPdf()}
          />
        </div>

        {pdfProgress && (
          <div className="mt-3.5 pt-3.5 border-t border-[var(--border)]">
            <div className="flex items-center justify-between text-[12.5px] mb-2">
              <span className="text-[var(--text-2)]">Building your document…</span>
              <span className="num text-[var(--text-3)]">
                {pdfProgress.daysDone} / {pdfProgress.totalDays} days
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${(pdfProgress.daysDone / Math.max(1, pdfProgress.totalDays)) * 100}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------- import */}
      <Card>
        <SectionTitle
          title="Restore from a backup"
          subtitle="Import a JSON backup into your own account"
        />
        <p className="text-[13px] text-[var(--text-2)] leading-relaxed mb-3">
          Records that already exist are matched by id and skipped, so importing an old backup never
          creates duplicates. Nothing is written until you confirm the preview.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickFile(f);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
          Choose backup file
        </Button>
      </Card>

      {/* ------------------------------------------------------ history */}
      <Card>
        <SectionTitle title="Export history" subtitle="Successes and failures, recorded honestly" />
        {status.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (s?.recent.length ?? 0) === 0 ? (
          <EmptyState title="No exports yet" description="Your download history will appear here." />
        ) : (
          <div className="divide-y divide-[var(--border)] -mx-1">
            {s?.recent.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-1 py-2.5">
                <Badge tone={r.status === 'SUCCESS' ? 'success' : 'danger'}>
                  {r.status === 'SUCCESS' ? 'Success' : 'Failed'}
                </Badge>
                <span className="text-[13px] text-[var(--text-1)] flex-1 truncate">
                  {r.type.replace('USER_EXPORT_', '').replace('R2_', 'R2 ')}
                </span>
                {r.sizeBytes ? (
                  <span className="num text-[12px] text-[var(--text-3)] shrink-0">
                    {formatBytes(r.sizeBytes)}
                  </span>
                ) : null}
                <span className="text-[12px] text-[var(--text-3)] shrink-0 hidden sm:block">
                  {formatDateTime(r.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(importPreview)}
        onClose={() => setImportPreview(null)}
        title="Confirm restore"
        description={importPreview?.fileName}
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportPreview(null)} data-close>Cancel</Button>
            <Button variant="primary" loading={busy === 'IMPORT'} onClick={() => void runImport()}>
              Restore into my account
            </Button>
          </>
        }
      >
        {importPreview && (
          <div className="space-y-3">
            <p className="text-[13px] text-[var(--text-2)] leading-relaxed">
              This backup was created {formatDateTime(importPreview.exportedAt)}. It will be imported
              into your own account only.
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              <PreviewStat label="Transactions" value={importPreview.transactions} />
              <PreviewStat label="Ledger days" value={importPreview.ledgerDays} />
              <PreviewStat label="Customers" value={importPreview.customers} />
            </div>
            <p className="text-[12px] text-[var(--text-3)] leading-relaxed">
              Existing records with the same id are left untouched.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>
      <p className="num text-[18px] font-semibold text-[var(--text-1)] leading-none">{value}</p>
      <p className="text-[11px] text-[var(--text-3)] mt-1.5">{label}</p>
    </div>
  );
}

function StatusRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--text-3)';
  return (
    <div className="rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">
          {label}
        </p>
      </div>
      <p className="text-[13.5px] font-medium text-[var(--text-1)] mt-1.5">{value}</p>
      {detail && <p className="text-[11.5px] text-[var(--text-3)] mt-0.5 truncate">{detail}</p>}
    </div>
  );
}

function ExportButton({
  title,
  description,
  onClick,
  loading,
  disabled,
}: {
  title: string;
  description: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-left rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3.5 py-3 hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50 disabled:pointer-events-none"
    >
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] font-semibold text-[var(--text-1)]">{title}</span>
        {loading && (
          <span
            aria-hidden
            className="animate-spin-slow h-3 w-3 rounded-full border-2 border-[var(--accent)] border-r-transparent"
          />
        )}
      </div>
      <p className="text-[12px] text-[var(--text-3)] mt-1 leading-snug">{description}</p>
    </button>
  );
}

interface ImportPayloadShape {
  version: number;
  exportedAt: number;
  customers?: unknown[];
  ledgerDays?: unknown[];
  transactions: unknown[];
}

interface ImportPreview {
  fileName: string;
  exportedAt: number;
  customers: number;
  ledgerDays: number;
  transactions: number;
  payload: ImportPayloadShape;
}

/** RFC-4180 style escaping so notes with commas/quotes survive round-trip. */
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return 'date,srNumber,customerName,inr,inrReceived,usdt,finalRub,extras,orderDone,status,note\n';
  const header = [
    'date', 'srNumber', 'customerName', 'inr', 'inrReceived',
    'usdt', 'finalRub', 'extras', 'orderDone', 'status', 'note',
  ];
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.date, r.srNumber, r.customerNameSnapshot, r.inrAmount,
      r.inrReceived ? 'yes' : 'no', r.usdtAmount, r.finalRubAmount,
      r.extrasAmount, r.orderDone ? 'yes' : 'no', r.status, r.note,
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/**
 * The daily ledger screen (06-daily-ledger-specification.txt).
 *
 * Reads come from Dexie live queries (13 s4: NOT TanStack Query), so the
 * table renders instantly from local data and updates the moment a sync
 * reconciles. Writes are local-first and queued.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, computeTotals, localDateKey, resequence } from '../../../shared/business-rules';
import type { ColumnDefinition, LocalTransaction } from '../../../shared/types';
import { Page } from '../../components/AppShell';
import { OfflineBanner } from '../../components/SyncStatusPill';
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
} from '../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../components/ui/overlays';
import { PillButton, StatusBadge } from '../../components/ui/shell-primitives';
import { IcChevronLeft, IcChevronRight, IcDownload, IcPause, IcPlay } from '../../components/ui/icons';
import { useSession } from '../../hooks/use-session';
import { apiGet } from '../../lib/api';
import { formatDateLong, formatDateMedium } from '../../lib/format';
import {
  addRow,
  deleteRow,
  openLedgerDay,
  listDayRows,
  setDayStatus,
  updateDayDetails,
  updateRow,
} from '../../offline/ledger-repo';
import type { NoteAttachment } from '../../../shared/types';
import { LedgerTable } from './LedgerTable';
import { TotalsBar } from './TotalsBar';
import { NoteSheet } from './NoteSheet';
import { DayFooterControls } from './DayFooterControls';
import { CustomerPicker } from './CustomerPicker';
import { DatePicker } from './DatePicker';

export function LedgerPage() {
  const { db, user } = useSession();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const today = localDateKey();
  const date = params.get('date') ?? today;

  const [loading, setLoading] = useState(true);
  const [dayError, setDayError] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnDefinition[]>([]);
  const [noteRow, setNoteRow] = useState<LocalTransaction | null>(null);
  const [dayNoteOpen, setDayNoteOpen] = useState(false);
  const [pickerState, setPickerState] = useState<{ row: LocalTransaction; anchor: HTMLElement } | null>(null);
  const [confirmDayOff, setConfirmDayOff] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const lastOpened = useRef<string>('');

  /* -------------------------------------------------- load / open day */
  useEffect(() => {
    if (!db || !user) return;
    let cancelled = false;
    setLoading(true);
    setDayError(null);
    void (async () => {
      try {
        await openLedgerDay(db, user.id, date);
        if (!cancelled) lastOpened.current = date;
      } catch (e) {
        if (!cancelled) setDayError(e instanceof Error ? e.message : 'Could not open this day');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, user, date]);

  /* Column definitions are small and change rarely; cached in memory.
     The API returns a list envelope: { items: [...] }. */
  useEffect(() => {
    void apiGet<{ items: ColumnDefinition[] }>('/api/columns')
      .then((r) => setColumns(r.items ?? []))
      .catch(() => undefined);
  }, []);

  /* ------------------------------------------------- live Dexie reads */
  const day = useLiveQuery(
    async () => (db ? ((await db.ledgerDays.where('date').equals(date).first()) ?? null) : null),
    [db, date],
  );

  const rows = useLiveQuery(
    async () => (db && day ? await listDayRows(db, day.id) : []),
    [db, day?.id],
    [] as LocalTransaction[],
  );

  const pendingSync = useLiveQuery(
    async () => (db ? await db.syncQueue.where('status').anyOf('PENDING', 'FAILED').count() : 0),
    [db],
    0,
  );

  // Sr Numbers are always contiguous in display order (07 s2.1).
  const displayRows = useMemo(() => resequence(rows ?? []), [rows]);
  const totals = useMemo(() => computeTotals(displayRows), [displayRows]);

  const customColumns = useMemo(
    () => (Array.isArray(columns) ? columns.filter((c) => !c.isSystem && c.isActive) : []),
    [columns],
  );

  /* ------------------------------------------------------- handlers */
  const handleEdit = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      if (!db) return;
      void updateRow(db, id, patch).catch(() =>
        toast({ title: 'Could not save that change', tone: 'danger' }),
      );
    },
    [db, toast],
  );

  const handleAddRow = useCallback(() => {
    if (!db || !user || !day) return;
    void addRow(db, user.id, day);
  }, [db, user, day]);

  const handleDelete = useCallback(
    (id: string) => {
      if (!db) return;
      const row = displayRows.find((r) => r.id === id);
      void deleteRow(db, id).then(() => {
        toast({
          title: 'Row deleted',
          description: row?.customerNameSnapshot
            ? `${row.customerNameSnapshot} moved to Trash`
            : 'Moved to Trash',
          tone: 'neutral',
          action: {
            label: 'Undo',
            onClick: () => {
              void import('../../offline/ledger-repo').then((m) => m.restoreRow(db, id));
            },
          },
        });
      });
    },
    [db, displayRows, toast],
  );

  const handleDayOff = useCallback(async () => {
    if (!db || !user || !day) return;
    setConfirmDayOff(false);
    const next = day.status === 'DAY_OFF' ? 'TRADING_DAY' : 'DAY_OFF';
    await setDayStatus(db, user.id, day, next);
    toast({
      title: next === 'DAY_OFF' ? 'Marked as Day Off' : 'Day reopened',
      description:
        next === 'DAY_OFF'
          ? 'Existing rows are preserved and excluded from trading-day averages.'
          : 'This day is a trading day again.',
      tone: 'info',
    });
  }, [db, user, day, toast]);

  const handleUpdateUsdtRate = useCallback(
    (rate: number) => {
      if (!db || !day) return;
      void updateDayDetails(db, day, { usdtRate: rate }).catch(() =>
        toast({ title: 'Could not save USDT rate', tone: 'danger' }),
      );
    },
    [db, day, toast],
  );

  const handleSaveDayNote = useCallback(
    (note: string | null, attachments: NoteAttachment[]) => {
      if (!db || !day) return;
      void updateDayDetails(db, day, { note, attachments })
        .then(() => toast({ title: 'Day note updated', tone: 'success' }))
        .catch(() => toast({ title: 'Could not save day note', tone: 'danger' }));
    },
    [db, day, toast],
  );

  const handleDownloadPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const { generateDayPdf } = await import('../backup/pdf');
      await generateDayPdf(date);
      toast({ title: 'PDF generated', tone: 'success' });
    } catch (e) {
      toast({
        title: 'Could not generate PDF',
        description: e instanceof Error ? e.message : 'PDF export failed',
        tone: 'danger',
      });
    } finally {
      setExportingPdf(false);
    }
  }, [date, toast]);

  const goToDate = (next: string) => {
    if (next === today) setParams({}, { replace: false });
    else setParams({ date: next }, { replace: false });
  };

  const isDayOff = day?.status === 'DAY_OFF';
  const isToday = date === today;

  return (
    <Page
      wide
      breadcrumbs={[
        { label: 'Workspace', to: '/home' },
        { label: 'Ledger', to: '/ledger' },
        { label: formatDateMedium(date) },
      ]}
      eyebrow="Daily ledger"
      title="Daily Ledger"
      subtitle="Record and track today's trades."
      actions={
        <>
          <PillButton
            size="sm"
            variant="ghost"
            onClick={() => goToDate(addDays(date, -1))}
            aria-label="Previous day"
            icon={<IcChevronLeft size={16} />}
          />
          <DatePicker value={date} onChange={goToDate} max={today} />
          <PillButton
            size="sm"
            variant="ghost"
            onClick={() => goToDate(addDays(date, 1))}
            aria-label="Next day"
            disabled={isToday}
            icon={<IcChevronRight size={16} />}
          />
        </>
      }
    >
      <OfflineBanner />

      {/* Day header: date identity + status + day-off control */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3 sm:mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="hidden sm:block text-[17px] sm:text-[18px] font-semibold text-[var(--text-1)] leading-tight">
              <span className="lg:hidden">{formatDateMedium(date)}</span>
              <span className="hidden lg:inline">{formatDateLong(date)}</span>
            </h2>
            {isToday && <StatusBadge tone="accent">Today</StatusBadge>}
            {isDayOff && (
              <StatusBadge tone="warning" icon={<IcPause size={12} />}>
                Day Off
              </StatusBadge>
            )}
          </div>
          <p className="text-[12.5px] text-[var(--text-3)] sm:mt-1">
            {isDayOff
              ? 'No trading on this date. Rows are preserved.'
              : `${displayRows.length} row${displayRows.length === 1 ? '' : 's'} · ${totals.completedCount} completed`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isToday && (
            <PillButton size="sm" variant="ghost" onClick={() => goToDate(today)}>
              Jump to today
            </PillButton>
          )}
          <PillButton
            size="sm"
            variant="secondary"
            icon={<IcDownload size={14} />}
            loading={exportingPdf}
            onClick={() => void handleDownloadPdf()}
            title="Download daily ledger PDF"
          >
            PDF
          </PillButton>
          <PillButton
            size="sm"
            variant={day?.note || (day?.attachments && day.attachments.length > 0) ? 'primary' : 'secondary'}
            icon={
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            }
            onClick={() => setDayNoteOpen(true)}
            title="Open Day Note & Closing Media"
          >
            Day Note
            {(day?.note || (day?.attachments && day.attachments.length > 0)) && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            )}
          </PillButton>
          <PillButton
            size="sm"
            variant="secondary"
            icon={isDayOff ? <IcPlay size={14} /> : <IcPause size={14} />}
            onClick={() => (isDayOff ? void handleDayOff() : setConfirmDayOff(true))}
          >
            {isDayOff ? 'Reopen day' : 'Mark Day Off'}
          </PillButton>
        </div>
      </div>

      {loading && !day ? (
        <LedgerSkeleton />
      ) : dayError ? (
        <div className="card">
          <EmptyState
            title="Could not open this day"
            description={dayError}
            action={<Button variant="secondary" onClick={() => goToDate(date)}>Retry</Button>}
          />
        </div>
      ) : isDayOff && displayRows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M8 3v3M16 3v3M3.5 9h17M5 6h14a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 015 6zM9.5 13.5l5 4M14.5 13.5l-5 4" />
              </svg>
            }
            title="Day Off"
            description="This date is marked as a day off. It is excluded from trading-day averages but still appears on your timeline."
            action={
              <Button variant="secondary" onClick={() => void handleDayOff()}>
                Reopen as trading day
              </Button>
            }
          />
        </div>
      ) : displayRows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
            title="No transactions yet"
            description="Add your first row to start recording this day's transactions."
            action={<Button variant="primary" onClick={handleAddRow}>Add first row</Button>}
          />
        </div>
      ) : (
        <>
          <LedgerTable
            rows={displayRows}
            customColumns={customColumns}
            readOnly={isDayOff}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onAddRow={handleAddRow}
            onOpenNote={(row) => setNoteRow(row)}
            onOpenCustomer={(row, anchor) => setPickerState({ row, anchor })}
          />

          {!isDayOff && (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={handleAddRow}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add row
              </Button>
              <p className="text-[12px] text-[var(--text-3)] hidden sm:block">
                Press <Kbd>Enter</Kbd> in the last row to add another.
              </p>
            </div>
          )}

          {/* Daily Totals Bar */}
          <div className="mt-4 no-print">
            <TotalsBar totals={totals} pendingSync={pendingSync} />
          </div>

          {/* Day Footer Controls: USDT Rate box and Day Closing Note & Media box (kept below totals) */}
          <DayFooterControls
            day={day ?? null}
            readOnly={isDayOff}
            onUpdateUsdtRate={handleUpdateUsdtRate}
            onOpenDayNote={() => setDayNoteOpen(true)}
          />
        </>
      )}

      {/* When 0 transactions exist on this day, still show DayFooterControls below the empty state */}
      {!loading && !dayError && displayRows.length === 0 && day && (
        <DayFooterControls
          day={day}
          readOnly={isDayOff}
          onUpdateUsdtRate={handleUpdateUsdtRate}
          onOpenDayNote={() => setDayNoteOpen(true)}
        />
      )}

      {/* Row Note Sheet */}
      <NoteSheet
        row={noteRow}
        onClose={() => setNoteRow(null)}
        onSave={(note, attachments) => {
          if (noteRow) handleEdit(noteRow.id, { note, attachments });
          setNoteRow(null);
        }}
      />

      {/* Common Day Note Sheet */}
      <NoteSheet
        open={dayNoteOpen}
        title={`Day Note · ${formatDateMedium(date)}`}
        description="Final day closing, handover summary, or important notes with up to 5 screenshots."
        initialNote={day?.note ?? ''}
        initialAttachments={day?.attachments ?? []}
        placeholder="Add day closing summary, reconciliation details, or important reminders for today…"
        onClose={() => setDayNoteOpen(false)}
        onSave={(note, attachments) => {
          handleSaveDayNote(note, attachments);
          setDayNoteOpen(false);
        }}
      />

      <CustomerPicker
        state={pickerState}
        onClose={() => setPickerState(null)}
        onPick={(customer) => {
          if (pickerState) {
            handleEdit(pickerState.row.id, {
              customerId: customer.id,
              customerNameSnapshot: customer.name,
            });
          }
          setPickerState(null);
        }}
      />

      <ConfirmDialog
        open={confirmDayOff}
        onClose={() => setConfirmDayOff(false)}
        onConfirm={() => void handleDayOff()}
        title="Mark this day as a Day Off?"
        description={
          displayRows.length > 0
            ? `${displayRows.length} existing row${displayRows.length === 1 ? '' : 's'} will be preserved, and this date will be excluded from trading-day averages.`
            : 'This date will be excluded from trading-day averages.'
        }
        confirmLabel="Mark Day Off"
      />
    </Page>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded border border-[var(--border)] bg-[var(--surface-2)] text-[11px] font-medium text-[var(--text-2)]">
      {children}
    </kbd>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

function LedgerSkeleton() {
  return (
    <div className="card p-0 overflow-hidden" aria-busy="true" aria-label="Loading ledger">
      <div className="h-11 bg-[var(--surface-2)] border-b border-[var(--border)]" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 h-12 border-b border-[var(--border)] last:border-0">
          <Skeleton className="w-6 h-3.5" />
          <Skeleton className="w-32 h-3.5" />
          <Skeleton className="w-20 h-3.5 ml-auto" />
          <Skeleton className="w-20 h-3.5" />
          <Skeleton className="w-20 h-3.5" />
        </div>
      ))}
    </div>
  );
}

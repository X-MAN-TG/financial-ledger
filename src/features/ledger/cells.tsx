/**
 * Ledger table cell editors.
 *
 * Every editor is uncontrolled-while-focused and commits on blur/Enter, so
 * typing is never interrupted by an async round trip. The keyboard grid
 * (Tab/Enter/arrows) is wired through data-cell coordinates read by the
 * table container.
 */
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { cn } from '../../lib/cn';
import { LIMITS } from '../../../shared/constants';

export interface CellCoords {
  row: number;
  col: number;
}

interface BaseCellProps {
  coords: CellCoords;
  disabled?: boolean;
  onKeyGrid: (e: ReactKeyboardEvent<HTMLElement>, coords: CellCoords) => void;
}

/* -------------------------------------------------------- money input ---- */

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Raw, easy-to-edit form shown while the cell has focus. */
function editMoney(v: number | null): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * At-rest form (bug 6.3): every money cell shows exactly 2 decimals with
 * thousands grouping, so a column never mixes `94418.7` with `92611.79`.
 * parseMoney() strips the separators again on the way back in.
 */
function displayMoney(v: number | null): string {
  if (v === null || v === undefined) return '';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const MoneyCell = memo(function MoneyCell({
  value,
  onCommit,
  coords,
  disabled,
  onKeyGrid,
  align = 'right',
  placeholder = '—',
}: BaseCellProps & {
  value: number | null;
  onCommit: (next: number | null) => void;
  align?: 'left' | 'right';
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => displayMoney(value));
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // Adopt external changes (sync reconcile) only while not being edited.
  useEffect(() => {
    if (!focused) setDraft(displayMoney(value));
  }, [value, focused]);

  const commit = () => {
    const parsed = parseMoney(draft);
    const clamped =
      parsed !== null ? Math.max(-LIMITS.moneyMax, Math.min(LIMITS.moneyMax, parsed)) : null;
    setDraft(displayMoney(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      ref={ref}
      type="text"
      // Brings up the numeric keypad with a decimal point on iOS (18 s2.2).
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      data-cell={`${coords.row}-${coords.col}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(editMoney(value));
        e.currentTarget.select();
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(editMoney(value));
          e.currentTarget.blur();
        }
        onKeyGrid(e, coords);
      }}
      className={cn(
        'num w-full h-9 rounded-[var(--radius-sm)] border border-[var(--border)]',
        'bg-[var(--surface-1)] text-[13.5px] text-[var(--text-1)]',
        'px-2.5 py-1.5 transition-all duration-150',
        'hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
        'focus:bg-[var(--surface-1)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none',
        'placeholder:text-[var(--text-3)] disabled:opacity-50 disabled:cursor-not-allowed',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    />
  );
});

/* ----------------------------------------------------------- text cell --- */

export const TextCell = memo(function TextCell({
  value,
  onCommit,
  coords,
  disabled,
  onKeyGrid,
  placeholder,
  maxLength,
  onFocusCapture,
}: BaseCellProps & {
  value: string | null;
  onCommit: (next: string | null) => void;
  placeholder?: string;
  maxLength?: number;
  onFocusCapture?: () => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value ?? '');
  }, [value, focused]);

  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== value) onCommit(next);
  };

  return (
    <input
      type="text"
      autoComplete="off"
      disabled={disabled}
      maxLength={maxLength}
      data-cell={`${coords.row}-${coords.col}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        setFocused(true);
        onFocusCapture?.();
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value ?? '');
          e.currentTarget.blur();
        }
        onKeyGrid(e, coords);
      }}
      // Bug 6.4: a long name used to be clipped mid-character with no signal.
      // Inputs honour text-overflow while unfocused, so the value now elides
      // and the full string stays reachable via the native tooltip.
      title={draft || undefined}
      className={cn(
        'w-full h-9 rounded-[var(--radius-sm)] border border-[var(--border)]',
        'bg-[var(--surface-1)] text-[13.5px] text-[var(--text-1)]',
        'px-2.5 py-1.5 transition-all duration-150',
        'hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
        'focus:bg-[var(--surface-1)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none',
        'placeholder:text-[var(--text-3)] disabled:opacity-50 disabled:cursor-not-allowed',
        'text-ellipsis',
      )}
    />
  );
});

/* ----------------------------------------------------------- note icon --- */

/**
 * 16 s7.5: compact affordance that visually distinguishes "has note" from
 * "no note" - outline vs filled with a dot indicator.
 */
export const NoteButton = memo(function NoteButton({
  hasNote,
  hasAttachments,
  onClick,
  buttonRef,
}: {
  hasNote: boolean;
  hasAttachments?: boolean;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const active = hasNote || Boolean(hasAttachments);
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={active ? 'Edit note & media' : 'Add note'}
      title={hasAttachments ? 'Note with screenshots attached' : active ? 'Edit note' : 'Add note'}
      className={cn(
        'relative inline-grid place-items-center h-9 w-9 rounded-md transition-all duration-150',
        'border',
        active
          ? 'text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent)]'
          : 'text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--surface-2)] border-[var(--border)]',
      )}
    >
      {hasAttachments ? (
        <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v8.7a1.5 1.5 0 01-.44 1.06l-3.3 3.3a1.5 1.5 0 01-1.06.44H5.5A1.5 1.5 0 014 17.5v-12z" />
          <path d="M8 9h8M8 12.5h5" strokeLinecap="round" />
        </svg>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
      )}
    </button>
  );
});

/* -------------------------------------------------------- status stripe -- */

export function StatusStripe({ status }: { status: 'INCOMPLETE' | 'READY' | 'COMPLETED' }) {
  // 16 s7.6: a calm left-border accent, never a banner.
  const color =
    status === 'COMPLETED'
      ? 'var(--success)'
      : status === 'READY'
        ? 'var(--warning)'
        : 'transparent';
  return (
    <span
      aria-hidden
      className="absolute left-0 top-0 bottom-0 w-[3px] transition-colors duration-200"
      style={{ background: color }}
    />
  );
}

export function statusLabel(status: 'INCOMPLETE' | 'READY' | 'COMPLETED'): string {
  return status === 'COMPLETED' ? 'Completed' : status === 'READY' ? 'Ready' : 'Incomplete';
}

/* ------------------------------------------------------- sync indicator -- */

export function RowSyncIndicator({
  syncStatus,
  error,
}: {
  syncStatus: string;
  error?: string | null;
}) {
  if (syncStatus === 'SYNCED') return null;

  if (syncStatus === 'SYNC_FAILED') {
    return (
      <span title={error ?? 'Sync failed'} className="inline-grid place-items-center h-4 w-4" aria-label="Sync failed">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" style={{ color: 'var(--danger)' }} fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 5v3.6M8 10.8v.4" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  // PENDING_SYNC / SYNCING / LOCAL_ONLY: a quiet pending dot, not a spinner
  // per row (that would make the table feel frantic).
  return (
    <span
      title={syncStatus === 'LOCAL_ONLY' ? 'Saved on this device' : 'Waiting to sync'}
      aria-label="Waiting to sync"
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: 'var(--warning)' }}
    />
  );
}

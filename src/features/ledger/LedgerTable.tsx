/**
 * THE DAILY LEDGER TABLE - the centerpiece surface (16 section 7).
 *
 *  - sticky header row
 *  - pinned Sr Number + Customer Name group on horizontal scroll
 *  - large custom checkboxes, compact note affordance
 *  - calm Incomplete / Ready / Completed row language (left stripe + dot)
 *  - Tab / Enter / arrow keyboard grid with auto-focus on new rows
 *  - row actions always visible on touch (never hover-only, 18 s4)
 *
 * All edits go through ledger-repo -> Dexie -> sync queue. No write on this
 * screen ever blocks on the network.
 */
import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/format';
import type { ColumnDefinition, LocalTransaction } from '../../../shared/types';
import { Checkbox } from '../../components/ui/primitives';
import {
  MoneyCell,
  NoteButton,
  RowSyncIndicator,
  StatusStripe,
  TextCell,
  statusLabel,
  type CellCoords,
} from './cells';

export interface LedgerTableProps {
  rows: LocalTransaction[];
  customColumns: ColumnDefinition[];
  readOnly?: boolean;
  onEdit: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onOpenNote: (row: LocalTransaction, anchor: HTMLElement) => void;
  onOpenCustomer: (row: LocalTransaction, anchor: HTMLElement) => void;
  onAddRow: () => void;
}

function toNumber(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Column widths - pinned group sizing must match the sticky offsets. */
const W_SR = 56;
const W_NAME = 168;

export const LedgerTable = memo(function LedgerTable({
  rows,
  customColumns,
  readOnly,
  onEdit,
  onDelete,
  onOpenNote,
  onOpenCustomer,
  onAddRow,
}: LedgerTableProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrolledX, setScrolledX] = useState(false);

  /**
   * Keyboard grid. Enter moves down the same column (fast vertical entry of
   * one field across rows); Tab keeps native left-to-right order. On the
   * last row, Enter adds a new row and focuses it (16 s7 / 06 s4).
   */
  const focusCell = useCallback((row: number, col: number) => {
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-cell="${row}-${col}"]`);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
    return false;
  }, []);

  const onKeyGrid = useCallback(
    (e: KeyboardEvent<HTMLElement>, { row, col }: CellCoords) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!focusCell(row + 1, col)) {
          onAddRow();
          // Wait for the new row to render before focusing it.
          window.setTimeout(() => focusCell(row + 1, col), 60);
        }
        return;
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        focusCell(row - 1, col);
        return;
      }
      if (e.key === 'ArrowDown' && !e.altKey) {
        e.preventDefault();
        focusCell(row + 1, col);
        return;
      }
      if (e.key === 'ArrowUp' && !e.altKey) {
        e.preventDefault();
        focusCell(row - 1, col);
      }
    },
    [focusCell, onAddRow],
  );

  const columns = useMemo(() => customColumns.filter((c) => c.isActive), [customColumns]);

  // Column index map for the keyboard grid (only focusable editors count).
  const colIndex = { name: 0, inr: 1, usdt: 2, rub: 3, extras: 4 };
  const customColStart = 5;

  return (
    <div className="card overflow-hidden">
      <div
        ref={scrollerRef}
        onScroll={(e) => setScrolledX(e.currentTarget.scrollLeft > 2)}
        className="overflow-x-auto overflow-y-visible overscroll-x-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <table className="w-full border-collapse" style={{ minWidth: 880 }}>
          <colgroup>
            <col style={{ width: W_SR }} />
            <col style={{ width: W_NAME }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 86 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 92 }} />
            {columns.map((c) => (
              <col key={c.id} style={{ width: 120 }} />
            ))}
            <col style={{ width: 92 }} />
          </colgroup>

          <thead>
            <tr className="sticky top-0 z-30">
              <Th className={cn('sticky left-0 z-40 text-center', scrolledX && 'shadow-pin')} style={{ width: W_SR }}>
                Sr
              </Th>
              <Th
                className={cn('sticky z-40 text-left', scrolledX && 'shadow-pin')}
                style={{ left: W_SR, width: W_NAME }}
              >
                Customer Name
              </Th>
              <Th className="text-right">INR</Th>
              <Th className="text-center">Received</Th>
              <Th className="text-right">USDT</Th>
              <Th className="text-right">Final RUB</Th>
              <Th className="text-right">Extras</Th>
              <Th className="text-center">Order Done</Th>
              {columns.map((c) => (
                <Th
                  key={c.id}
                  className={
                    c.type === 'NUMBER' || c.type === 'CURRENCY'
                      ? 'text-right'
                      : c.type === 'CHECKBOX'
                        ? 'text-center'
                        : 'text-left'
                  }
                >
                  {c.label}
                </Th>
              ))}
              <Th className="text-center">Note</Th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, i) => (
              <LedgerRow
                key={row.id}
                row={row}
                index={i}
                columns={columns}
                readOnly={readOnly}
                scrolledX={scrolledX}
                colIndex={colIndex}
                customColStart={customColStart}
                onEdit={onEdit}
                onDelete={onDelete}
                onOpenNote={onOpenNote}
                onOpenCustomer={onOpenCustomer}
                onKeyGrid={onKeyGrid}
              />
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .shadow-pin::after {
          content: '';
          position: absolute;
          top: 0; right: 0; bottom: 0;
          width: 10px;
          transform: translateX(100%);
          pointer-events: none;
          background: linear-gradient(to right, rgba(0,0,0,0.13), transparent);
        }
      `}</style>
    </div>
  );
});

function Th({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <th
      scope="col"
      style={style}
      className={cn(
        'relative bg-[var(--surface-2)] border-b border-[var(--border)]',
        'px-2.5 py-3 text-[11px] font-bold uppercase tracking-[0.07em]',
        'text-[var(--text-3)] whitespace-nowrap select-none',
        className,
      )}
    >
      {children}
    </th>
  );
}

interface LedgerRowProps {
  row: LocalTransaction;
  index: number;
  columns: ColumnDefinition[];
  readOnly?: boolean;
  scrolledX: boolean;
  colIndex: Record<string, number>;
  customColStart: number;
  onEdit: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onOpenNote: (row: LocalTransaction, anchor: HTMLElement) => void;
  onOpenCustomer: (row: LocalTransaction, anchor: HTMLElement) => void;
  onKeyGrid: (e: KeyboardEvent<HTMLElement>, coords: CellCoords) => void;
}

const LedgerRow = memo(function LedgerRow({
  row,
  index,
  columns,
  readOnly,
  scrolledX,
  colIndex,
  customColStart,
  onEdit,
  onDelete,
  onOpenNote,
  onOpenCustomer,
  onKeyGrid,
}: LedgerRowProps) {
  const noteRef = useRef<HTMLButtonElement>(null);
  const nameCellRef = useRef<HTMLDivElement>(null);

  const onEditCustom = useCallback(
    (r: LocalTransaction, key: string, value: string | null) => {
      onEdit(r.id, { customValues: { ...(r.customValues ?? {}), [key]: value } });
    },
    [onEdit],
  );

  const stripeBg =
    row.status === 'COMPLETED'
      ? 'var(--success-soft)'
      : row.status === 'READY'
        ? 'var(--warning-soft)'
        : 'transparent';

  // Completed rows get a whisper of the success tint; nothing loud.
  const rowBg =
    row.status === 'COMPLETED'
      ? `color-mix(in srgb, ${stripeBg} 38%, var(--surface-1))`
      : index % 2 === 1
        ? 'var(--table-stripe)'
        : 'var(--surface-1)';

  return (
    <tr
      className="ledger-row group border-b border-[var(--border)] last:border-b-0"
      style={{ '--row-bg': rowBg } as React.CSSProperties}
      data-status={row.status}
    >
      {/* Pinned: Sr Number */}
      <td
        className={cn('sticky left-0 z-20 text-center align-middle px-1 py-1.5', scrolledX && 'shadow-pin')}
      >
        <StatusStripe status={row.status} />
        <div className="flex items-center justify-center gap-1.5 px-1">
          <span className="num text-[12.5px] font-semibold text-[var(--text-3)] tabular-nums">{row.srNumber}</span>
          <RowSyncIndicator syncStatus={row.syncStatus} error={row.lastSyncError} />
        </div>
      </td>

      {/* Pinned: Customer Name */}
      <td
        ref={nameCellRef as never}
        className={cn('sticky z-20 align-middle px-1.5 py-1.5', scrolledX && 'shadow-pin')}
        style={{ left: W_SR }}
      >
        <div className="relative flex items-center w-full">
          <TextCell
            value={row.customerNameSnapshot}
            onCommit={(v) => onEdit(row.id, { customerNameSnapshot: v })}
            coords={{ row: index, col: colIndex.name }}
            disabled={readOnly}
            onKeyGrid={onKeyGrid}
            placeholder="Customer Name"
            maxLength={120}
            onFocusCapture={() => {
              if (nameCellRef.current) onOpenCustomer(row, nameCellRef.current);
            }}
          />
          {row.customerId && (
            <span
              title="Linked customer"
              aria-label="Linked customer"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full pointer-events-none"
              style={{ background: 'var(--accent)' }}
            />
          )}
        </div>
      </td>

      <td className="align-middle px-1.5 py-1.5">
        <MoneyCell
          value={row.inrAmount}
          onCommit={(v) => onEdit(row.id, { inrAmount: v })}
          coords={{ row: index, col: colIndex.inr }}
          disabled={readOnly}
          onKeyGrid={onKeyGrid}
        />
      </td>

      <td className="align-middle text-center px-1 py-1.5">
        <div className="grid place-items-center">
          <Checkbox
            checked={row.inrReceived}
            onChange={(v) => onEdit(row.id, { inrReceived: v })}
            disabled={readOnly}
            label={`INR received for row ${row.srNumber}`}
          />
        </div>
      </td>

      <td className="align-middle px-1.5 py-1.5">
        <MoneyCell
          value={row.usdtAmount}
          onCommit={(v) => onEdit(row.id, { usdtAmount: v })}
          coords={{ row: index, col: colIndex.usdt }}
          disabled={readOnly}
          onKeyGrid={onKeyGrid}
        />
      </td>

      <td className="align-middle px-1.5 py-1.5">
        <MoneyCell
          value={row.finalRubAmount}
          onCommit={(v) => onEdit(row.id, { finalRubAmount: v })}
          coords={{ row: index, col: colIndex.rub }}
          disabled={readOnly}
          onKeyGrid={onKeyGrid}
        />
      </td>

      <td className="align-middle px-1.5 py-1.5">
        <MoneyCell
          value={row.extrasAmount}
          onCommit={(v) => onEdit(row.id, { extrasAmount: v })}
          coords={{ row: index, col: colIndex.extras }}
          disabled={readOnly}
          onKeyGrid={onKeyGrid}
        />
      </td>

      <td className="align-middle text-center px-1 py-1.5">
        <div className="grid place-items-center">
          <Checkbox
            tone="success"
            checked={row.orderDone}
            onChange={(v) => onEdit(row.id, { orderDone: v })}
            disabled={readOnly}
            label={`Order done for row ${row.srNumber}`}
          />
        </div>
      </td>

      {columns.map((c, ci) => (
        <td key={c.id} className="align-middle px-1.5 py-1.5">
          {/* custom_values are stored as TEXT in D1 (03 s9), so every
              editor serialises back to a string or null. */}
          {c.type === 'CHECKBOX' ? (
            <div className="grid place-items-center">
              <Checkbox
                checked={row.customValues?.[c.key] === '1'}
                onChange={(v) => onEditCustom(row, c.key, v ? '1' : null)}
                disabled={readOnly}
                label={c.label}
              />
            </div>
          ) : c.type === 'NUMBER' || c.type === 'CURRENCY' ? (
            <MoneyCell
              value={toNumber(row.customValues?.[c.key])}
              onCommit={(v) => onEditCustom(row, c.key, v === null ? null : String(v))}
              coords={{ row: index, col: customColStart + ci }}
              disabled={readOnly}
              onKeyGrid={onKeyGrid}
            />
          ) : (
            <TextCell
              value={row.customValues?.[c.key] ?? null}
              onCommit={(v) => onEditCustom(row, c.key, v)}
              coords={{ row: index, col: customColStart + ci }}
              disabled={readOnly}
              onKeyGrid={onKeyGrid}
              maxLength={c.type === 'LONG_TEXT' ? 500 : 200}
            />
          )}
        </td>
      ))}

      {/* Note + delete. Always visible on touch (18 s4.1). */}
      <td className="align-middle px-1.5 py-1.5">
        <div className="flex items-center justify-center gap-1">
          <NoteButton
            buttonRef={noteRef}
            hasNote={Boolean(row.note && row.note.trim())}
            onClick={() => noteRef.current && onOpenNote(row, noteRef.current)}
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onDelete(row.id)}
              aria-label={`Delete row ${row.srNumber}`}
              title="Delete row"
              className={cn(
                'inline-grid place-items-center h-9 w-9 rounded-md shrink-0 border border-transparent',
                'text-[var(--text-3)] transition-all duration-150',
                'hover:text-[var(--danger)] hover:bg-[var(--danger-soft)] hover:border-[var(--danger)]',
                // Visible by default on touch; softened until hover on
                // pointer devices so the table stays calm.
                'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
              )}
            >
              <svg viewBox="0 0 24 24" className="h-[16px] w-[16px]" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4.5A.5.5 0 019.5 4h5a.5.5 0 01.5.5V7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

/** Screen-reader friendly status summary used by the row detail sheet. */
export function rowStatusText(row: LocalTransaction): string {
  const parts = [statusLabel(row.status)];
  if (row.inrAmount !== null) parts.push(`INR ${formatMoney(row.inrAmount, 'INR')}`);
  if (row.usdtAmount !== null) parts.push(`USDT ${formatMoney(row.usdtAmount, 'USDT')}`);
  return parts.join(' · ');
}

/**
 * The daily totals bar (07 section 5, 16 section 7.3).
 *
 * Explicitly NOT a repeated table row: an elevated, sticky financial summary
 * with clear label/value hierarchy. Includes PENDING_SYNC and LOCAL_ONLY
 * rows, so the number on screen always matches what the user has entered
 * even while offline.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { formatMoney, formatNumber } from '../../lib/format';
import { StatusBadge } from '../../components/ui/shell-primitives';
import { IcCheckCircle, IcClock } from '../../components/ui/icons';
import type { DayTotals } from '../../../shared/types';

/** One tasteful count-up on first mount only (16 s5). */
function useCountUp(value: number, enabled: boolean): number {
  const [display, setDisplay] = useState(enabled ? 0 : value);
  const done = useRef(false);
  const raf = useRef<number>();

  useEffect(() => {
    if (!enabled || done.current) {
      setDisplay(value);
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      done.current = true;
      return;
    }
    const from = 0;
    const start = performance.now();
    const duration = 520;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic - decelerating, no overshoot.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else done.current = true;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (done.current) setDisplay(value);
  }, [value]);

  return display;
}

function TotalFigure({
  label,
  value,
  currency,
  animate,
  emphasis,
}: {
  label: string;
  value: number;
  currency: 'INR' | 'USDT' | 'RUB' | 'EXTRAS';
  animate: boolean;
  emphasis?: boolean;
}) {
  const shown = useCountUp(value, animate);
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] leading-none">
        {label}
      </p>
      <p
        className={cn(
          'num mt-1.5 leading-none truncate',
          emphasis
            ? 'text-[19px] sm:text-[21px] font-semibold text-[var(--text-1)]'
            : 'text-[16px] sm:text-[17px] font-medium text-[var(--text-1)]',
        )}
        title={formatMoney(value, currency)}
      >
        {formatMoney(shown, currency)}
      </p>
    </div>
  );
}

export const TotalsBar = memo(function TotalsBar({
  totals,
  className,
  pendingSync,
}: {
  totals: DayTotals;
  className?: string;
  pendingSync?: number;
}) {
  const [animate] = useState(true);
  const pct =
    totals.rowCount > 0 ? Math.round((totals.completedCount / totals.rowCount) * 100) : 0;

  return (
    <div
      className={cn(
        // Glass is used here deliberately and sparingly (16 s3): the bar
        // floats over scrolling table content and must stay legible.
        // Accent-tinted summary strip (brief 4.7 / 16 s7.3): reads as the stat
        // cards compressed into one bar, never as a repeated table row.
        'elevated-glass shadow-e3 rounded-[var(--radius-lg)] px-3.5 sm:px-5 py-3.5 sm:py-4',
        'border-t-2 border-t-[var(--accent)] border-x border-b border-[var(--border-strong)]',
        className,
      )}
      role="status"
      aria-label="Daily totals"
    >
      <div className="flex items-end justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 sm:gap-x-8 gap-y-3 flex-1 min-w-0">
          <TotalFigure label="INR" value={totals.totalInr} currency="INR" animate={animate} emphasis />
          <TotalFigure label="USDT" value={totals.totalUsdt} currency="USDT" animate={animate} emphasis />
          <TotalFigure label="Final RUB" value={totals.totalRub} currency="RUB" animate={animate} />
          <TotalFigure label="Extras" value={totals.totalExtras} currency="EXTRAS" animate={animate} />
        </div>

        <div className="hidden md:flex flex-col items-end gap-2 shrink-0 pl-5 border-l border-[var(--border)]">
          <div className="flex items-center gap-1.5">
            <StatusBadge tone="success" icon={<IcCheckCircle size={12} />}>
              {formatNumber(totals.completedCount)} done
            </StatusBadge>
            {totals.pendingCount > 0 && (
              <StatusBadge tone="warning" icon={<IcClock size={12} />}>
                {formatNumber(totals.pendingCount)} pending
              </StatusBadge>
            )}
            <StatusBadge tone="neutral">{formatNumber(totals.rowCount)} total</StatusBadge>
          </div>
          <div className="h-1.5 w-28 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-standard"
              style={{ width: `${pct}%`, background: 'var(--success)' }}
            />
          </div>
        </div>
      </div>

      {/* Mobile completion + pending summary */}
      <div className="md:hidden mt-3 pt-2.5 border-t border-[var(--border)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-1 w-16 rounded-full bg-[var(--surface-3)] overflow-hidden shrink-0">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-standard"
              style={{ width: `${pct}%`, background: 'var(--success)' }}
            />
          </div>
          <StatusBadge tone="success" icon={<IcCheckCircle size={12} />}>
            {formatNumber(totals.completedCount)} / {formatNumber(totals.rowCount)}
          </StatusBadge>
        </div>
        {pendingSync ? (
          <StatusBadge tone="warning" icon={<IcClock size={12} />}>
            {pendingSync} unsynced
          </StatusBadge>
        ) : null}
      </div>
    </div>
  );
});

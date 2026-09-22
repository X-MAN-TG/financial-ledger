/**
 * Compact date selector for the ledger header. Uses the native date input
 * on touch devices (best mobile UX) with a styled trigger.
 */
import { useRef } from 'react';
import { formatDateMedium } from '../../lib/format';

export function DatePicker({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (next: string) => void;
  max?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          // showPicker() where supported; falls back to focusing the input.
          const el = ref.current;
          if (!el) return;
          if ('showPicker' in el && typeof el.showPicker === 'function') {
            try {
              el.showPicker();
              return;
            } catch {
              /* fall through */
            }
          }
          el.focus();
          el.click();
        }}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--surface-1)] text-[13px] font-medium text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors whitespace-nowrap"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-[var(--text-3)]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M8 3v3M16 3v3M3.5 9h17M5 6h14a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-11A1.5 1.5 0 015 6z" />
        </svg>
        {formatDateMedium(value)}
      </button>
      <input
        ref={ref}
        type="date"
        value={value}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label="Select ledger date"
        className="absolute inset-0 opacity-0 pointer-events-none"
        tabIndex={-1}
      />
    </div>
  );
}

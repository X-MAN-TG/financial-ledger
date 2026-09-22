/**
 * Inline customer autocomplete (08-customer-system.txt section 3).
 *
 * Search runs against the local Dexie cache so it works offline and feels
 * instant. Linking fills customer_id AND the name snapshot; the snapshot is
 * historical and is never rewritten by a later rename (08 s4).
 */
import { useEffect, useMemo, useState } from 'react';
import type { LocalCustomer, LocalTransaction } from '../../../shared/types';
import { cn } from '../../lib/cn';
import { useSession } from '../../hooks/use-session';
import { Popover } from '../../components/ui/overlays';
import { createCustomerLocal, searchCustomersLocal } from '../../offline/ledger-repo';

export function CustomerPicker({
  state,
  onClose,
  onPick,
}: {
  state: { row: LocalTransaction; anchor: HTMLElement } | null;
  onClose: () => void;
  onPick: (customer: LocalCustomer) => void;
}) {
  const { db, user } = useSession();
  const [results, setResults] = useState<LocalCustomer[]>([]);
  const query = state?.row.customerNameSnapshot ?? '';

  useEffect(() => {
    if (!db || !state) {
      setResults([]);
      return;
    }
    let cancelled = false;
    void searchCustomersLocal(db, query, 6).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [db, state, query]);

  const anchorRef = useMemo(
    () => ({ current: state?.anchor ?? null }) as React.RefObject<HTMLElement>,
    [state],
  );

  const exactMatch = results.some(
    (r) => r.name.toLowerCase() === query.trim().toLowerCase(),
  );
  const canCreate = query.trim().length >= 2 && !exactMatch;

  if (!state) return null;

  return (
    <Popover open onClose={onClose} anchorRef={anchorRef} align="start" width={280}>
      {results.length === 0 && !canCreate ? (
        <p className="text-[12.5px] text-[var(--text-3)] px-1 py-2">
          {query.trim() ? 'No matching customers' : 'Start typing to search customers'}
        </p>
      ) : (
        <div className="space-y-0.5 max-h-[248px] overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c)}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left',
                'hover:bg-[var(--surface-2)] transition-colors',
                state.row.customerId === c.id && 'bg-[var(--accent-soft)]',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-[var(--text-1)] truncate">{c.name}</span>
                {c.phone && (
                  <span className="block text-[11.5px] text-[var(--text-3)] truncate">{c.phone}</span>
                )}
              </span>
              {state.row.customerId === c.id && (
                <span className="text-[10.5px] font-semibold text-[var(--accent)] shrink-0">
                  LINKED
                </span>
              )}
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!db || !user) return;
                void createCustomerLocal(db, user.id, { name: query.trim() }).then(onPick);
              }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-[13px] text-[var(--accent)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="truncate">Create “{query.trim()}”</span>
            </button>
          )}
        </div>
      )}
      <p className="mt-2 pt-2 border-t border-[var(--border)] text-[11px] text-[var(--text-3)] px-1">
        Linking keeps a historical name snapshot on this row.
      </p>
    </Popover>
  );
}

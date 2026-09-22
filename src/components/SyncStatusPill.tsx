/**
 * Persistent sync/offline indicator (16 s6: Offline, Saving, Syncing,
 * Synced, Sync Failed are first-class designed states).
 *
 * Deliberately quiet: a small pill that only becomes colourful when
 * something needs attention. Never a modal, never a blocking banner.
 */
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';
import { getSyncEngine, type SyncState } from '../offline/sync-engine';
import { retryAllFailed } from '../offline/queue';
import { useSession } from '../hooks/use-session';
import { useToast } from './ui/overlays';

export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(
    () =>
      getSyncEngine()?.getState() ?? {
        phase: 'IDLE',
        pending: 0,
        failed: 0,
        lastSyncAt: null,
        lastError: null,
        conflicts: [],
      },
  );

  useEffect(() => {
    // The engine is created after the session resolves, so poll briefly
    // until it exists, then subscribe.
    let unsub: (() => void) | undefined;
    const attach = () => {
      const engine = getSyncEngine();
      if (engine) {
        unsub = engine.subscribe(setState);
        return true;
      }
      return false;
    };
    if (!attach()) {
      const t = window.setInterval(() => {
        if (attach()) window.clearInterval(t);
      }, 400);
      return () => {
        window.clearInterval(t);
        unsub?.();
      };
    }
    return () => unsub?.();
  }, []);

  return state;
}

export function SyncStatusPill({ compact }: { compact?: boolean }) {
  const state = useSyncState();
  const { db } = useSession();
  const { toast } = useToast();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const offline = !online || state.phase === 'OFFLINE';
  const failed = state.failed > 0;
  const syncing = state.phase === 'SYNCING' || (state.pending > 0 && online);

  const tone = offline ? 'warning' : failed ? 'danger' : syncing ? 'info' : 'success';
  const label = offline
    ? compact ? 'Offline' : `Offline · ${state.pending} queued`
    : failed
      ? compact ? 'Retry' : `${state.failed} failed`
      : syncing
        ? compact ? 'Syncing' : `Syncing ${state.pending}`
        : compact
          ? 'Synced'
          : // "Synced never" reads as a glitch; say what is actually true.
            state.lastSyncAt
            ? `Synced ${formatRelative(state.lastSyncAt)}`
            : state.pending > 0
              ? 'Not yet synced'
              : 'Up to date';

  const color =
    tone === 'warning'
      ? 'var(--warning)'
      : tone === 'danger'
        ? 'var(--danger)'
        : tone === 'info'
          ? 'var(--info)'
          : 'var(--success)';
  const bg =
    tone === 'warning'
      ? 'var(--warning-soft)'
      : tone === 'danger'
        ? 'var(--danger-soft)'
        : tone === 'info'
          ? 'var(--info-soft)'
          : 'var(--success-soft)';

  const onRetry = async () => {
    if (!db) return;
    const n = await retryAllFailed(db);
    void getSyncEngine()?.flush();
    toast({ title: n > 0 ? `Retrying ${n} change${n === 1 ? '' : 's'}` : 'Nothing to retry', tone: 'info' });
  };

  return (
    <button
      type="button"
      onClick={failed ? onRetry : () => void getSyncEngine()?.flush()}
      title={state.lastError ?? label}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-transparent',
        'transition-colors duration-200 font-medium whitespace-nowrap',
        compact ? 'h-7 px-2.5 text-[11.5px]' : 'w-full h-8 px-3 text-[12px] justify-start',
      )}
      style={{ background: bg, color }}
    >
      {syncing && !offline ? (
        <span
          aria-hidden
          className="animate-spin-slow h-2.5 w-2.5 rounded-full border-2 border-current border-r-transparent"
        />
      ) : (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      )}
      {label}
    </button>
  );
}

/**
 * Full-width offline notice for the ledger screen. Calm and informative:
 * offline is a supported mode, not an error (13 s1).
 */
export function OfflineBanner() {
  const state = useSyncState();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online && state.phase !== 'OFFLINE') return null;

  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 mb-3 no-print"
      style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
      role="status"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 18.5v.01M5 12.8a10 10 0 0114 0M2 9.3a15 15 0 0120 0M8.5 16.2a5.5 5.5 0 017 0" />
      </svg>
      <p className="text-[12.5px] leading-snug">
        <span className="font-semibold">Working offline.</span> Your entries are saved on this
        device and will sync automatically when you reconnect
        {state.pending > 0 ? ` (${state.pending} waiting)` : ''}.
      </p>
    </div>
  );
}

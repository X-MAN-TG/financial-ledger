/**
 * Session + offline-runtime provider.
 *
 * Owns: the signed-in user, the per-user Dexie handle, the sync engine
 * lifecycle, and the active theme. Everything downstream reads from here.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SessionUser } from '../../shared/types';
import { ApiError, apiGet, apiPatch, apiPost } from '../lib/api';
import {
  applyTheme,
  getStoredTheme,
  isThemeId,
  systemPreferredTheme,
  type ThemeId,
} from '../lib/theme';
import { closeDb, getDb, type LedgerDexie } from '../offline/db';
import { disposeSyncEngine, initSyncEngine } from '../offline/sync-engine';

interface SessionContextValue {
  user: SessionUser | null;
  db: LedgerDexie | null;
  loading: boolean;
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: SessionUser | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Cached session snapshot (13 s8 / 01 s6).
 *
 * On a cold start with no network, GET /api/auth/session cannot answer, so
 * without this the app would bounce a signed-in user to /login and strand the
 * offline writes sitting in Dexie. We therefore remember just enough of the
 * last known-good session to rehydrate the shell; the server still re-validates
 * on the next successful request, and a real 401 clears it immediately.
 *
 * This is NOT an auth token - it grants nothing. The httpOnly session cookie
 * remains the only credential.
 */
const CACHED_SESSION_KEY = 'ledger.session.cache';

function readCachedSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(CACHED_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    return parsed && typeof parsed.id === 'string' && typeof parsed.role === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedSession(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(CACHED_SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_SESSION_KEY);
  } catch {
    /* private mode / quota - the app still works, just not offline-resumable */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => readCachedSession());
  const [db, setDb] = useState<LedgerDexie | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<ThemeId>(() => getStoredTheme() ?? systemPreferredTheme());

  const setTheme = useCallback(
    (t: ThemeId) => {
      setThemeState(t);
      applyTheme(t);
      // Best-effort server mirror; the local setting already took effect.
      if (user?.role === 'USER') {
        void apiPatch('/api/profile/settings', { theme: t }).catch(() => undefined);
      }
    },
    [user],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<{ user: SessionUser }>('/api/auth/session');
      setUser(res.user);
      writeCachedSession(res.user);
      // Server theme wins only when this device has no explicit choice.
      if (!getStoredTheme() && res.user.role === 'USER') {
        try {
          const prof = await apiGet<{ settings?: { theme?: string } }>('/api/profile');
          if (isThemeId(prof.settings?.theme)) {
            setThemeState(prof.settings.theme);
            applyTheme(prof.settings.theme);
          }
        } catch {
          /* non-fatal */
        }
      }
    } catch (e) {
      // A network failure must NOT sign the user out: an offline reload
      // keeps the cached session so the ledger stays usable (13 s8).
      // Only an explicit 401 means "not signed in". A transport failure
      // (status 0) must leave the cached session in place.
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        writeCachedSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      /* ignore - clear locally regardless */
    }
    disposeSyncEngine();
    closeDb();
    setDb(null);
    setUser(null);
    writeCachedSession(null);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open Dexie + start syncing once a USER session exists. The owner has no
  // ledger data of their own, so no offline DB is created for that role.
  useEffect(() => {
    if (!user || user.role !== 'USER') {
      disposeSyncEngine();
      return;
    }
    const handle = getDb(user.id);
    setDb(handle);
    initSyncEngine(handle);
    return () => {
      disposeSyncEngine();
    };
  }, [user]);

  const setUserCached = useCallback((u: SessionUser | null) => {
    setUser(u);
    writeCachedSession(u);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ user, db, loading, theme, setTheme, refresh, signOut, setUser: setUserCached }),
    [user, db, loading, theme, setTheme, refresh, signOut, setUserCached],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** Convenience for screens that cannot render without a Dexie handle. */
export function useLedgerDb(): LedgerDexie {
  const { db } = useSession();
  if (!db) throw new Error('Ledger database is not ready');
  return db;
}

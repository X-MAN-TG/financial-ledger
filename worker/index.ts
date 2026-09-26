/**
 * Cloudflare Worker entry point.
 *
 * Middleware order per 02-architecture.txt section 3.3:
 *   parse session -> authenticate -> authorize (role) -> validate (Zod in
 *   the handlers) -> enforce ownership (in the service/ownership helpers).
 *
 * Non-/api requests fall through to the static SPA assets with an
 * index.html fallback for client-side routing (22 section 2.2).
 */
import type { Env } from './lib/config';
import { applySecurityHeaders, errorResponse, json, notFound } from './lib/http';
import {
  enforceCsrf,
  requireOwner,
  requireSession,
  requireUser,
  touchSession,
  type SessionContext,
} from './middleware/auth';
import {
  handleGoogleCallback,
  handleGoogleStart,
  handleLogin,
  handleLogout,
  handleOwnerBootstrap,
  handleOwnerLogin,
  handleSessionInfo,
  handleSignup,
} from './routes/auth';
import { getProfile, patchProfile, patchSettings, putAvatar } from './routes/profile';
import { getLedgerDay, listLedgerDays, reopenDay, setDayOff, updateLedgerDay } from './routes/ledger';
import {
  createTransaction,
  deleteTransaction,
  listTrash,
  purgeTransactionRoute,
  reorderTransactions,
  restoreTransaction,
  updateTransaction,
} from './routes/transactions';
import { syncBatch, syncStatus } from './routes/sync';
import {
  createCustomer,
  customerSummary,
  customerTransactions,
  deleteCustomer,
  getCustomer,
  listCustomers,
  patchCustomer,
} from './routes/customers';
import { getTimeline, getTimelineDayTransactions } from './routes/timeline';
import {
  analytics30d,
  analytics7d,
  analyticsAllTime,
  analyticsMonthly,
  analyticsToday,
} from './routes/analytics';
import { getMyAudit } from './routes/audit';
import {
  backupStatus,
  exportAll,
  exportDay,
  exportFull,
  importBackup,
  recordExport,
} from './routes/backup';
import {
  ownerAudit,
  ownerBackupHistory,
  ownerCreateColumn,
  ownerCreateUser,
  ownerDeleteColumn,
  ownerDeleteUser,
  ownerHealth,
  ownerListColumns,
  ownerListUsers,
  ownerStats,
  ownerTriggerBackup,
  ownerUpdateColumn,
  ownerUpdateUser,
} from './routes/owner';
import { queryAll, mapColumnDefinition } from './lib/db';
import { runR2Backup } from './lib/backup-job';
import { purgeOldRateLimits } from './lib/ratelimit';

/** Match '/api/x/:p/y' style paths, returning captured segments. */
function match(pathname: string, pattern: string): string[] | null {
  const p = pathname.split('/').filter(Boolean);
  const q = pattern.split('/').filter(Boolean);
  if (p.length !== q.length) return null;
  const params: string[] = [];
  for (let i = 0; i < q.length; i++) {
    if (q[i] === ':p') {
      params.push(decodeURIComponent(p[i]));
    } else if (q[i] !== p[i]) {
      return null;
    }
  }
  return params;
}

async function routeApi(req: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = req.method.toUpperCase();

  /* ----------------------------------------------------------- public ---- */

  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, time: Date.now() });
  }
  if (pathname === '/api/auth/signup' && method === 'POST') return handleSignup(req, env, url);
  if (pathname === '/api/auth/login' && method === 'POST') return handleLogin(req, env, url);
  if (pathname === '/api/auth/logout' && method === 'POST') return handleLogout(req, env, url);
  if (pathname === '/api/auth/session' && method === 'GET') return handleSessionInfo(req, env);
  if (pathname === '/api/auth/google/start' && method === 'GET') {
    return handleGoogleStart(req, env, url);
  }
  if (pathname === '/api/auth/google/callback' && method === 'GET') {
    return handleGoogleCallback(req, env, url);
  }
  if (pathname === '/api/owner/login' && method === 'POST') return handleOwnerLogin(req, env, url);
  if (pathname === '/api/owner/bootstrap' && method === 'POST') {
    return handleOwnerBootstrap(req, env);
  }

  /* ------------------------------------------------------ owner group ---- */

  if (pathname.startsWith('/api/owner/')) {
    const session = await requireOwner(req, env);
    enforceCsrf(req, session);
    await touchSession(env, session);

    if (pathname === '/api/owner/users' && method === 'GET') return ownerListUsers(env);
    if (pathname === '/api/owner/users' && method === 'POST') {
      return ownerCreateUser(req, env, session);
    }
    let m = match(pathname, '/api/owner/users/:p');
    if (m && method === 'PATCH') return ownerUpdateUser(req, env, session, m[0]);
    if (m && method === 'DELETE') return ownerDeleteUser(env, session, m[0], url);

    if (pathname === '/api/owner/health' && method === 'GET') {
      return ownerHealth(env, session, false);
    }
    if (pathname === '/api/owner/health/ping' && method === 'POST') {
      return ownerHealth(env, session, true);
    }
    if (pathname === '/api/owner/stats' && method === 'GET') return ownerStats(env);

    if (pathname === '/api/owner/columns' && method === 'GET') return ownerListColumns(env);
    if (pathname === '/api/owner/columns' && method === 'POST') {
      return ownerCreateColumn(req, env, session);
    }
    m = match(pathname, '/api/owner/columns/:p');
    if (m && method === 'PATCH') return ownerUpdateColumn(req, env, session, m[0]);
    if (m && method === 'DELETE') return ownerDeleteColumn(env, session, m[0], url);

    if (pathname === '/api/owner/audit' && method === 'GET') return ownerAudit(env, url);
    if (pathname === '/api/owner/backup/trigger' && method === 'POST') {
      return ownerTriggerBackup(env, session);
    }
    if (pathname === '/api/owner/backup/history' && method === 'GET') {
      return ownerBackupHistory(env, url);
    }
    throw notFound('Unknown endpoint');
  }

  /* ------------------------------------------------------- user group ---- */

  if (pathname.startsWith('/api/')) {
    const session: SessionContext = await requireUser(req, env);
    enforceCsrf(req, session);
    await touchSession(env, session);

    // Column definitions are read-only for users; they drive the extra
    // ledger cells rendered to the right of the standard 9 (07 section 1).
    if (pathname === '/api/columns' && method === 'GET') {
      const rows = await queryAll<Record<string, unknown>>(
        env,
        'SELECT * FROM column_definitions WHERE is_active = 1 ORDER BY position ASC',
      );
      return json({ items: rows.map(mapColumnDefinition) });
    }

    if (pathname === '/api/profile' && method === 'GET') return getProfile(env, session);
    if (pathname === '/api/profile' && method === 'PATCH') return patchProfile(req, env, session);
    if (pathname === '/api/profile/avatar' && method === 'POST') return putAvatar(req, env, session);
    if (pathname === '/api/profile/settings' && method === 'PATCH') {
      return patchSettings(req, env, session);
    }

    if (pathname === '/api/ledger-days' && method === 'GET') {
      return listLedgerDays(env, session, url);
    }
    let m = match(pathname, '/api/ledger-days/:p');
    if (m && method === 'GET') return getLedgerDay(env, session, m[0]);
    if (m && method === 'PATCH') return updateLedgerDay(req, env, session, m[0]);
    m = match(pathname, '/api/ledger-days/:p/day-off');
    if (m && method === 'POST') return setDayOff(env, session, m[0]);
    m = match(pathname, '/api/ledger-days/:p/reopen');
    if (m && method === 'POST') return reopenDay(env, session, m[0]);

    if (pathname === '/api/transactions' && method === 'POST') {
      return createTransaction(req, env, session);
    }
    if (pathname === '/api/transactions/trash' && method === 'GET') {
      return listTrash(env, session, url);
    }
    if (pathname === '/api/transactions/reorder' && method === 'POST') {
      return reorderTransactions(req, env, session);
    }
    m = match(pathname, '/api/transactions/:p');
    if (m && method === 'PATCH') return updateTransaction(req, env, session, m[0]);
    if (m && method === 'DELETE') return deleteTransaction(req, env, session, m[0]);
    m = match(pathname, '/api/transactions/:p/restore');
    if (m && method === 'POST') return restoreTransaction(req, env, session, m[0]);
    m = match(pathname, '/api/transactions/:p/purge');
    if (m && method === 'DELETE') return purgeTransactionRoute(env, session, m[0]);

    if (pathname === '/api/sync/batch' && method === 'POST') return syncBatch(req, env, session);
    if (pathname === '/api/sync/status' && method === 'GET') return syncStatus(env, session);

    if (pathname === '/api/customers' && method === 'GET') return listCustomers(env, session, url);
    if (pathname === '/api/customers' && method === 'POST') return createCustomer(req, env, session);
    m = match(pathname, '/api/customers/:p');
    if (m && method === 'GET') return getCustomer(env, session, m[0]);
    if (m && method === 'PATCH') return patchCustomer(req, env, session, m[0]);
    if (m && method === 'DELETE') return deleteCustomer(env, session, m[0]);
    m = match(pathname, '/api/customers/:p/transactions');
    if (m && method === 'GET') return customerTransactions(env, session, m[0], url);
    m = match(pathname, '/api/customers/:p/summary');
    if (m && method === 'GET') return customerSummary(env, session, m[0]);

    if (pathname === '/api/timeline' && method === 'GET') return getTimeline(env, session, url);
    m = match(pathname, '/api/timeline/:p/transactions');
    if (m && method === 'GET') return getTimelineDayTransactions(env, session, m[0], url);

    if (pathname === '/api/analytics/today' && method === 'GET') {
      return analyticsToday(env, session, url);
    }
    if (pathname === '/api/analytics/7d' && method === 'GET') return analytics7d(env, session, url);
    if (pathname === '/api/analytics/30d' && method === 'GET') {
      return analytics30d(env, session, url);
    }
    if (pathname === '/api/analytics/monthly' && method === 'GET') {
      return analyticsMonthly(env, session, url);
    }
    if (pathname === '/api/analytics/all-time' && method === 'GET') {
      return analyticsAllTime(env, session);
    }

    if (pathname === '/api/audit/me' && method === 'GET') return getMyAudit(env, session, url);

    m = match(pathname, '/api/export/day/:p');
    if (m && method === 'GET') return exportDay(env, session, m[0]);
    if (pathname === '/api/export/full' && method === 'GET') return exportFull(env, session, url);
    if (pathname === '/api/export/all' && method === 'GET') return exportAll(env, session);
    if (pathname === '/api/backup/status' && method === 'GET') return backupStatus(env, session);
    if (pathname === '/api/backup/export' && method === 'POST') return recordExport(req, env, session);
    if (pathname === '/api/backup/import' && method === 'POST') return importBackup(req, env, session);

    throw notFound('Unknown endpoint');
  }

  throw notFound('Unknown endpoint');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await routeApi(req, env, url);
      } catch (e) {
        return errorResponse(e);
      }
    }

    // Static SPA assets with index.html fallback for client-side routes.
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(req);
      if (res.status === 404 && req.method === 'GET') {
        const indexReq = new Request(new URL('/index.html', url.origin), req);
        const index = await env.ASSETS.fetch(indexReq);
        return applySecurityHeaders(index);
      }
      return applySecurityHeaders(res);
    }

    return new Response('Not found', { status: 404 });
  },

  /** Cron trigger: scheduled R2 backup (22 section 5.1). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await runR2Backup(env, { actorId: null, actorRole: 'SYSTEM' });
        await purgeOldRateLimits(env);
      })(),
    );
  },
};

/**
 * Application shell (18 section 3 + brief 4.1).
 *   phone   -> top bar + thumb-reachable bottom navigation
 *   >=1024  -> persistent left sidebar with brand, grouped nav, trust card
 *
 * The sidebar is additive for large screens; the bottom bar remains the
 * primary mobile navigation and is never replaced by it.
 */
import { useMemo, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useSession } from '../hooks/use-session';
import { SyncStatusPill, useSyncState } from './SyncStatusPill';
import { ThemeMenu } from './ThemeMenu';
import { initials, formatRelative } from '../lib/format';
import { AvatarChip, Breadcrumbs, PageHeader } from './ui/shell-primitives';
import {
  IcAccount,
  IcAnalytics,
  IcAudit,
  IcCloud,
  IcColumns,
  IcCustomers,
  IcHome,
  IcLedger,
  IcShield,
  IcSystem,
  IcTimeline,
  IcUsers,
} from './ui/icons';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Hidden from the phone bottom bar, which is capped at five items (18 s3). */
  desktopOnly?: boolean;
}

const USER_NAV: NavItem[] = [
  { to: '/home', label: 'Dashboard', icon: <IcHome />, desktopOnly: true },
  { to: '/ledger', label: 'Ledger', icon: <IcLedger /> },
  { to: '/timeline', label: 'Timeline', icon: <IcTimeline /> },
  { to: '/analytics', label: 'Analytics', icon: <IcAnalytics /> },
  { to: '/customers', label: 'Customers', icon: <IcCustomers /> },
  { to: '/account', label: 'Account', icon: <IcAccount /> },
];

const OWNER_NAV: NavItem[] = [
  { to: '/owner', label: 'Overview', icon: <IcAnalytics /> },
  { to: '/owner/users', label: 'Users', icon: <IcUsers /> },
  { to: '/owner/columns', label: 'Columns', icon: <IcColumns /> },
  { to: '/owner/audit', label: 'Audit', icon: <IcAudit /> },
  { to: '/owner/system', label: 'System', icon: <IcSystem /> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const location = useLocation();
  const isOwner = user?.role === 'OWNER';
  const nav = useMemo(() => (isOwner ? OWNER_NAV : USER_NAV), [isOwner]);
  const bottomNav = useMemo(() => nav.filter((n) => !n.desktopOnly), [nav]);

  const title = useMemo(() => {
    const active = [...nav]
      .sort((a, b) => b.to.length - a.to.length)
      .find((n) => location.pathname === n.to || location.pathname.startsWith(`${n.to}/`));
    return active?.label ?? (isOwner ? 'Owner' : 'Ledger');
  }, [location.pathname, nav, isOwner]);

  return (
    <div className="min-h-full flex bg-[var(--surface-0)]">
      {/* ------------------------------------------------ desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-[244px] shrink-0 border-r border-[var(--border)] bg-[var(--sidebar-bg)] no-print">
        <div className="h-[var(--header-h)] flex items-center gap-2.5 px-5">
          <Mark />
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold text-[var(--text-1)] leading-none truncate">
              Ledger
            </p>
            <p
              className={cn(
                'text-[10px] uppercase tracking-[0.1em] mt-1 font-bold',
                isOwner ? 'text-[var(--warning)]' : 'text-[var(--text-3)]',
              )}
            >
              {isOwner ? 'Administrator' : 'Workspace'}
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 pt-2 space-y-0.5 overflow-y-auto" aria-label="Primary">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/owner'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 h-10 px-3 rounded-[10px] text-[13.5px] font-medium',
                  'transition-colors duration-150 no-underline',
                  isActive
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]',
                )
              }
            >
              <span className="shrink-0 w-5 h-5 flex items-center justify-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {!isOwner && <TrustCard />}

        <div className="p-3 pt-2 space-y-2">
          {!isOwner && <SyncStatusPill />}
          <div className="flex items-center gap-2.5 px-1 py-1">
            <AvatarChip name={user?.displayName} email={user?.email} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-[var(--text-1)] truncate leading-tight">
                {user?.displayName}
              </p>
              <p className="text-[11.5px] text-[var(--text-3)] truncate">{user?.email}</p>
            </div>
            <ThemeMenu />
          </div>
        </div>
      </aside>

      {/* -------------------------------------------------- main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-40 safe-top bg-[var(--surface-1)] border-b border-[var(--border)] no-print">
          <div className="h-[var(--header-h)] px-4 flex items-center gap-3">
            <Mark />
            <h1 className="text-[15px] font-semibold text-[var(--text-1)] flex-1 truncate">
              {title}
            </h1>
            {!isOwner && <SyncStatusPill compact />}
            <ThemeMenu />
          </div>
        </header>

        <main className="flex-1 min-w-0 pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>

        {/* ------------------------------------------ mobile bottom nav */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom bg-[var(--surface-1)] border-t border-[var(--border)] no-print"
          aria-label="Primary"
        >
          <div
            className="h-[var(--bottomnav-h)] grid"
            style={{ gridTemplateColumns: `repeat(${bottomNav.length}, 1fr)` }}
          >
            {bottomNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/owner'}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-1 transition-colors duration-150 no-underline',
                    isActive ? 'text-[var(--accent)]' : 'text-[var(--text-3)]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative w-5 h-5 flex items-center justify-center">
                      {item.icon}
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute -top-2 left-1/2 -translate-x-1/2 h-[2.5px] w-5 rounded-full"
                          style={{ background: 'var(--accent)' }}
                        />
                      )}
                    </span>
                    <span className="text-[10.5px] font-medium tracking-[0.01em]">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

/**
 * Sidebar trust/status callout (brief 4.1). Uses real sync state - never
 * invented reassurance copy.
 */
function TrustCard() {
  const sync = useSyncState();
  const pending = sync.pending + sync.failed;
  const healthy = pending === 0;

  return (
    <div className="px-3 pb-1">
      <div
        className="rounded-[var(--radius-md)] border p-3"
        style={{
          background: healthy ? 'var(--success-soft)' : 'var(--warning-soft)',
          borderColor: healthy ? 'var(--success)' : 'var(--warning)',
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: healthy ? 'var(--success)' : 'var(--warning)' }}>
            {healthy ? <IcShield size={16} /> : <IcCloud size={16} />}
          </span>
          <p
            className="text-[12px] font-semibold leading-none"
            style={{ color: healthy ? 'var(--success)' : 'var(--warning)' }}
          >
            {healthy ? 'Data is safe' : `${pending} change${pending === 1 ? '' : 's'} queued`}
          </p>
        </div>
        <p className="text-[11px] text-[var(--text-3)] mt-1.5 leading-snug">
          {healthy
            ? sync.lastSyncAt
              ? `Saved on this device and backed up ${formatRelative(sync.lastSyncAt)}.`
              : 'Saved on this device and synced when you are online.'
            : 'Saved on this device. They will upload automatically.'}
        </p>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <span
      aria-hidden
      className="grid place-items-center h-8 w-8 rounded-[9px] shrink-0"
      style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
    >
      <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        <path d="M5 19h14M7 15V8M12 15V5M17 15v-4" />
      </svg>
    </span>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-full shrink-0 font-semibold"
      style={{
        height: size,
        width: size,
        background: 'var(--surface-3)',
        color: 'var(--text-2)',
        fontSize: size * 0.36,
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/**
 * Standard page frame: breadcrumbs + header block + content (brief 4.1/4.2).
 * `title` is optional so a page can render its own bespoke header.
 */
export function Page({
  eyebrow,
  title,
  subtitle,
  actions,
  breadcrumbs,
  children,
  wide,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumbs?: Array<{ label: string; to?: string }>;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6 py-4 sm:py-6',
        wide ? 'max-w-[1400px]' : 'max-w-[1180px]',
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      {(title || actions) && (
        <PageHeader eyebrow={eyebrow} title={title ?? ''} subtitle={subtitle} actions={actions} />
      )}
      {children}
    </div>
  );
}

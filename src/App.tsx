/**
 * Routing + role separation (04 section 5).
 *
 * OWNER and USER have completely separate surfaces: a USER can never reach
 * /owner/*, and an OWNER is redirected away from the ledger app. Route
 * guards are a UX nicety only - the Worker enforces authorization on every
 * request regardless of what the client renders.
 */
import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui/primitives';
import { ToastProvider } from './components/ui/overlays';
import { SessionProvider, useSession } from './hooks/use-session';
import { HomePage } from './features/home/HomePage';
import { LedgerPage } from './features/ledger/LedgerPage';
import { LoginPage } from './features/auth/LoginPage';
import { SignupPage } from './features/auth/SignupPage';
import { OwnerLoginPage } from './features/auth/OwnerLoginPage';

// Route-level code splitting keeps the first paint small (19 s2).
const TimelinePage = lazy(() =>
  import('./features/timeline/TimelinePage').then((m) => ({
    default: m.TimelinePage,
  })),
);
const AnalyticsPage = lazy(() =>
  import('./features/analytics/AnalyticsPage').then((m) => ({
    default: m.AnalyticsPage,
  })),
);
const CustomersPage = lazy(() =>
  import('./features/customers/CustomersPage').then((m) => ({
    default: m.CustomersPage,
  })),
);
const AccountPage = lazy(() =>
  import('./features/account/AccountPage').then((m) => ({
    default: m.AccountPage,
  })),
);
const OwnerPanel = lazy(() =>
  import('./features/owner/OwnerPanel').then((m) => ({
    default: m.OwnerPanel,
  })),
);

/**
 * TanStack Query is used for SERVER-derived read models only (analytics,
 * customers, owner panel). Ledger rows deliberately do NOT go through it -
 * they are driven by Dexie live queries so they work offline (13 s4).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => {
        const status = (err as { status?: number })?.status ?? 0;
        if (status === 401 || status === 403 || status === 404) return false;
        return count < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="min-h-screen grid place-items-center bg-[var(--surface-0)]">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-6 w-6" />
        <p className="text-[13px] text-[var(--text-3)]">{label}</p>
      </div>
    </div>
  );
}

function RequireRole({ role, children }: { role: 'USER' | 'OWNER'; children: React.ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) {
    return (
      <Navigate
        to={role === 'OWNER' ? '/owner/login' : '/login'}
        state={{ from: location }}
        replace
      />
    );
  }
  if (user.role !== role) {
    // Wrong surface for this role - send them to their own home.
    return <Navigate to={user.role === 'OWNER' ? '/owner' : '/home'} replace />;
  }
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to={user.role === 'OWNER' ? '/owner' : '/home'} replace />;
  return <>{children}</>;
}

function UserArea({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole role="USER">
      <AppShell>
        <Suspense
          fallback={
            <div className="p-10 grid place-items-center">
              <Spinner />
            </div>
          }
        >
          {children}
        </Suspense>
      </AppShell>
    </RequireRole>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionProvider>
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicOnly>
                    <LoginPage />
                  </PublicOnly>
                }
              />
              <Route
                path="/signup"
                element={
                  <PublicOnly>
                    <SignupPage />
                  </PublicOnly>
                }
              />
              <Route
                path="/owner/login"
                element={
                  <PublicOnly>
                    <OwnerLoginPage />
                  </PublicOnly>
                }
              />

              <Route
                path="/home"
                element={
                  <UserArea>
                    <HomePage />
                  </UserArea>
                }
              />
              <Route
                path="/ledger"
                element={
                  <UserArea>
                    <LedgerPage />
                  </UserArea>
                }
              />
              <Route
                path="/timeline"
                element={
                  <UserArea>
                    <TimelinePage />
                  </UserArea>
                }
              />
              <Route
                path="/analytics"
                element={
                  <UserArea>
                    <AnalyticsPage />
                  </UserArea>
                }
              />
              <Route
                path="/customers"
                element={
                  <UserArea>
                    <CustomersPage />
                  </UserArea>
                }
              />
              <Route
                path="/customers/:id"
                element={
                  <UserArea>
                    <CustomersPage />
                  </UserArea>
                }
              />
              <Route
                path="/account/*"
                element={
                  <UserArea>
                    <AccountPage />
                  </UserArea>
                }
              />

              <Route
                path="/owner/*"
                element={
                  <RequireRole role="OWNER">
                    <AppShell>
                      <Suspense
                        fallback={
                          <div className="p-10 grid place-items-center">
                            <Spinner />
                          </div>
                        }
                      >
                        <OwnerPanel />
                      </Suspense>
                    </AppShell>
                  </RequireRole>
                }
              />

              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </SessionProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

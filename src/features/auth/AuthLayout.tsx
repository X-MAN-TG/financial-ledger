/**
 * Shared auth chrome. Restrained and typographic: no gradient blobs, no
 * glass, no glow (16 s2). A quiet private-tool feel.
 */
import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  badge,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  badge?: string;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--surface-0)]">
      <div className="flex-1 flex items-center justify-center px-4 py-10 safe-top">
        <div className="w-full max-w-[400px]">
          <div className="flex items-center gap-2.5 mb-7">
            <span
              aria-hidden
              className="grid place-items-center h-9 w-9 rounded-[10px] shrink-0"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                <path d="M5 19h14M7 15V8M12 15V5M17 15v-4" />
              </svg>
            </span>
            <div>
              <p className="text-[15px] font-semibold text-[var(--text-1)] leading-none">Ledger</p>
              {badge && (
                <p className="text-[10.5px] uppercase tracking-[0.09em] font-semibold text-[var(--accent)] mt-1">
                  {badge}
                </p>
              )}
            </div>
          </div>

          <h1 className="text-[22px] font-semibold text-[var(--text-1)] leading-tight">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 text-[13.5px] text-[var(--text-3)] leading-relaxed">{subtitle}</p>
          )}

          <div className="mt-6">{children}</div>

          {footer && <div className="mt-6 text-[13px] text-[var(--text-3)]">{footer}</div>}
        </div>
      </div>

      <footer className="px-4 py-5 text-center">
        <p className="text-[11.5px] text-[var(--text-3)]">
          Private financial records. Access is restricted and audited.
        </p>
      </footer>
    </div>
  );
}

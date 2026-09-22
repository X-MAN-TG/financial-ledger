/**
 * Theme switcher. Applies instantly, persists locally, mirrors to the
 * server. Grouped Standard / Premium per 17 section 1.
 */
import { useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { useSession } from '../hooks/use-session';
import { THEMES, type ThemeId } from '../lib/theme';
import { Popover } from './ui/overlays';

export function ThemeMenu() {
  const { theme, setTheme } = useSession();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const groups = ['Standard', 'Premium'] as const;

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        title="Change theme"
        className="inline-grid place-items-center h-9 w-9 rounded-md text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors shrink-0"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5v17" />
          <path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={252}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)] px-1 pb-2">
          Appearance
        </p>
        {groups.map((g) => (
          <div key={g} className="mb-1.5 last:mb-0">
            <p className="text-[10.5px] font-medium text-[var(--text-3)] px-1 py-1">{g}</p>
            <div className="space-y-0.5">
              {THEMES.filter((t) => t.group === g).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTheme(t.id as ThemeId);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2.5 h-9 px-2 rounded-md text-[13px] transition-colors',
                    theme === t.id
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
                      : 'text-[var(--text-2)] hover:bg-[var(--surface-2)]',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 rounded-full border shrink-0"
                    style={{
                      background: t.bg,
                      borderColor: 'var(--border-strong)',
                      boxShadow: `inset -4px 0 0 ${t.swatch}`,
                    }}
                  />
                  <span className="flex-1 text-left">{t.label}</span>
                  {theme === t.id && (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8.5l3.2 3.2L13 5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Popover>
    </>
  );
}

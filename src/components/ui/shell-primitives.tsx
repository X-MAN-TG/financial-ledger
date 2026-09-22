/**
 * Shared presentation primitives for the premium visual system.
 *
 * Everything here is token-driven (brief 8.2): no component hard-codes a hex
 * value, so all seven themes pick the new look up automatically. These are the
 * building blocks every page composes from - pages must not hand-roll
 * equivalents (brief 8.1).
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';

/* ========================================================== ElevatedCard == */

/**
 * The single card recipe for the whole app (brief 4.5): 1px low-contrast
 * border + soft elevation, so cards read as separate physical surfaces.
 * On OLED --card-shadow is `none` and the border carries the depth cue
 * (17 s1.3), which is why depth is a token rather than a utility class.
 */
export function ElevatedCard({
  children,
  className,
  tone = 'default',
  as: As = 'div',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  /** `hero` = accent-tinted treatment for the most important card on a page. */
  tone?: 'default' | 'hero';
  as?: 'div' | 'section' | 'li' | 'article';
  padded?: boolean;
}) {
  return (
    <As
      className={cn(
        'rounded-[var(--radius-lg)] border',
        padded && 'p-4 sm:p-5',
        tone === 'hero'
          ? 'bg-[var(--hero-bg)] border-[var(--hero-border)]'
          : 'bg-[var(--card-bg)] border-[var(--card-border)]',
        className,
      )}
      style={{ boxShadow: 'var(--card-shadow)' }}
    >
      {children}
    </As>
  );
}

/* ================================================================ IconChip = */

type ChipTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const CHIP_FG: Record<ChipTone, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  neutral: 'var(--text-2)',
};
const CHIP_BG: Record<ChipTone, string> = {
  accent: 'var(--accent-soft)',
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  info: 'var(--info-soft)',
  neutral: 'var(--chip-bg)',
};

/** Soft rounded-square icon chip used on stat cards and nav cards (brief 4.3). */
export function IconChip({
  children,
  tone = 'accent',
  size = 'md',
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid place-items-center rounded-[10px] shrink-0',
        size === 'md' ? 'h-9 w-9' : 'h-7 w-7',
        className,
      )}
      style={{ background: CHIP_BG[tone], color: CHIP_FG[tone] }}
    >
      {children}
    </span>
  );
}

/* ================================================================ StatCard = */

/**
 * Stat card anatomy from the reference (brief 4.3):
 * label top-left, icon chip top-right, big number, supporting caption.
 */
export function StatCard({
  label,
  value,
  caption,
  icon,
  tone = 'accent',
  hero,
  delta,
  className,
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  icon?: ReactNode;
  tone?: ChipTone;
  hero?: boolean;
  /** Signed percentage; rendered in success/danger and never when non-finite. */
  delta?: number | null;
  className?: string;
}) {
  const showDelta = typeof delta === 'number' && Number.isFinite(delta);
  const up = showDelta && (delta as number) > 0;
  const down = showDelta && (delta as number) < 0;

  return (
    <ElevatedCard tone={hero ? 'hero' : 'default'} className={cn('min-w-0', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)] leading-none pt-0.5">
          {label}
        </p>
        {icon && (
          <IconChip tone={hero ? 'accent' : tone} size="sm">
            {icon}
          </IconChip>
        )}
      </div>

      <p className="num mt-3 text-[26px] font-semibold leading-none text-[var(--text-1)] truncate">
        {value}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-[16px]">
        {showDelta && (
          <span
            className="text-[11.5px] font-semibold shrink-0"
            style={{ color: up ? 'var(--success)' : down ? 'var(--danger)' : 'var(--text-3)' }}
          >
            {up ? '↑' : down ? '↓' : ''} {Math.abs(delta as number).toFixed(1)}%
          </span>
        )}
        {caption && (
          <span className="text-[11.5px] text-[var(--text-3)] min-w-0">{caption}</span>
        )}
      </div>
    </ElevatedCard>
  );
}

/* ============================================================== PageHeader = */

/**
 * Page header block (brief 4.2): accent eyebrow, large title, one-line
 * subtitle, right-aligned primary actions.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-5',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="hidden sm:block text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--accent)] mb-1.5">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[20px] sm:text-[26px] font-semibold leading-tight text-[var(--text-1)] tracking-[-0.01em]">
          {title}
        </h1>
        {subtitle && (
          <p className="hidden sm:block mt-1 text-[13px] text-[var(--text-2)] leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:justify-end">{actions}</div>
      )}
    </div>
  );
}

/* ============================================================== PillButton = */

type PillVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type PillSize = 'sm' | 'md';

const PILL_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-full font-medium ' +
  'transition-[background,border-color,color,opacity] duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-0)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed select-none';

const PILL_SIZE: Record<PillSize, string> = {
  // >=44px touch target on the md size (18 s5 / 16 s8).
  md: 'h-11 px-5 text-[13.5px]',
  sm: 'h-9 px-3.5 text-[12.5px]',
};

const PILL_VARIANT: Record<PillVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 active:opacity-80 border border-transparent',
  secondary:
    'bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--border-strong)] hover:bg-[var(--surface-3)]',
  ghost:
    'bg-transparent text-[var(--text-2)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]',
  danger:
    'bg-[var(--danger)] text-[var(--accent-fg)] hover:opacity-90 border border-transparent',
};

export interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillVariant;
  size?: PillSize;
  icon?: ReactNode;
  loading?: boolean;
}

/** One pill button system for the whole app (brief 4.6). */
export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(function PillButton(
  { variant = 'secondary', size = 'md', icon, loading, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cn(PILL_BASE, PILL_SIZE[size], PILL_VARIANT[variant], className)}
      {...rest}
    >
      {loading ? (
        // Spinner replaces the label rather than triggering a full-page loader
        // (brief 5.4), so layout never jumps.
        <span
          className="h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin"
          aria-hidden
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});

/** Link styled as a pill button - same visual system, correct semantics. */
export function PillLink({
  to,
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className,
}: {
  to: string;
  variant?: PillVariant;
  size?: PillSize;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(PILL_BASE, PILL_SIZE[size], PILL_VARIANT[variant], 'no-underline', className)}
    >
      {icon}
      {children}
    </Link>
  );
}

/* ============================================================== StatusBadge = */

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

const BADGE_STYLE: Record<BadgeTone, { fg: string; bg: string }> = {
  success: { fg: 'var(--success)', bg: 'var(--success-soft)' },
  warning: { fg: 'var(--warning)', bg: 'var(--warning-soft)' },
  danger: { fg: 'var(--danger)', bg: 'var(--danger-soft)' },
  info: { fg: 'var(--info)', bg: 'var(--info-soft)' },
  accent: { fg: 'var(--accent)', bg: 'var(--accent-soft)' },
  neutral: { fg: 'var(--text-2)', bg: 'var(--chip-bg)' },
};

/**
 * Pill badge with optional icon (brief 4.5). Replaces bare status words and
 * plain coloured count text across the app.
 */
export function StatusBadge({
  children,
  tone = 'neutral',
  icon,
  className,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  const s = BADGE_STYLE[tone];
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
        'text-[11.5px] font-semibold leading-none whitespace-nowrap',
        className,
      )}
      style={{ color: s.fg, background: s.bg }}
    >
      {icon}
      {children}
    </span>
  );
}

/* =============================================================== AvatarChip = */

/** Filled circular avatar with initials (brief 4.1). */
export function AvatarChip({
  name,
  email,
  size = 'md',
  className,
}: {
  name?: string | null;
  email?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dim = size === 'lg' ? 'h-11 w-11 text-[14px]' : size === 'md' ? 'h-9 w-9 text-[12.5px]' : 'h-7 w-7 text-[11px]';
  return (
    <span
      className={cn(
        'inline-grid place-items-center rounded-full font-semibold shrink-0',
        'bg-[var(--accent-soft)] text-[var(--accent)]',
        dim,
        className,
      )}
      aria-hidden
    >
      {initials(name || email || '?')}
    </span>
  );
}

/* ============================================================== Breadcrumbs = */

/** Breadcrumb row for desktop/tablet (brief 4.1). */
export function Breadcrumbs({
  items,
  className,
}: {
  items: Array<{ label: string; to?: string }>;
  className?: string;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('hidden md:flex items-center gap-1.5 text-[12px] mb-4 no-print', className)}
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
            {item.to && !last ? (
              <Link
                to={item.to}
                className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors no-underline truncate"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn('truncate', last ? 'text-[var(--text-2)] font-medium' : 'text-[var(--text-3)]')}
                aria-current={last ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
            {!last && (
              <svg viewBox="0 0 24 24" className="h-3 w-3 text-[var(--text-3)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/* ================================================================ ChartCard = */

/** Chart container with the title + one-line subtitle pattern (brief 4.4). */
export function ChartCard({
  title,
  subtitle,
  legend,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ElevatedCard className={cn('min-w-0', className)}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold text-[var(--text-1)] leading-tight">{title}</h3>
          {subtitle && <p className="text-[12px] text-[var(--text-3)] mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {legend && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">{legend}</div>}
      <div className="mt-3">{children}</div>
    </ElevatedCard>
  );
}

/** Legend entry: colour dot + label, optionally with a value (brief 4.4). */
export function LegendItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-2)]">
      <span aria-hidden className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
      {label}
      {value && <span className="num text-[var(--text-1)] font-medium">{value}</span>}
    </span>
  );
}

/* ================================================================= NavCard = */

/** Shortcut/nav card: icon chip, title, description, trailing arrow (brief 4.8). */
export function NavCard({
  to,
  icon,
  title,
  description,
  tone = 'accent',
}: {
  to: string;
  icon: ReactNode;
  title: string;
  description: string;
  tone?: ChipTone;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-center gap-3.5 rounded-[var(--radius-lg)] border p-4 no-underline',
        'bg-[var(--card-bg)] border-[var(--card-border)]',
        'transition-[border-color,transform] duration-150',
        'hover:border-[var(--accent)] active:translate-y-px',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
      )}
      style={{ boxShadow: 'var(--card-shadow)' }}
    >
      <IconChip tone={tone}>{icon}</IconChip>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-[var(--text-1)] leading-tight">
          {title}
        </span>
        <span className="block text-[12px] text-[var(--text-3)] mt-0.5 truncate">{description}</span>
      </span>
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-[var(--text-3)] shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}

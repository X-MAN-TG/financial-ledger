/**
 * Core UI primitives. Built on Tailwind utilities that resolve to the theme
 * token layer, so every control is automatically correct in all 8 themes.
 * Deliberately small and un-clever: no gradients, no glow, no glass except
 * where 16 s3 permits it.
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';

/* ------------------------------------------------------------- Button ---- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110 active:brightness-95 shadow-e1',
  secondary:
    'bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--border)] hover:bg-[var(--surface-3)]',
  ghost: 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]',
  danger: 'bg-[var(--danger)] text-white hover:brightness-110 active:brightness-95',
  subtle: 'bg-[var(--accent-soft)] text-[var(--accent)] hover:brightness-105',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  // 44px min touch target on mobile controls (18 s4.1).
  sm: 'h-9 px-3 text-[13px] rounded-md gap-1.5',
  md: 'h-11 px-4 text-sm rounded-md gap-2',
  lg: 'h-12 px-6 text-[15px] rounded-lg gap-2',
  icon: 'h-11 w-11 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,color,filter,box-shadow] duration-150 ease-standard',
        'disabled:opacity-50 disabled:pointer-events-none',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="animate-spin-slow h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------- Input ---- */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full h-11 px-3 rounded-md bg-[var(--surface-1)] text-[var(--text-1)]',
        'border border-[var(--border)] placeholder:text-[var(--text-3)]',
        'transition-[border-color,box-shadow,background-color] duration-150',
        'hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
        'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] focus:bg-[var(--surface-1)]',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        invalid && 'border-[var(--danger)] focus:border-[var(--danger)]',
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full px-3 py-2.5 rounded-md bg-[var(--surface-1)] text-[var(--text-1)] resize-none',
          'border border-[var(--border)] placeholder:text-[var(--text-3)]',
          'transition-[border-color,box-shadow,background-color] duration-150',
          'hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
          'focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] focus:bg-[var(--surface-1)]',
          className,
        )}
        {...props}
      />
    );
  },
);

/* ------------------------------------------------------------- Labels ---- */

export function Label({
  children,
  htmlFor,
  required,
  className,
}: {
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('block text-[13px] font-medium text-[var(--text-2)] mb-1.5', className)}
    >
      {children}
      {required && <span className="text-[var(--danger)] ml-0.5">*</span>}
    </label>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-[12.5px] text-[var(--danger)] leading-snug">
      {children}
    </p>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[12.5px] text-[var(--text-3)] leading-snug">{children}</p>;
}

/* ----------------------------------------------------------- Checkbox ---- */

/**
 * Large custom checkbox (16 s7.4). 24px box inside a 44px hit area so it is
 * comfortably tappable on a phone without bloating row height.
 */
export function Checkbox({
  checked,
  onChange,
  disabled,
  label,
  tone = 'accent',
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  tone?: 'accent' | 'success';
  className?: string;
}) {
  const activeColor = tone === 'success' ? 'var(--success)' : 'var(--accent)';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex items-center justify-center h-11 w-11 -m-1 rounded-md',
        'transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none',
        'hover:bg-[var(--surface-2)]',
        className,
      )}
    >
      <span
        className="grid place-items-center h-[22px] w-[22px] rounded-[6px] border-2 transition-all duration-200 ease-standard"
        style={{
          borderColor: checked ? activeColor : 'var(--border-strong)',
          background: checked ? activeColor : 'transparent',
          transform: checked ? 'scale(1.04)' : 'scale(1)',
        }}
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          style={{
            color: tone === 'success' ? 'var(--surface-1)' : 'var(--accent-fg)',
            opacity: checked ? 1 : 0,
            transform: checked ? 'scale(1)' : 'scale(0.5)',
            transition: 'opacity 150ms ease-out, transform 150ms cubic-bezier(0.2,0,0,1)',
          }}
          aria-hidden
        >
          <path
            d="M3 8.5l3.2 3.2L13 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- Badge ---- */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border)]',
  success: 'bg-[var(--success-soft)] text-[var(--success)] border-transparent',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning)] border-transparent',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger)] border-transparent',
  info: 'bg-[var(--info-soft)] text-[var(--info)] border-transparent',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)] border-transparent',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border',
        'text-[11.5px] font-medium tracking-[0.01em] whitespace-nowrap',
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral' }: { tone?: BadgeTone }) {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'danger'
          ? 'var(--danger)'
          : tone === 'info' || tone === 'accent'
            ? 'var(--accent)'
            : 'var(--text-3)';
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
      style={{ background: color }}
    />
  );
}

/* --------------------------------------------------------------- Card ---- */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cn('card', padded && 'p-4 sm:p-5', className)}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-[var(--text-1)] leading-tight">{title}</h2>
        {subtitle && <p className="text-[13px] text-[var(--text-3)] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------- States ---- */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'animate-spin-slow inline-block h-4 w-4 rounded-full border-2',
        'border-[var(--accent)] border-r-transparent',
        className,
      )}
    />
  );
}

/** Designed empty state - never an unstyled blank area (16 s6). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6 py-14', className)}>
      {icon && (
        <div className="mb-3 h-12 w-12 grid place-items-center rounded-full bg-[var(--surface-2)] text-[var(--text-3)]">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-[var(--text-1)]">{title}</p>
      {description && (
        <p className="mt-1.5 text-[13.5px] text-[var(--text-3)] max-w-[42ch] leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} />;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12">
      <div className="mb-3 h-12 w-12 grid place-items-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v5M12 16.5v.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <p className="text-[15px] font-semibold text-[var(--text-1)]">{title}</p>
      {description && (
        <p className="mt-1.5 text-[13.5px] text-[var(--text-3)] max-w-[42ch]">{description}</p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Divider ---- */

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-[var(--border)]', className)} />;
}

/**
 * Overlay primitives: Modal (desktop) / Sheet (mobile), Popover, Toast,
 * ConfirmDialog. Focus is trapped, Escape closes, body scroll locks.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { Button } from './primitives';

function useLockBodyScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

/**
 * Modal on >=640px, bottom sheet on phones (18 s3: sheets over dialogs on
 * mobile, reachable with a thumb).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'input,textarea,select,button:not([data-close]),[tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 40);
    return () => {
      window.clearTimeout(t);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const maxW = size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 animate-fade-rise"
        style={{ background: 'var(--overlay)' }}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full elevated-glass shadow-e3 animate-fade-rise safe-bottom',
          'rounded-t-xl sm:rounded-xl max-h-[90vh] flex flex-col',
          maxW,
        )}
      >
        {/* Grab handle - a sheet affordance on touch devices. */}
        <div className="sm:hidden pt-2.5 pb-1 grid place-items-center">
          <div className="h-1 w-9 rounded-full bg-[var(--border-strong)]" />
        </div>
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <h2 className="text-[16px] font-semibold text-[var(--text-1)]">{title}</h2>
          {description && (
            <p className="mt-1 text-[13px] text-[var(--text-3)] leading-relaxed">{description}</p>
          )}
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-[var(--border)] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-close>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-[var(--text-2)] leading-relaxed">
        {destructive
          ? 'This action can be undone from Trash.'
          : 'Please confirm you want to continue.'}
      </p>
    </Modal>
  );
}

/** Anchored popover used by the Note affordance and menus. */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = 'end',
  width = 300,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 16);
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      // Flip above the anchor when there is not enough room below.
      const belowSpace = window.innerHeight - r.bottom;
      const top = belowSpace < 220 ? Math.max(8, r.top - 8 - 200) : r.bottom + 8;
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      className="fixed z-50 card shadow-e3 p-3 animate-fade-rise"
      style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16) }}
    >
      {children}
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------- Toast ---- */

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      const duration = t.duration ?? (t.tone === 'danger' ? 7000 : 3800);
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="fixed z-[60] left-1/2 -translate-x-1/2 bottom-[calc(var(--bottomnav-h)+16px)] sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0 flex flex-col gap-2 w-[min(400px,calc(100vw-24px))] no-print"
          role="region"
          aria-live="polite"
        >
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const accent =
    toast.tone === 'success'
      ? 'var(--success)'
      : toast.tone === 'danger'
        ? 'var(--danger)'
        : toast.tone === 'warning'
          ? 'var(--warning)'
          : toast.tone === 'info'
            ? 'var(--info)'
            : 'var(--text-3)';
  return (
    <div className="card elevated-glass shadow-e3 p-3.5 pl-4 flex items-start gap-3 animate-fade-rise relative overflow-hidden">
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: accent }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-[var(--text-1)] leading-snug">
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-[12.5px] text-[var(--text-3)] leading-snug">
            {toast.description}
          </p>
        )}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="text-[12.5px] font-semibold text-[var(--accent)] hover:underline shrink-0 px-1"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-[var(--text-3)] hover:text-[var(--text-1)] -mt-0.5 -mr-0.5 h-6 w-6 grid place-items-center rounded"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/**
 * Display formatting. Money is stored as REAL and rendered with fixed
 * decimals and tabular figures so columns align (16 s9).
 * No live FX rates anywhere - currencies are reported side by side only.
 */
export type CurrencyKey = 'INR' | 'USDT' | 'RUB' | 'EXTRAS';

const SYMBOL: Record<CurrencyKey, string> = {
  INR: '₹',
  USDT: '$',
  RUB: '₽',
  EXTRAS: '',
};

const DECIMALS: Record<CurrencyKey, number> = {
  INR: 2,
  USDT: 2,
  RUB: 2,
  EXTRAS: 2,
};

export function formatMoney(
  value: number | null | undefined,
  currency: CurrencyKey = 'INR',
  opts: { symbol?: boolean; blankOnNull?: boolean } = {},
): string {
  const { symbol = true, blankOnNull = false } = opts;
  if (value === null || value === undefined) return blankOnNull ? '' : symbol ? `${SYMBOL[currency]}0.00` : '0.00';
  const n = Number.isFinite(value) ? value : 0;
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: DECIMALS[currency],
    maximumFractionDigits: DECIMALS[currency],
  });
  return symbol && SYMBOL[currency] ? `${SYMBOL[currency]}${formatted}` : formatted;
}

/** Compact form for dense analytics tiles: 1.2M, 340.5K. */
export function formatCompact(value: number | null | undefined, currency: CurrencyKey = 'INR'): string {
  const n = value ?? 0;
  const abs = Math.abs(n);
  const sym = SYMBOL[currency];
  if (abs >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}K`;
  return `${sym}${n.toFixed(2)}`;
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  return (value ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value: number | null | undefined, decimals = 0): string {
  return `${(value ?? 0).toFixed(decimals)}%`;
}

/** Signed delta for period-over-period comparisons. */
export function formatDelta(pct: number | null | undefined, decimals = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(decimals)}%`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Parses 'YYYY-MM-DD' as a LOCAL date (never UTC - avoids off-by-one days). */
export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatDateLong(dateKey: string): string {
  const d = parseDateKey(dateKey);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateMedium(dateKey: string): string {
  const d = parseDateKey(dateKey);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export function formatDateShort(dateKey: string): string {
  const d = parseDateKey(dateKey);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

export function formatWeekday(dateKey: string): string {
  return DAYS[parseDateKey(dateKey).getDay()].slice(0, 3);
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}, ${formatTime(ts)}`;
}

/** Human "time ago" for sync status and audit rows. */
export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return formatDateMedium(new Date(ts).toISOString().slice(0, 10));
}

export function formatBytes(bytes: number | null | undefined): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

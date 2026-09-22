/**
 * Theme registry (17-theme-and-visual-system.txt).
 * The active theme is persisted locally for instant application on reload
 * and mirrored to the server (user_settings.theme) when signed in.
 */
export const THEMES = [
  { id: 'light', label: 'Light', group: 'Standard', swatch: '#2f5fd8', bg: '#f6f7f9' },
  { id: 'dark', label: 'Dark', group: 'Standard', swatch: '#6f95ef', bg: '#14171c' },
  { id: 'oled', label: 'OLED Dark', group: 'Standard', swatch: '#7aa2ff', bg: '#000000' },
  { id: 'navy', label: 'Midnight Navy', group: 'Premium', swatch: '#56a8e8', bg: '#0b1524' },
  { id: 'indigo', label: 'Indigo Executive', group: 'Premium', swatch: '#9a8cff', bg: '#12142a' },
  { id: 'emerald', label: 'Emerald Ledger', group: 'Premium', swatch: '#3fbe87', bg: '#101715' },
  { id: 'slate', label: 'Slate Graphite', group: 'Premium', swatch: '#a596e8', bg: '#17191d' },
  { id: 'pearl', label: 'Pearl', group: 'Premium', swatch: '#10715a', bg: '#f4f2ee' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const THEME_STORAGE_KEY = 'ledger.theme';
const VALID = new Set(THEMES.map((t) => t.id as string));

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && VALID.has(v);
}

export function getStoredTheme(): ThemeId | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(v) ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode - the attribute still applies for this session */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const entry = THEMES.find((t) => t.id === theme);
  if (meta && entry) meta.setAttribute('content', entry.bg);
}

export function systemPreferredTheme(): ThemeId {
  if (typeof window === 'undefined' || !window.matchMedia) return 'navy';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'navy';
}

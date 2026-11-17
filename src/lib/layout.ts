import { useAuth } from '../contexts/AuthContext';

export type Accent = 'blue' | 'teal' | 'purple' | 'rose' | 'orange' | 'green';
export type TextSize = 'small' | 'default' | 'large';
export type Density = 'comfortable' | 'compact';
export type MessageStyle = 'classic' | 'bubbles';

export interface Layout {
  accent: Accent;
  textSize: TextSize;
  density: Density;
  messageStyle: MessageStyle;
  previews: boolean;
  /** Chat background: 'none', a preset id like 'preset:dawn', or an image URL. */
  background: string;
}

export const DEFAULT_LAYOUT: Layout = {
  accent: 'blue',
  textSize: 'default',
  density: 'comfortable',
  messageStyle: 'classic',
  previews: true,
  background: 'none',
};

export const BACKGROUND_PRESETS: { id: string; label: string; light: string; dark: string }[] = [
  { id: 'dawn', label: 'Dawn', light: 'linear-gradient(160deg, #fde7d9 0%, #f3e3f7 55%, #e2e9fb 100%)', dark: 'linear-gradient(160deg, #2a1f26 0%, #241f33 55%, #1b2233 100%)' },
  { id: 'ocean', label: 'Ocean', light: 'linear-gradient(180deg, #e3f0fb 0%, #d7ecf2 100%)', dark: 'linear-gradient(180deg, #13212e 0%, #102428 100%)' },
  { id: 'mint', label: 'Mint', light: 'linear-gradient(160deg, #e6f6ee 0%, #f2f8e6 100%)', dark: 'linear-gradient(160deg, #13261d 0%, #1d2414 100%)' },
  { id: 'dots', label: 'Dots', light: 'radial-gradient(#d6dbe3 1.2px, transparent 1.2px) 0 0 / 18px 18px, #f7f8fa', dark: 'radial-gradient(#2c313a 1.2px, transparent 1.2px) 0 0 / 18px 18px, #15181d' },
  { id: 'grid', label: 'Grid', light: 'linear-gradient(#e7eaef 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(90deg, #e7eaef 1px, transparent 1px) 0 0 / 22px 22px, #fafbfc', dark: 'linear-gradient(#22262d 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(90deg, #22262d 1px, transparent 1px) 0 0 / 22px 22px, #14171b' },
];

/** CSS background for the chat area, or undefined for none. */
export function chatBackgroundCss(bg: string, dark: boolean): string | undefined {
  if (!bg || bg === 'none') return undefined;
  if (bg.startsWith('preset:')) {
    const p = BACKGROUND_PRESETS.find((x) => x.id === bg.slice(7));
    return p ? (dark ? p.dark : p.light) : undefined;
  }
  if (!/^https:\/\//.test(bg)) return undefined;
  const veil = dark ? 'rgb(15 17 21 / 0.72)' : 'rgb(255 255 255 / 0.62)';
  return `linear-gradient(${veil}, ${veil}), url("${bg.replace(/"/g, '')}") center / cover no-repeat`;
}

type Palette = { accent: string; hover: string; soft: string; onSoft: string; on: string };

export const ACCENTS: Record<Accent, { label: string; light: Palette; dark: Palette }> = {
  blue: {
    label: 'Blue',
    light: { accent: '#0b57d0', hover: '#0a4fbd', soft: '#dce7fb', onSoft: '#0b3f94', on: '#ffffff' },
    dark: { accent: '#8ab4f8', hover: '#a3c4fa', soft: '#1d3355', onSoft: '#cfe0ff', on: '#0a1a33' },
  },
  teal: {
    label: 'Teal',
    light: { accent: '#00796b', hover: '#006a5e', soft: '#d3eeea', onSoft: '#00574d', on: '#ffffff' },
    dark: { accent: '#5fd4c4', hover: '#7fdfd2', soft: '#173a36', onSoft: '#c4f1eb', on: '#05201c' },
  },
  purple: {
    label: 'Purple',
    light: { accent: '#6b3fd4', hover: '#5f37bf', soft: '#e8e0fa', onSoft: '#4c2a9e', on: '#ffffff' },
    dark: { accent: '#c1a7ff', hover: '#d0bbff', soft: '#2e2550', onSoft: '#e6dcff', on: '#1c1238' },
  },
  rose: {
    label: 'Rose',
    light: { accent: '#c2185b', hover: '#ad1452', soft: '#fadbe6', onSoft: '#8e0f42', on: '#ffffff' },
    dark: { accent: '#ff8fb6', hover: '#ffa7c6', soft: '#4a1f30', onSoft: '#ffd6e5', on: '#3a0a1c' },
  },
  orange: {
    label: 'Orange',
    light: { accent: '#c25400', hover: '#ab4a00', soft: '#fbe3d1', onSoft: '#8a3c00', on: '#ffffff' },
    dark: { accent: '#ffb176', hover: '#ffc193', soft: '#45291a', onSoft: '#ffdcc2', on: '#331600' },
  },
  green: {
    label: 'Green',
    light: { accent: '#1e7d32', hover: '#1a6e2c', soft: '#d8eedb', onSoft: '#145523', on: '#ffffff' },
    dark: { accent: '#81c995', hover: '#9ad5aa', soft: '#1b3a23', onSoft: '#cdeed5', on: '#0b2412' },
  },
};

const ZOOM: Record<TextSize, number> = { small: 0.92, default: 1, large: 1.1 };
const CACHE_KEY = 'sauchatz-layout';

export function readLayout(raw: unknown): Layout {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Layout>;
  return {
    accent: v.accent && v.accent in ACCENTS ? v.accent : DEFAULT_LAYOUT.accent,
    textSize: v.textSize && v.textSize in ZOOM ? v.textSize : DEFAULT_LAYOUT.textSize,
    density: v.density === 'compact' ? 'compact' : 'comfortable',
    messageStyle: v.messageStyle === 'bubbles' ? 'bubbles' : 'classic',
    previews: v.previews !== false,
    background: typeof v.background === 'string' ? v.background : 'none',
  };
}

export function cachedLayout(): Layout {
  try { return readLayout(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')); } catch { return DEFAULT_LAYOUT; }
}

/** Applies accent color and text size to the page. */
export function applyLayout(layout: Layout) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(layout)); } catch { /* storage unavailable */ }
  const dark = document.documentElement.classList.contains('dark');
  const p = ACCENTS[layout.accent][dark ? 'dark' : 'light'];
  const root = document.documentElement.style;
  root.setProperty('--accent', p.accent);
  root.setProperty('--accent-hover', p.hover);
  root.setProperty('--accent-soft', p.soft);
  root.setProperty('--on-accent-soft', p.onSoft);
  root.setProperty('--on-accent', p.on);
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(ZOOM[layout.textSize]);
}

/** The signed-in person's layout settings, with defaults filled in. */
export function useLayout(): Layout {
  const { settings } = useAuth();
  return settings ? readLayout(settings.layout) : cachedLayout();
}

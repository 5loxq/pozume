import { Platform, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Manueller Theme-Override: auto | light | dark */
export type ThemeMode = 'auto' | 'light' | 'dark';
let themeOverride: ThemeMode | null = null;
const themeListeners = new Set<() => void>();

export async function loadThemeOverride(): Promise<ThemeMode> {
  const raw = await AsyncStorage.getItem('pozume.theme');
  themeOverride = (raw as ThemeMode) ?? 'auto';
  return themeOverride;
}

export async function saveThemeOverride(mode: ThemeMode): Promise<void> {
  themeOverride = mode;
  await AsyncStorage.setItem('pozume.theme', mode);
  themeListeners.forEach((fn) => fn());
}

export function onThemeChange(fn: () => void): () => void {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

export function getThemeMode(): ThemeMode {
  return themeOverride ?? 'auto';
}

export interface Palette {
  bg: string; surface: string; text: string; textMuted: string; textFaint: string;
  border: string; primary: string; primaryDark: string; primarySoft: string;
  accent: string; danger: string; dangerSoft: string; star: string; success: string;
}

const light: Palette = {
  bg: '#f6f7fb', surface: '#ffffff', text: '#151a23', textMuted: '#5b6472',
  textFaint: '#9aa3b2', border: '#e6e9f0', primary: '#4f46e5', primaryDark: '#4338ca',
  primarySoft: '#eef2ff', accent: '#0ea5e9', danger: '#dc2626', dangerSoft: '#fef2f2',
  star: '#f59e0b', success: '#16a34a',
};

const dark: Palette = {
  bg: '#0f1117', surface: '#1a1d26', text: '#e8eaf0', textMuted: '#9aa3b2',
  textFaint: '#5b6472', border: '#2a2e3a', primary: '#818cf8', primaryDark: '#6366f1',
  primarySoft: '#1e2135', accent: '#38bdf8', danger: '#f87171', dangerSoft: '#2a1518',
  star: '#fbbf24', success: '#4ade80',
};

export function useIsDark(): boolean {
  const system = useColorScheme();
  const mode = getThemeMode();
  return (mode === 'auto' ? system : mode) === 'dark';
}

export function usePalette(): Palette {
  return useIsDark() ? dark : light;
}

const TAG_PALETTE_LIGHT: [string, string][] = [
  ['#eef2ff', '#4f46e5'], ['#ecfeff', '#0891b2'], ['#fef3c7', '#b45309'],
  ['#fce7f3', '#be185d'], ['#dcfce7', '#15803d'], ['#f3e8ff', '#7e22ce'],
  ['#ffedd5', '#c2410c'], ['#e0f2fe', '#0369a1'],
];
const TAG_PALETTE_DARK: [string, string][] = [
  ['#232647', '#a5b4fc'], ['#12333a', '#67e8f9'], ['#3a2e12', '#fcd34d'],
  ['#3a1a2a', '#f9a8d4'], ['#15301e', '#86efac'], ['#2e1d47', '#c4b5fd'],
  ['#3a2210', '#fdba74'], ['#12304d', '#7dd3fc'],
];

export function tagColors(tag: string, dark?: boolean): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  const pal = dark ? TAG_PALETTE_DARK : TAG_PALETTE_LIGHT;
  const [bg, fg] = pal[hash % pal.length];
  return { bg, fg };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
// Modernisierung: rundere Ecken (Karten 20px, Sheets 26px) für ein weicheres,
// zeitgemäßes Erscheinungsbild; pill bleibt für Chips/Buttons
export const radius = { sm: 12, md: 16, lg: 20, xl: 26, pill: 999 };

export function typeFor(p: Palette) {
  return {
    title: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5, color: p.text },
    h2: { fontSize: 17, fontWeight: '700' as const, color: p.text },
    body: { fontSize: 15, color: p.text, lineHeight: 22 },
    muted: { fontSize: 13, color: p.textMuted },
    faint: () => ({ fontSize: 12, color: p.textFaint }),
  };
}

// Modernisierung: weichere, weiter gefasste Schatten statt harter Kanten —
// Light Mode wirkt dadurch luftig, Dark Mode ergänzt feine Rahmen stattdessen
export const shadow = Platform.select({
  ios: { shadowColor: '#1a2340', shadowOpacity: 0.06, shadowRadius: 18, shadowOffset: { width: 0, height: 7 } },
  android: { elevation: 4 },
});

export const shadowSoft = Platform.select({
  ios: { shadowColor: '#1a2340', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  android: { elevation: 1 },
});

/**
 * Palette-abhängige Primär-Button-Styles: Dark nutzt die Dark-Primary
 * (#818cf8) statt der Light-Primary. Zur Laufzeit mit der aktuellen
 * Palette aufrufen, z.B. primaryButtonFor(usePalette()).
 */
export function primaryButtonFor(p: Palette) {
  return {
    backgroundColor: p.primary,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
}

export const greetingForHour = (hour: number, locale = 'de'): string => {
  if (locale === 'de') {
    if (hour < 11) return 'Guten Morgen';
    if (hour < 18) return 'Guten Tag';
    return 'Guten Abend';
  }
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

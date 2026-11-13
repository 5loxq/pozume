import { Platform } from 'react-native';

export const colors = {
  bg: '#f6f7fb',
  surface: '#ffffff',
  text: '#151a23',
  textMuted: '#5b6472',
  textFaint: '#9aa3b2',
  border: '#e6e9f0',
  primary: '#4f46e5',
  primaryDark: '#4338ca',
  primarySoft: '#eef2ff',
  accent: '#0ea5e9',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
  star: '#f59e0b',
  success: '#16a34a',
};

/** Tag-Farben: deterministisch aus Tag-Name (weiche Pastell-Paare) */
const TAG_PALETTE: [string, string][] = [
  ['#eef2ff', '#4f46e5'], // indigo
  ['#ecfeff', '#0891b2'], // cyan
  ['#fef3c7', '#b45309'], // amber
  ['#fce7f3', '#be185d'], // pink
  ['#dcfce7', '#15803d'], // green
  ['#f3e8ff', '#7e22ce'], // purple
  ['#ffedd5', '#c2410c'], // orange
  ['#e0f2fe', '#0369a1'], // sky
];

export function tagColors(tag: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  const [bg, fg] = TAG_PALETTE[hash % TAG_PALETTE.length];
  return { bg, fg };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };

export const type = {
  title: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5, color: colors.text },
  h2: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 22 },
  muted: { fontSize: 13, color: colors.textMuted },
  faint: () => ({ fontSize: 12, color: colors.textFaint }),
};

export const shadow = Platform.select({
  ios: { shadowColor: '#1a2340', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 3 },
});

export const shadowSoft = Platform.select({
  ios: { shadowColor: '#1a2340', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  android: { elevation: 1 },
});

/** Primäre Aktion */
export const primaryButton = {
  backgroundColor: colors.primary,
  borderRadius: radius.pill,
  paddingVertical: 16,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

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

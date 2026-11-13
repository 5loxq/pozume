import { de, TranslationKey } from './de';
import { en } from './en';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Locale = 'de' | 'en';
export type LocaleMode = 'auto' | Locale;
const dicts: Record<Locale, Record<TranslationKey, string>> = { de, en };

let override: LocaleMode | null = null;
const listeners = new Set<() => void>();

export async function loadLocaleOverride(): Promise<LocaleMode> {
  const raw = await AsyncStorage.getItem('pozume.locale');
  override = (raw as LocaleMode) ?? 'auto';
  return override;
}

export async function saveLocaleOverride(mode: LocaleMode): Promise<void> {
  override = mode;
  await AsyncStorage.setItem('pozume.locale', mode);
  listeners.forEach((fn) => fn());
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLocale(): Locale {
  if (override === 'de' || override === 'en') return override;
  const tag = (typeof navigator !== 'undefined' && (navigator as any).language) || 'de';
  return tag.startsWith('en') ? 'en' : 'de';
}

export function getLocaleMode(): LocaleMode {
  return override ?? 'auto';
}

export function t(key: TranslationKey, locale: Locale = getLocale(), vars?: Record<string, string | number>): string {
  let out: string = dicts[locale][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

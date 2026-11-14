import { de, TranslationKey } from './de';
import { en } from './en';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';

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
  // React Native hat kein `navigator`-Global; die Systemsprache steht nur nativ
  // (aus den RN-Typen entfernt, zur Laufzeit aber vorhanden).
  const tag = (I18nManager as any).localeIdentifier || 'de';
  return String(tag).toLowerCase().startsWith('en') ? 'en' : 'de';
}

export function getLocaleMode(): LocaleMode {
  return override ?? 'auto';
}

/** t(key, vars) oder t(key, locale, vars) — beide Signaturen erlaubt */
export function t(
  key: TranslationKey,
  localeOrVars?: Locale | Record<string, string | number>,
  maybeVars?: Record<string, string | number>,
): string {
  const locale: Locale = typeof localeOrVars === 'string' ? localeOrVars : getLocale();
  const vars = typeof localeOrVars === 'object' && localeOrVars !== null ? localeOrVars : maybeVars;
  let out: string = dicts[locale][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

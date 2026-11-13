import { de, TranslationKey } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';
const dicts: Record<Locale, Record<TranslationKey, string>> = { de, en };

export function getLocale(): Locale {
  const tag = (typeof navigator !== 'undefined' && (navigator as any).language) || 'de';
  return tag.startsWith('en') ? 'en' : 'de';
}

export function t(key: TranslationKey, locale: Locale = getLocale(), vars?: Record<string, string | number>): string {
  let out: string = dicts[locale][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  }
  return out;
}

import { de, TranslationKey } from './de';
import { en } from './en';

export type Locale = 'de' | 'en';
const dicts: Record<Locale, Record<TranslationKey, string>> = { de, en };

export function getLocale(): Locale {
  const tag = (typeof navigator !== 'undefined' && (navigator as any).language) || 'de';
  return tag.startsWith('en') ? 'en' : 'de';
}

export function t(key: TranslationKey, locale: Locale = getLocale()): string {
  return dicts[locale][key] ?? key;
}

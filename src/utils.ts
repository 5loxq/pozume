/**
 * Relative Zeit formatieren. Intl.RelativeTimeFormat fehlt in manchen
 * Hermes-Builds (iOS liefert nur Collator/DateTimeFormat/NumberFormat) —
 * `new Intl.RelativeTimeFormat(...)` wirft dort "Cannot read property
 * 'prototype' of undefined" und lässt ganze Listen crashen. Deshalb:
 * nutzt Intl, wo vorhanden, sonst Fallback-Texte für die App-Sprachen.
 */
const REL_UNITS: Record<string, { ago: [string, string, string]; ahead: [string, string, string]; now: string }> = {
  de: { ago: ['vor {n} Minuten', 'vor {n} Stunden', 'vor {n} Tagen'], ahead: ['in {n} Minuten', 'in {n} Stunden', 'in {n} Tagen'], now: 'gerade eben' },
  en: { ago: ['{n} minutes ago', '{n} hours ago', '{n} days ago'], ahead: ['in {n} minutes', 'in {n} hours', 'in {n} days'], now: 'just now' },
  fr: { ago: ['il y a {n} minutes', 'il y a {n} heures', 'il y a {n} jours'], ahead: ['dans {n} minutes', 'dans {n} heures', 'dans {n} jours'], now: "à l'instant" },
  es: { ago: ['hace {n} minutos', 'hace {n} horas', 'hace {n} días'], ahead: ['en {n} minutos', 'en {n} horas', 'en {n} días'], now: 'justo ahora' },
};

function relFormat(value: number, unit: 'minute' | 'hour' | 'day', locale: string): string {
  const rtf = (Intl as any).RelativeTimeFormat;
  if (typeof rtf === 'function') return new rtf(locale, { numeric: 'auto' }).format(value, unit);
  const u = REL_UNITS[locale] ?? REL_UNITS.en;
  const n = Math.abs(value);
  const idx = unit === 'minute' ? 0 : unit === 'hour' ? 1 : 2;
  const tpl = value < 0 ? u.ago[idx] : u.ahead[idx];
  return tpl.replace('{n}', String(n));
}

export function formatRelativeDate(iso?: string, locale = 'de'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) {
    // Zukunft: >= 1 Minute -> "in X Minuten", < 1 Minute -> "gerade eben"
    const futureMin = Math.floor(-diffMs / 60000);
    if (futureMin >= 1) return relFormat(futureMin, 'minute', locale);
    return (REL_UNITS[locale] ?? REL_UNITS.en).now;
  }
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return (REL_UNITS[locale] ?? REL_UNITS.en).now;
  if (diffMin < 60) return relFormat(-diffMin, 'minute', locale);
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return relFormat(-diffH, 'hour', locale);
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return relFormat(-diffD, 'day', locale);
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

/** Bytes als Base64-String (für FileSystem.writeAsStringAsync mit Base64-Encoding) */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Erste ~2 Zeilen Klartext aus Markdown/HTML-Inhalt */
export function excerpt(content?: string, max = 120): string {
  if (!content) return '';
  const text = content
    .replace(/<[^>]+>/g, ' ')
    // Bindestriche bleiben erhalten (z.B. "E-Mail"); Klammern und
    // Ausrufezeichen werden weiterhin entfernt
    .replace(/[#*_`>\[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

/** Checkbox-Aufgaben aus Markdown extrahieren: [ ] offen, [x] erledigt */
export interface Task { noteId: number; noteHeading: string; text: string; done: boolean; lineIndex: number }

export function extractTasks(content: string | undefined, noteId: number, noteHeading: string): Task[] {
  if (!content) return [];
  const out: Task[] = [];
  content.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) {
      out.push({ noteId, noteHeading, text: m[2].trim(), done: m[1].toLowerCase() === 'x', lineIndex: i });
    }
  });
  return out;
}

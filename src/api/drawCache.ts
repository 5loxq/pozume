import { secureSetItem, secureGetItem } from './secureStorage';

/**
 * Lokaler Cache für Zeichnungsinhalte: Die Notizliste liefert keinen `content`,
 * Zeichnungen wären in der Kartenübersicht unsichtbar. Der Cache speichert pro
 * Notiz den Inhalt plus den zugehörigen Änderungszeitpunkt — nur Notizen, die
 * sich geändert haben, werden vom Server nachgeladen.
 */
const KEY = 'pozume.drawings.v1';

export interface DrawingCacheEntry {
  /** updated_at der Notiz, für die der Inhalt stand */
  u: string;
  /** Zeichnungsinhalt (Excalidraw-HTML, -JSON oder SVG) */
  c: string;
}

export type DrawingCache = Record<number, DrawingCacheEntry>;

export async function readDrawingCache(): Promise<DrawingCache> {
  try {
    const raw = await secureGetItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    // Schlüssel kommen als Strings aus JSON — zurück zu Zahlen normalisieren
    const out: DrawingCache = {};
    for (const [k, v] of Object.entries(parsed)) out[Number(k)] = v as DrawingCacheEntry;
    return out;
  } catch { return {}; }
}

export async function writeDrawingCache(cache: DrawingCache): Promise<void> {
  try {
    // Cache-Begrenzung (P1-14): die 200 zuletzt geaenderten Zeichnungen behalten,
    // aeltere verfaellen — der Cache darf nicht unbegrenzt wachsen
    const entries = Object.entries(cache);
    if (entries.length > 200) {
      entries.sort((a, b) => (b[1].u ?? '').localeCompare(a[1].u ?? ''));
      const capped: DrawingCache = {};
      for (const [k, v] of entries.slice(0, 200)) capped[Number(k)] = v;
      await secureSetItem(KEY, JSON.stringify(capped));
      return;
    }
    await secureSetItem(KEY, JSON.stringify(cache));
  } catch {}
}

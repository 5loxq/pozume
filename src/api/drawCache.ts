import AsyncStorage from '@react-native-async-storage/async-storage';

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
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    // Schlüssel kommen als Strings aus JSON — zurück zu Zahlen normalisieren
    const out: DrawingCache = {};
    for (const [k, v] of Object.entries(parsed)) out[Number(k)] = v as DrawingCacheEntry;
    return out;
  } catch { return {}; }
}

export async function writeDrawingCache(cache: DrawingCache): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
}

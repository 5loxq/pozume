import { secureSetItem, secureGetItem } from './secureStorage';

const NOTES_KEY = 'pozume.cache.notes.v1';
const FOLDERS_KEY = 'pozume.cache.folders.v1';
/** Obergrenze gecachter Notizen (P1-14): Der Cache darf nicht unbegrenzt
 *  wachsen — gecacht wird die erste Seite; mehr lädt die Liste ohnehin frisch
 *  vom Server, veraltet größere Bestände sind in der Suche besser aufgehoben. */
const MAX_CACHED_NOTES = 200;

/**
 * Notizen lokal cachen — App startet sofort mit letztem Stand, aktualisiert im
 * Hintergrund. Der Cache ist verschlüsselt (Schlüssel in der Keychain), damit
 * gespeicherte Zugangsdaten nicht die einzigen geschützten Daten bleiben.
 * Gecacht werden maximal die MAX_CACHED_NOTES neuesten Einträge.
 */
export async function cacheNotes(notes: unknown): Promise<void> {
  try {
    const trimmed = Array.isArray(notes) ? notes.slice(0, MAX_CACHED_NOTES) : notes;
    await secureSetItem(NOTES_KEY, JSON.stringify(trimmed));
  } catch {}
}

export async function readCachedNotes<T>(): Promise<T | null> {
  try {
    const raw = await secureGetItem(NOTES_KEY);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

export async function cacheFolders(folders: unknown): Promise<void> {
  try { await secureSetItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
}

export async function readCachedFolders<T>(): Promise<T | null> {
  try {
    const raw = await secureGetItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

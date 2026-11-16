import { secureSetItem, secureGetItem } from './secureStorage';

const NOTES_KEY = 'pozume.cache.notes.v1';
const FOLDERS_KEY = 'pozume.cache.folders.v1';

/**
 * Notizen lokal cachen — App startet sofort mit letztem Stand, aktualisiert im
 * Hintergrund. Der Cache ist verschlüsselt (Schlüssel in der Keychain), damit
 * gespeicherte Zugangsdaten nicht die einzigen geschützten Daten bleiben.
 */
export async function cacheNotes(notes: unknown): Promise<void> {
  try { await secureSetItem(NOTES_KEY, JSON.stringify(notes)); } catch {}
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

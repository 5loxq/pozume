import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTES_KEY = 'pozume.cache.notes.v1';
const FOLDERS_KEY = 'pozume.cache.folders.v1';

/** Notizen lokal cachen — App startet sofort mit letztem Stand, aktualisiert im Hintergrund */
export async function cacheNotes(notes: unknown): Promise<void> {
  try { await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch {}
}

export async function readCachedNotes<T>(): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

export async function cacheFolders(folders: unknown): Promise<void> {
  try { await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
}

export async function readCachedFolders<T>(): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

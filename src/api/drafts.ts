import { secureSetItem, secureGetItem } from './secureStorage';

/**
 * Dauerhafte lokale Entwürfe: Änderungen werden unabhängig vom Server-Speichern
 * laufend gesichert. Überlebt App-Absturz, App-Kill und Verbindungsabbruch —
 * der Autosave allein schützt nur, wenn sein Request auch durchkommt.
 * Ablage verschlüsselt (P0-5), da Entwürfe vollständige Notizinhalte halten.
 *
 * Schlüssel: `note-{id}` für bestehende Notizen, `new-{sessionId}` für neue,
 * `conflict-{id}` für Offline-Fassungen, die auf dem Server kollidiert sind
 * (beide Versionen erhalten — der Nutzer entscheidet im Editor).
 */
const KEY = 'pozume.drafts.v1';

export interface Draft {
  heading: string;
  content: string;
  tags: string;
  /** Ordner der Entwurfs-Fassung (null/undefined = oberste Ebene). Wird beim
   *  Restore der Editor-Ansicht nachgezeichnet; Konflikt-Entwürfe wissen so,
   *  in welchem Ordner die lokale Fassung lag (P0-1). */
  folderId?: number | null;
  savedAt: number;
}

async function readAll(): Promise<Record<string, Draft>> {
  try {
    const raw = await secureGetItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function writeAll(m: Record<string, Draft>): Promise<void> {
  try { await secureSetItem(KEY, JSON.stringify(m)); } catch {}
}

export async function saveDraft(key: string, draft: Omit<Draft, 'savedAt'>): Promise<void> {
  const m = await readAll();
  m[key] = { ...draft, savedAt: Date.now() };
  await writeAll(m);
}

export async function readDraft(key: string): Promise<Draft | null> {
  return (await readAll())[key] ?? null;
}

/**
 * Neuesten Entwurf einer ungespeicherten NEUEN Notiz finden (P0-2): Der
 * Editor vergibt pro Öffnung einen eigenen Schlüssel `new-…` — nach einem
 * App-Absturz zwischen lokalem Entwurf (400 ms) und dem ersten Server-Speichern
 * wüsste sonst niemand, dass der Entwurf existiert. Dieser Helfer findet den
 * jüngsten `new-…`-Entwurf, damit der Editor ihn beim nächsten Öffnen einer
 * neuen Notiz wiederherstellen kann — danach wird er unter dem frischen
 * Schlüssel neu gesichert.
 */
export async function latestNewDraft(): Promise<{ key: string; draft: Draft } | null> {
  const m = await readAll();
  let newest: { key: string; draft: Draft } | null = null;
  for (const [key, draft] of Object.entries(m)) {
    if (!key.startsWith('new-')) continue;
    if (newest == null || draft.savedAt > newest.draft.savedAt) newest = { key, draft };
  }
  return newest;
}

export async function clearDraft(key: string): Promise<void> {
  const m = await readAll();
  if (!(key in m)) return;
  delete m[key];
  await writeAll(m);
}

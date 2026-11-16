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

export async function clearDraft(key: string): Promise<void> {
  const m = await readAll();
  if (!(key in m)) return;
  delete m[key];
  await writeAll(m);
}

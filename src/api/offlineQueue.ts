import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PoznoteClient } from './client';

/**
 * Persistente Schreib-Queue für Offline-Bearbeitung.
 *
 * Schlägt ein Speichern wegen Netzwerkfehlers fehl, landet der komplette
 * Schreibvorgang hier (AsyncStorage, überlebt App-Kill). Beim nächsten Start
 * bzw. wenn die App in den Vordergrund kommt, wird die Queue in
 * Reihenfolge abgearbeitet.
 *
 * Einträge sind eindeutig pro Ziel: pro Notiz gewinnt der neueste Stand
 * (überschreibt ältere Einträge), damit die Queue nicht endlos wächst.
 */
const KEY = 'pozume.offlineQueue.v1';

export interface QueuedWrite {
  /** Eindeutiger Schlüssel: `note-{id}` für bestehende, `new-{sessionId}` für neue Notizen */
  key: string;
  kind: 'create' | 'update';
  noteId?: number;
  body: { heading: string; content: string; tags: string };
  queuedAt: number;
}

async function readAll(): Promise<QueuedWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function writeAll(q: QueuedWrite[]): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(q)); } catch {}
}

/** Schreibvorgang einreihen — vorhandener Eintrag mit gleichem Schlüssel wird ersetzt */
export async function enqueueWrite(entry: Omit<QueuedWrite, 'queuedAt'>): Promise<void> {
  const q = await readAll();
  const full: QueuedWrite = { ...entry, queuedAt: Date.now() };
  const idx = q.findIndex((e) => e.key === entry.key);
  if (idx >= 0) q[idx] = full; else q.push(full);
  await writeAll(q);
}

/** Eintrag entfernen (nach erfolgreichem Online-Speichern) */
export async function removeWrite(key: string): Promise<void> {
  const q = await readAll();
  await writeAll(q.filter((e) => e.key !== key));
}

export async function queueSize(): Promise<number> {
  return (await readAll()).length;
}

export interface FlushResult {
  flushed: number;
  failed: boolean;
  /** IDs der neu erstellten Notizen */
  createdIds: number[];
}

/**
 * Queue abarbeiten (älteste zuerst). Bei erneutem Netzwerkfehler wird
 * abgebrochen — der Rest bleibt liegen und wartet auf den nächsten Versuch.
 * Erfolgreich verarbeitete Einträge werden entfernt; während des Flushs
 * neu dazugekommene Schreibvorgänge bleiben erhalten (identifiziert über
 * Key + Zeitstempel, nicht über die Uhrzeit des Flush-Starts).
 */
export async function flushQueue(client: PoznoteClient): Promise<FlushResult> {
  const q = (await readAll()).sort((a, b) => a.queuedAt - b.queuedAt);
  if (q.length === 0) return { flushed: 0, failed: false, createdIds: [] };

  let flushed = 0;
  let failedIdx = -1;
  const createdIds: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const entry = q[i];
    try {
      if (entry.kind === 'create') {
        const res = await client.createNote({
          heading: entry.body.heading || 'Ohne Titel',
          content: entry.body.content,
          type: 'note',
          tags: entry.body.tags,
        });
        createdIds.push(res.note.id);
      } else if (entry.noteId != null) {
        await client.updateNote(entry.noteId, entry.body);
      }
      flushed++;
    } catch {
      failedIdx = i;
      break;
    }
  }

  if (flushed > 0) {
    // Verarbeitete Einträge sind ihr (key, queuedAt)-Paar; ein während des
    // Flushs neu eingereihter Stand hat einen anderen Zeitstempel und bleibt.
    const processed = new Set(
      q.slice(0, failedIdx >= 0 ? failedIdx : q.length).map((e) => `${e.key}|${e.queuedAt}`),
    );
    const after = await readAll();
    const keep = after.filter((e) => !processed.has(`${e.key}|${e.queuedAt}`));
    await writeAll(keep);
  }
  return { flushed, failed: failedIdx >= 0, createdIds };
}

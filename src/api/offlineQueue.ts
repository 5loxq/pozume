import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PoznoteClient } from './client';
import { saveDraft } from './drafts';

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
 *
 * Konflikte: Updates tragen das Version-Token der zuletzt gesehenen
 * Server-Fassung (if_version). Antwortet der Server mit 409, wird die
 * offline bearbeitete Fassung als Konflikt-Entwurf (`conflict-{id}`)
 * erhalten und aus der Queue entfernt — nichts geht verloren, der Nutzer
 * entscheidet im Editor. Duplikatschutz: Schlug ein Create vorher fehl,
 * wird vor dem erneuten Anlegen geprüft, ob der Server die Notiz bereits
 * hat (Antwort kann auf dem Rückweg verloren gegangen sein).
 */
const KEY = 'pozume.offlineQueue.v1';

export interface QueuedWrite {
  /** Eindeutiger Schlüssel: `note-{id}` für bestehende, `new-{sessionId}` für neue Notizen */
  key: string;
  kind: 'create' | 'update';
  noteId?: number;
  body: { heading: string; content: string; tags: string };
  /** Version-Token der Server-Fassung, auf der die Änderung basiert */
  if_version?: string;
  /** Fehlversuche (Netzwerk) — ab 1 wird vor Create-Wiederholung auf Duplikate geprüft */
  attempts?: number;
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
  /** Notiz-IDs mit Version-Konflikt: lokale Fassung liegt als Konflikt-Entwurf bereit */
  conflicts: number[];
}

/**
 * Prüfen, ob der Server eine identische Notiz bereits hat (Create-Retry nach
 * verlorenem Response). Vergleicht Titel und Inhalt exakt über maximal fünf
 * Kandidaten der Volltextsuche.
 */
async function findExistingCreate(client: PoznoteClient, entry: QueuedWrite): Promise<number | null> {
  try {
    const q = entry.body.heading || entry.body.content.slice(0, 40);
    if (!q.trim()) return null;
    const res = await client.searchNotes(q, { limit: 5 });
    for (const n of res.notes.slice(0, 5)) {
      if (n.heading !== entry.body.heading) continue;
      const detail = await client.getNote(n.id).catch(() => null);
      if (detail?.note && (detail.note.content ?? '') === entry.body.content) return n.id;
    }
  } catch {}
  return null;
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
  if (q.length === 0) return { flushed: 0, failed: false, createdIds: [], conflicts: [] };

  let flushed = 0;
  let failedIdx = -1;
  const createdIds: number[] = [];
  const conflicts: number[] = [];
  /** (key, queuedAt)-Paare der abgearbeiteten Einträge */
  const processed = new Set<string>();
  /** Bei Netzwerkfehler: Versuchszähler erhöhen für den nächsten Flush */
  const retried = new Map<string, number>();

  for (let i = 0; i < q.length; i++) {
    const entry = q[i];
    const pair = `${entry.key}|${entry.queuedAt}`;
    try {
      if (entry.kind === 'create') {
        // Duplikatschutz: nur nach einem Fehlversuch prüfen (Antwort kann
        // verloren gegangen sein, obwohl der Server angelegt hat)
        if ((entry.attempts ?? 0) > 0) {
          const existing = await findExistingCreate(client, entry);
          if (existing != null) {
            createdIds.push(existing);
            flushed++;
            processed.add(pair);
            continue;
          }
        }
        const res = await client.createNote({
          heading: entry.body.heading || 'Ohne Titel',
          content: entry.body.content,
          type: 'note',
          tags: entry.body.tags,
        });
        createdIds.push(res.note.id);
      } else if (entry.noteId != null) {
        await client.updateNote(entry.noteId, {
          ...entry.body,
          ...(entry.if_version ? { if_version: entry.if_version } : {}),
        });
      }
      flushed++;
      processed.add(pair);
    } catch (e: any) {
      if (e?.status === 409 && e?.data?.code === 'version_conflict' && entry.noteId != null) {
        // Konflikt: lokale Fassung als Entwurf erhalten, Server-Fassung bleibt
        // unangetastet — der Nutzer entscheidet beim nächsten Öffnen der Notiz.
        await saveDraft(`conflict-${entry.noteId}`, entry.body).catch(() => {});
        conflicts.push(entry.noteId);
        flushed++;
        processed.add(pair);
        continue;
      }
      failedIdx = i;
      retried.set(pair, (entry.attempts ?? 0) + 1);
      break;
    }
  }

  if (processed.size > 0 || retried.size > 0) {
    const after = await readAll();
    const keep = after
      .filter((e) => !processed.has(`${e.key}|${e.queuedAt}`))
      .map((e) => {
        const attempts = retried.get(`${e.key}|${e.queuedAt}`);
        return attempts != null ? { ...e, attempts } : e;
      });
    await writeAll(keep);
  }
  return { flushed, failed: failedIdx >= 0, createdIds, conflicts };
}

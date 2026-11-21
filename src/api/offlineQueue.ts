import { secureSetItem, secureGetItem } from './secureStorage';
import type { PoznoteClient } from './client';
import { saveDraft, readDraft, clearDraft } from './drafts';

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
 *
 * Löschungen werden ebenfalls gequeued; Listen blenden die Notiz lokal
 * aus, bis der Server die Löschung übernommen hat.
 */
const KEY = 'pozume.offlineQueue.v1';
/** queueKey -> { id, version }: vom Flush erstellte Notizen, damit ein noch
 *  offener Editor die ID übernimmt statt dieselbe Notiz doppelt anzulegen */
const CREATED_KEY = 'pozume.createdIds.v1';

export interface QueuedWrite {
  /** Eindeutiger Schlüssel: `note-{id}` für bestehende, `new-{sessionId}` für neue Notizen */
  key: string;
  kind: 'create' | 'update' | 'delete' | 'move';
  noteId?: number;
  body: { heading: string; content: string; tags: string };
  /** Version-Token der Server-Fassung, auf der die Änderung basiert */
  if_version?: string;
  /** Notiz-Typ (Note.type, z.B. 'markdown') — wird beim Create an den Server durchgereicht */
  noteType?: string;
  /** Zielordner — beim Create der Ordner der neuen Notiz (P1-12), beim 'move'
   *  das Ziel der Verschiebung (P1-9: Ordnerwechsel offline zuverlässig).
   *  null = oberste Ebene. Bei Updates wird er mitgefhrt, damit ein Konflikt-
   *  Entwurf weiß, in welchem Ordner die lokale Fassung lag. */
  folderId?: number | null;
  /** Fehlversuche (Netzwerk) — ab 1 wird vor Create-Wiederholung auf Duplikate geprüft */
  attempts?: number;
  queuedAt: number;
}

async function readCreated(): Promise<Record<string, { id: number; version?: string }>> {
  try {
    const raw = await secureGetItem(CREATED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function writeCreated(m: Record<string, { id: number; version?: string }>): Promise<void> {
  try { await secureSetItem(CREATED_KEY, JSON.stringify(m)); } catch {}
}

/** Vom Flush erstellte Notiz-ID festhalten (der Editor kann noch offen sein) */
export async function recordCreatedId(queueKey: string, noteId: number, version?: string): Promise<void> {
  const m = await readCreated();
  m[queueKey] = { id: noteId, version };
  await writeCreated(m);
}

/** Erstellte Notiz-ID abholen und Verbrauchen — verhindert Doppelanlage im Editor */
export async function takeCreatedId(queueKey: string): Promise<{ id: number; version?: string } | null> {
  const m = await readCreated();
  const entry = m[queueKey];
  if (!entry) return null;
  delete m[queueKey];
  await writeCreated(m);
  return entry;
}

async function readAll(): Promise<QueuedWrite[]> {
  try {
    const raw = await secureGetItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function writeAll(q: QueuedWrite[]): Promise<void> {
  try { await secureSetItem(KEY, JSON.stringify(q)); } catch {}
}

/** Schreibvorgang einreihen — vorhandener Eintrag mit gleichem Schlüssel wird ersetzt.
 *  Eine Löschung entfernt gleichzeitig ausstehende Änderungen derselben Notiz. */
export async function enqueueWrite(entry: Omit<QueuedWrite, 'queuedAt'>): Promise<void> {
  const q = await readAll();
  const full: QueuedWrite = { ...entry, queuedAt: Date.now() };
  let list = q;
  if (entry.kind === 'delete' && entry.noteId != null) {
    list = q.filter((e) => e.noteId !== entry.noteId || e.kind === 'delete');
  }
  const idx = list.findIndex((e) => e.key === entry.key);
  if (idx >= 0) list[idx] = full; else list.push(full);
  await writeAll(list);
}

/** IDs der offline gelöschten Notizen — Listen blenden sie aus, bis der Server es übernommen hat */
export async function pendingDeleteIds(): Promise<number[]> {
  const q = await readAll();
  return q.filter((e) => e.kind === 'delete' && e.noteId != null).map((e) => e.noteId!);
}

/** Eintrag entfernen (nach erfolgreichem Online-Speichern) */
export async function removeWrite(key: string): Promise<void> {
  const q = await readAll();
  await writeAll(q.filter((e) => e.key !== key));
}

/**
 * Einzelnen Eintrag anhand (key, queuedAt) sofort dauerhaft entfernen —
 * ohne die anderen zu berühren. Aufrufnach einem erfolgreichen Server-Create:
 * Stirbt die App zwischen Server-Anlage und dem gesammelten Speichern der
 * Queue am Ende des Flushs, würde der nächste Flush dieselbe Notiz sonst
 * erneut anlegen (Duplikat).
 */
async function removePair(pair: string): Promise<void> {
  const q = await readAll();
  await writeAll(q.filter((e) => `${e.key}|${e.queuedAt}` !== pair));
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
 * In-Flight-Schutz: flushQueue wird sowohl beim App-Start als auch bei
 * AppState-Wechseln aufgerufen — ohne Flag würden parallele Aufrufe
 * dieselben Create-Einträge doppelt beim Server anlegen. Ein zweiter,
 * parallel laufender Aufruf kehrt sofort leer zurück (ohne Warten).
 */
let flushing = false;

export async function flushQueue(client: PoznoteClient): Promise<FlushResult> {
  if (flushing) return { flushed: 0, failed: false, createdIds: [], conflicts: [] };
  flushing = true;
  try {
    return await flushQueueInner(client);
  } finally {
    flushing = false;
  }
}

/**
 * Queue abarbeiten (älteste zuerst). Bei erneutem Netzwerkfehler wird
 * abgebrochen — der Rest bleibt liegen und wartet auf den nächsten Versuch.
 * Erfolgreich verarbeitete Einträge werden entfernt; während des Flushs
 * neu dazugekommene Schreibvorgänge bleiben erhalten (identifiziert über
 * Key + Zeitstempel, nicht über die Uhrzeit des Flush-Starts).
 */
async function flushQueueInner(client: PoznoteClient): Promise<FlushResult> {
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
        // Jüngster lokaler Stand (P0-2): Der Entwurf kann aktueller sein als
        // der Queue-Eintrag — App-Kill zwischen Entwurfs-Schreibung (400 ms)
        // und dem nächsten Persist. Der Schlüssel ist sitzungsspezifisch
        // (`new-…`), also gehört ein abweichender Entwurf zweifelsfrei zu
        // genau diesem Eintrag; er gewinnt.
        const draft = await readDraft(entry.key).catch(() => null);
        const body = draft && (draft.heading !== entry.body.heading || draft.content !== entry.body.content || draft.tags !== entry.body.tags)
          ? { heading: draft.heading, content: draft.content, tags: draft.tags }
          : entry.body;
        const effective: QueuedWrite = { ...entry, body };
        // Duplikatschutz: nur nach einem Fehlversuch prüfen (Antwort kann
        // verloren gegangen sein, obwohl der Server angelegt hat)
        if ((entry.attempts ?? 0) > 0) {
          const existing = await findExistingCreate(client, effective);
          if (existing != null) {
            createdIds.push(existing);
            await recordCreatedId(entry.key, existing);
            await clearDraft(entry.key).catch(() => {});
            flushed++;
            processed.add(pair);
            continue;
          }
        }
        const res = await client.createNote({
          heading: body.heading || 'Ohne Titel',
          content: body.content,
          // Tatsächlichen Notiz-Typ durchreichen (Fallback 'note' für alte Einträge)
          type: entry.noteType ?? 'note',
          tags: body.tags,
          // Offline gewählter Zielordner mitgeben (P1-9/P1-12)
          ...(entry.folderId != null ? { folder_id: entry.folderId } : {}),
        });
        createdIds.push(res.note.id);
        // ID festhalten: Ein noch offener Editor übernimmt sie, statt die
        // Notiz beim nächsten Autosave ein zweites Mal anzulegen
        await recordCreatedId(entry.key, res.note.id, res.note.version);
        // Eintrag SOFORT dauerhaft entfernen: Stirbt die App zwischen Server-
        // Anlage und dem gesammelten Queue-Speichern am Ende des Flushs, läge
        // der Create-Eintrag sonst wieder in der letzten Start-Queue — der
        // nächste Flush würde die Notiz ein zweites Mal anlegen. Gleiches
        // gilt für den zugehörigen lokalen Entwurf.
        await removePair(pair);
        await clearDraft(entry.key).catch(() => {});
      } else if (entry.kind === 'delete' && entry.noteId != null) {
        await client.deleteNote(entry.noteId);
      } else if (entry.kind === 'move' && entry.noteId != null) {
        // Ordnerwechsel nachholen (P1-9): folder_id ohne if_version — der
        // Zielfolder ist Metadaten, eine verschobene Notiz wird nicht still
        // überschrieben. moveNote wegen des Live-Bugs: null wird serverseitig
        // ignoriert, nur 0 erreicht die oberste Ebene.
        await client.moveNote(entry.noteId, entry.folderId ?? null);
      } else if (entry.kind === 'update' && entry.noteId != null) {
        await client.updateNote(entry.noteId, {
          ...entry.body,
          ...(entry.if_version ? { if_version: entry.if_version } : {}),
        });
      }
      flushed++;
      processed.add(pair);
    } catch (e: any) {
      const status = e?.status ?? 0;
      if (status === 409 && e?.data?.code === 'version_conflict' && entry.noteId != null) {
        // Konflikt: lokale Fassung als Entwurf erhalten, Server-Fassung bleibt
        // unangetastet — der Nutzer entscheidet beim nächsten Öffnen der Notiz.
        // Ordner der lokalen Fassung mitspeichern, damit die Wiederherstellung
        // die Notiz nicht in einem anderen Ordner einsortiert zurücklässt.
        await saveDraft(`conflict-${entry.noteId}`, {
          heading: entry.body.heading,
          content: entry.body.content,
          tags: entry.body.tags,
          ...(entry.folderId != null ? { folderId: entry.folderId } : {}),
        }).catch(() => {});
        conflicts.push(entry.noteId);
        flushed++;
        processed.add(pair);
        continue;
      }
      if (status === 404 && entry.noteId != null) {
        // Notiz wurde zwischenzeitlich woanders gelöscht — Eintrag erledigen,
        // sonst blockiert er die Queue bei jedem Flush erneut
        flushed++;
        processed.add(pair);
        continue;
      }
      if (status >= 400 && status < 500) {
        // Dauerhafter Fehler (z.B. serverseitig gesperrt, Validierung): Inhalt
        // als Entwurf erhalten und Eintrag entnehmen — eine Wiederholung würde
        // nie erfolgreich sein und alle folgenden Einträge blockieren
        const draftKey = entry.noteId != null ? `note-${entry.noteId}` : entry.key;
        await saveDraft(draftKey, entry.body).catch(() => {});
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

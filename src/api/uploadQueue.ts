import * as FileSystem from 'expo-file-system';
import { getRandomBytes } from 'expo-crypto';
import { secureSetItem, secureGetItem } from './secureStorage';
import { bytesToHex } from './crypto';
import type { PoznoteClient } from './client';

/**
 * Dauerhafte Upload-Queue (P1-8): Anhänge, deren Upload wegen Netzwerkfehlers
 * (offline, Timeout) nicht durchkam, werden nicht nur im React-State
 * gemerkt (das überlebt keinen App-Kill), sondern dauerhaft eingereiht:
 *
 * 1. Die Quelldatei (liegt nur im Cache-Verzeichnis, das iOS aufräumt) wird
 *    nach pozume-uploads/ kopiert und überlebt so App-Kill und -Neustart.
 * 2. Der Eintrag (Ziel-Notiz, Dateiname, Pfad, Größe) liegt verschlüsselt in
 *    AsyncStorage (Schlüssel in der Keychain, wie alle lokalen Daten).
 * 3. Der Upload wird beim nächsten Start/Vordergrund-Wechsel/Wiederverbindung
 *    über processUploadQueue nachgezogen — mit Duplikatschutz: Kam der erste
 *    Request auf dem Server an, ging aber die Antwort verloren, wird vor dem
 *    erneuten Hochladen geprüft, ob ein gleichnamiger Anhang gleicher Größe
 *    existiert (Name + Größe ist die beste verfügbare Signatur).
 *
 * Bei dauerhaftem Server-Fehlschlag (z.B. Dateigröße) wird der Eintrag nach
 * wenigen Versuchen entnommen — die Datei bleibt auf dem Gerät und kann
 * manuell erneut angehängt werden.
 */
const KEY = 'pozume.uploadQueue.v1';
const DIR = `${FileSystem.documentDirectory}pozume-uploads/`;

/** Dauerhaft fehlschlagende Uploads nach dieser Anzahl Versuche aufgeben */
const MAX_ATTEMPTS = 3;

export interface QueuedUpload {
  id: string;
  noteId: number;
  /** Persistente Kopie der Datei (pozume-uploads/…) */
  localPath: string;
  name: string;
  mimeType?: string;
  /** Größe in Bytes — Grundlage des Duplikatschutzes */
  size: number;
  attempts: number;
  queuedAt: number;
}

async function readAll(): Promise<QueuedUpload[]> {
  try {
    const raw = await secureGetItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function writeAll(q: QueuedUpload[]): Promise<void> {
  try { await secureSetItem(KEY, JSON.stringify(q)); } catch {}
}

/**
 * Datei dauerhaft einreihen: nach pozume-uploads/ kopieren und registrieren.
 * @returns der Eintrag oder null, wenn das Kopieren scheiterte (dann bleibt
 *          alles beim bisherigen Verhalten — Banner + manueller Retry).
 */
export async function enqueueUpload(
  noteId: number,
  file: { uri: string; name: string; mimeType?: string },
): Promise<QueuedUpload | null> {
  try {
    try { await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); } catch {}
    const ext = (file.name.match(/\.[a-z0-9]{1,6}$/i)?.[0] ?? '').toLowerCase();
    const localPath = `${DIR}${bytesToHex(getRandomBytes(12))}${ext}`;
    await FileSystem.copyAsync({ from: file.uri, to: localPath });
    const info = await FileSystem.getInfoAsync(localPath);
    const size = (info as any)?.size ?? 0;
    const entry: QueuedUpload = {
      id: bytesToHex(getRandomBytes(12)),
      noteId,
      localPath,
      name: file.name,
      mimeType: file.mimeType,
      size,
      attempts: 0,
      queuedAt: Date.now(),
    };
    const q = await readAll();
    q.push(entry);
    await writeAll(q);
    return entry;
  } catch {
    return null;
  }
}

/** Anstehende Uploads einer Notiz (Editor zeigt sie als fehlgeschlagen an) */
export async function uploadsFor(noteId: number): Promise<QueuedUpload[]> {
  const q = await readAll();
  return q.filter((e) => e.noteId === noteId);
}

/** Eintrag samt Datei entfernen (Erfolg oder endgültiges Aufgeben) */
export async function removeUpload(id: string): Promise<void> {
  const q = await readAll();
  const entry = q.find((e) => e.id === id);
  if (entry) {
    try { await FileSystem.deleteAsync(entry.localPath, { idempotent: true }); } catch {}
  }
  await writeAll(q.filter((e) => e.id !== id));
}

/** Anzahl offener Uploads (ohne Dateien zu berühren) */
export async function uploadQueueSize(): Promise<number> {
  return (await readAll()).length;
}

/**
 * Prüfen, ob der Server die Datei bereits hat — Duplikatschutz nach einem
 * verlorenen Response (Timeout): gleicher Dateiname UND gleiche Größe.
 */
async function alreadyUploaded(
  client: PoznoteClient,
  entry: QueuedUpload,
): Promise<boolean> {
  try {
    const res = await client.listAttachments(entry.noteId);
    const list = res.attachments ?? [];
    return list.some((a) =>
      (a.original_filename || a.filename) === entry.name &&
      // size 0 = Größe unbekannt (getInfoAsync fehlgeschlagen): nur der Name zählt
      (entry.size === 0 || a.file_size === entry.size),
    );
  } catch {
    return false;
  }
}

/** Versuchszähler eines Eintrags dauerhaft erhöhen (nach Fehlschlag) */
async function bumpAttempts(id: string): Promise<void> {
  const q = await readAll();
  const entry = q.find((e) => e.id === id);
  if (entry) { entry.attempts++; await writeAll(q); }
}

export interface UploadFlushResult {
  uploaded: number;
  dropped: number;
  failed: boolean;
}

/**
 * Queue abarbeiten (älteste zuerst). Bei Netzwerkfehler wird abgebrochen —
 * der Rest wartet auf den nächsten Versuch. Serverseitig abgelehnte Uploads
 * (4xx) werden nach MAX_ATTEMPTS Versuchen aufgegeben; die Anmeldung (401)
 * bricht wie ein Netzwerkfehler ab und wird beim nächsten Flush erneut
 * geprüft (dann meist 404 — Ziel weg — und damit endgültig verworfen).
 *
 * Erfolgreiche/aufgegebene Einträge werden sofort dauerhaft entfernt — ein
 * App-Kill danach kann denselben Upload nicht erneut anstoßen (kein Fenster
 * wie beim gesammelten Speichern am Ende).
 */
/**
 * In-Flight-Schutz: processUploadQueue wird beim App-Start, bei jedem
 * AppState-Wechsel und bei jedem NetInfo-Reconnect aufgerufen — ohne Flag
 * würden parallele Aufrufe dieselbe Queue lesen und denselben Eintrag doppelt
 * hochladen (der Duplikatschutz greift nicht, weil beide vor dem Upload prüfen).
 */
let processing = false;

export async function processUploadQueue(client: PoznoteClient): Promise<UploadFlushResult> {
  if (processing) return { uploaded: 0, dropped: 0, failed: false };
  processing = true;
  try {
    return await processUploadQueueInner(client);
  } finally {
    processing = false;
  }
}

async function processUploadQueueInner(client: PoznoteClient): Promise<UploadFlushResult> {
  const q = (await readAll()).sort((a, b) => a.queuedAt - b.queuedAt);
  let uploaded = 0;
  let dropped = 0;
  for (const entry of q) {
    try {
      if (await alreadyUploaded(client, entry)) {
        uploaded++;
        await removeUpload(entry.id);
        continue;
      }
      await client.uploadAttachment(entry.noteId, { uri: entry.localPath, name: entry.name, mimeType: entry.mimeType });
      uploaded++;
      await removeUpload(entry.id);
    } catch (e: any) {
      const status = e?.status ?? 0;
      if (status >= 400 && status < 500) {
        // Dauerhaft abgelehnt (z.B. zu groß): nach MAX_ATTEMPTS aufgeben
        await bumpAttempts(entry.id);
        if ((entry.attempts ?? 0) + 1 >= MAX_ATTEMPTS) {
          dropped++;
          await removeUpload(entry.id);
        }
        continue;
      }
      // Netzwerkfehler: nur Versuch zählen und abbrechen — der Eintrag bleibt
      // dauerhaft in der Queue (inkl. lokaler Datei), ein Offline-Flush darf
      // keinen Anhang verwerfen. Reihenfolge und Rest bleiben unverändert.
      await bumpAttempts(entry.id);
      return { uploaded, dropped, failed: true };
    }
  }
  return { uploaded, dropped, failed: false };
}

/** Alle Uploads samt Dateien entfernen — beim Abmelden aufrufen */
export async function clearUploadQueue(): Promise<void> {
  const q = await readAll();
  for (const entry of q) {
    try { await FileSystem.deleteAsync(entry.localPath, { idempotent: true }); } catch {}
  }
  try { await FileSystem.deleteAsync(DIR, { idempotent: true }); } catch {}
  await writeAll([]);
}

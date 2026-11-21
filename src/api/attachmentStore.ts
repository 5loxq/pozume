import * as FileSystem from 'expo-file-system';
import { secureSetItem, secureGetItem, secureEncryptBytes, secureDecryptBytes } from './secureStorage';
import { base64ToBytes } from './crypto';
import type { PoznoteClient } from './client';

/**
 * Gezielte Offline-Verfügbarkeit von Anhängen (P1-8): ausgewählte Anhänge
 * werden in das Dokumentenverzeichnis heruntergeladen und bleiben ohne
 * Verbindung öffnbar. Die Zuordnung Anhang → lokale Datei liegt verschlüsselt
 * im Manifest — und auch die DATEI selbst wird AES-verschlüsselt geschrieben
 * (verschlüsselte Ablage ist nur dann ein Schutz, wenn nicht nebenan eine
 * Klartext-Kopie in demselben Verzeichnis liegt; P0-5). Erst beim Öffnen wird
 * entschlüsselt und in eine temporäre Cache-Datei entpackt.
 * Beim Abmelden wird alles entfernt (Kontotrennung).
 */
const MANIFEST_KEY = 'pozume.attachments.v1';
const DIR = `${FileSystem.documentDirectory}pozume-attachments/`;
const ENC_PREFIX = 'enc1:';

/** attachmentId -> lokaler Dateipfad */
type Manifest = Record<string, string>;

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await secureGetItem(MANIFEST_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function writeManifest(m: Manifest): Promise<void> {
  try { await secureSetItem(MANIFEST_KEY, JSON.stringify(m)); } catch {}
}

/** Lokale Kopie eines Anhangs — Dateipfad oder null */
export async function getOfflineAttachment(attachmentId: string): Promise<string | null> {
  const m = await readManifest();
  const path = m[attachmentId];
  if (!path) return null;
  try {
    if (await FileSystem.getInfoAsync(path).then((i) => i.exists)) return path;
  } catch {}
  return null;
}

/** Anhang vom Server herunterladen und dauerhaft lokal verfügbar machen */
export async function downloadAttachmentOffline(
  client: PoznoteClient,
  noteId: number,
  att: { id: string; filename: string; original_filename?: string; file_type?: string },
): Promise<void> {
  const bytes = await client.getAttachmentBytes(noteId, att.id);
  try { await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); } catch {}
  const safeName = (att.original_filename || att.filename || 'anhang').replace(/[/\\?%*:|"<>]/g, '_');
  const path = `${DIR}${att.id}-${safeName}`;
  // Verschlüsselt schreiben (P0-5): Der Schlüssel liegt in der Keychain, die
  // Datei enthält nur Chiffre — ein Zugriff auf das Dokumentenverzeichnis
  // allein genügt nicht, den Inhalt zu lesen.
  const payload = await secureEncryptBytes(bytes);
  await FileSystem.writeAsStringAsync(path, payload, { encoding: FileSystem.EncodingType.UTF8 });
  const m = await readManifest();
  m[att.id] = path;
  await writeManifest(m);
}

/**
 * Inhalt einer Offline-Kopie lesen und entschlüsseln — die App entschlüsselt
 * erst hier und schreibt eine temporäre Klartext-Kopie (Aufrufer), die nach
 * dem Teilen im Cache-Verzeichnis bleibt (dort räumt iOS selbst auf).
 * Liefert null, wenn keine Offline-Kopie existiert oder sie lesbar zerstört ist.
 */
export async function readOfflineAttachmentBytes(attachmentId: string): Promise<Uint8Array | null> {
  const m = await readManifest();
  const path = m[attachmentId];
  if (!path) return null;
  try {
    if (!(await FileSystem.getInfoAsync(path).then((i) => i.exists))) return null;
    const raw = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 });
    // Alt: vor der Verschlüsselung direkt als Base64-Klartext abgelegte Kopien
    if (!raw.startsWith(ENC_PREFIX)) return base64ToBytes(raw);
    return await secureDecryptBytes(raw);
  } catch {
    return null;
  }
}

/** Offline-Kopie entfernen (Anhang bleibt auf dem Server) */
export async function removeOfflineAttachment(attachmentId: string): Promise<void> {
  const m = await readManifest();
  const path = m[attachmentId];
  if (path) {
    try { await FileSystem.deleteAsync(path, { idempotent: true }); } catch {}
  }
  delete m[attachmentId];
  await writeManifest(m);
}

/** Alle Offline-Kopien entfernen — beim Abmelden/Kontowechsel aufrufen */
export async function clearOfflineAttachments(): Promise<void> {
  const m = await readManifest();
  for (const path of Object.values(m)) {
    try { await FileSystem.deleteAsync(path, { idempotent: true }); } catch {}
  }
  try { await FileSystem.deleteAsync(DIR, { idempotent: true }); } catch {}
  await writeManifest({});
}

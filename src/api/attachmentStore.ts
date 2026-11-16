import * as FileSystem from 'expo-file-system';
import { secureSetItem, secureGetItem } from './secureStorage';
import type { PoznoteClient } from './client';

/**
 * Gezielte Offline-Verfügbarkeit von Anhängen (P1-8): ausgewählte Anhänge
 * werden in das Dokumentenverzeichnis heruntergeladen und bleiben ohne
 * Verbindung öffnbar. Die Zuordnung Anhang → lokale Datei liegt verschlüsselt
 * im Manifest; beim Abmelden wird alles entfernt (Kontotrennung).
 */
const MANIFEST_KEY = 'pozume.attachments.v1';
const DIR = `${FileSystem.documentDirectory}pozume-attachments/`;

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
  // Base64 in Chunks schreiben (große Dateien sprengen sonst den String)
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  await FileSystem.writeAsStringAsync(path, btoa(binary), { encoding: FileSystem.EncodingType.Base64 });
  const m = await readManifest();
  m[att.id] = path;
  await writeManifest(m);
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

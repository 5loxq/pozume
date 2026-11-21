import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { clearDataKey } from './secureStorage';
import { clearOfflineAttachments } from './attachmentStore';
import { clearUploadQueue } from './uploadQueue';

/**
 * Kontotrennung: Alle lokal gespeicherten Inhalte der aktuellen Sitzung
 * entfernen — Cache, Entwürfe, Offline-Queue, Zeichnungen, Erinnerungen.
 * Aufgerufen beim Abmelden und beim Wechsel auf einen anderen Server/Account,
 * damit ein neues Konto niemals Notizen, Suchtreffer oder Anhänge des
 * vorherigen sieht.
 *
 * Geräte-Einstellungen (Sprache, Theme, Listen-Präferenz Sortierung/Filter)
 * bleiben erhalten — sie enthalten keine Kontodaten.
 */
const DATA_KEYS = [
  'pozume.cache.notes.v1',
  'pozume.cache.folders.v1',
  'pozume.drawings.v1',
  'pozume.offlineQueue.v1',
  'pozume.createdIds.v1',
  'pozume.reminders.v1',
  'pozume.drafts.v1',
  'pozume.crashlog.v1',
  'pozume.uploadQueue.v1',
  'pozume.attachments.v1',
];

/** SecureStore-Keys mit Konto-Bezug (Notiz-Sperren des alten Kontos) */
const SECURE_DATA_KEYS = [
  'pozume.noteLock.locked', // Notiz-IDs — kollidieren sonst mit IDs des neuen Kontos
  'pozume.noteLock.retry.all', // globaler Fehlversuch-Zähler
];

export async function clearAllLocalData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(DATA_KEYS);
  } catch {}
  try {
    for (const k of SECURE_DATA_KEYS) await SecureStore.deleteItemAsync(k);
  } catch {}
  // Geplante lokale Erinnerungen stornieren (gehören zum Konto-Inhalt)
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
  // Heruntergeladene Offline-Anhänge und wartende Uploads entfernen
  await clearOfflineAttachments();
  await clearUploadQueue();
  // Verschlüsselungsschlüssel verwerfen — ein neues Konto startet mit neuem Schlüssel
  await clearDataKey();
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

/**
 * Kontotrennung: Alle lokal gespeicherten Inhalte der aktuellen Sitzung
 * entfernen — Cache, Entwürfe, Offline-Queue, Zeichnungen, Erinnerungen.
 * Aufgerufen beim Abmelden und beim Wechsel auf einen anderen Server/Account,
 * damit ein neues Konto niemals Notizen, Suchtreffer oder Anhänge des
 * vorherigen sieht.
 *
 * Geräte-Einstellungen (Sprache, Theme) bleiben erhalten — sie enthalten
 * keine Kontodaten.
 */
const DATA_KEYS = [
  'pozume.cache.notes.v1',
  'pozume.cache.folders.v1',
  'pozume.drawings.v1',
  'pozume.offlineQueue.v1',
  'pozume.createdIds.v1',
  'pozume.reminders.v1',
  'pozume.drafts.v1',
  'pozume.list.prefs',
  'pozume.crashlog.v1',
];

export async function clearAllLocalData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(DATA_KEYS);
  } catch {}
  // Geplante lokale Erinnerungen stornieren (gehören zum Konto-Inhalt)
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
}

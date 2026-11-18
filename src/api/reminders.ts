import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const KEY = 'pozume.reminders.v1';
/** noteId -> { when: ISO-Zeit, notificationId: geplante Notification } */
type Map = Record<number, { when: string; notificationId: string }>;

async function readAll(): Promise<Map> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : {};
}

async function writeAll(m: Map): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(m));
}

/** Erinnerung fuer eine Notiz setzen (Zeit ISO-String) */
export async function setReminder(noteId: number, title: string, whenIso: string): Promise<void> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') throw new Error('no-permission');
  const date = new Date(whenIso);
  // Guard: Vergangene (oder ungültige) Zeitpunkte nicht schedeln —
  // expo-notifications feuert sonst sofort.
  if (isNaN(date.getTime()) || date.getTime() <= Date.now()) throw new Error('in-past');
  // Erst die neue Notification schedulen, DANN die alte canceln: Schlägt das
  // Schedulen fehl, bleibt die alte Erinnerung aktiv, statt dass beide weg sind.
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: { title: '🪶 Pozume', body: `Erinnerung: ${title}` },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date } as any,
  });
  const m = await readAll();
  const oldId = m[noteId]?.notificationId;
  if (oldId && oldId !== notificationId) {
    await Notifications.cancelScheduledNotificationAsync(oldId).catch(() => {});
  }
  m[noteId] = { when: whenIso, notificationId };
  await writeAll(m);
}

export async function removeReminder(noteId: number): Promise<void> {
  const m = await readAll();
  const entry = m[noteId];
  if (entry?.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(entry.notificationId).catch(() => {});
  }
  delete m[noteId];
  await writeAll(m);
}

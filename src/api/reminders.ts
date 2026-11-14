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
  // Alte Notification der Notiz zuerst canceln, sonst feuern beide
  await removeReminder(noteId);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: { title: '🪶 Pozume', body: `Erinnerung: ${title}` },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(whenIso) } as any,
  });
  const m = await readAll();
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

export async function getReminder(noteId: number): Promise<string | null> {
  const m = await readAll();
  return m[noteId]?.when ?? null;
}

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
type Map = Record<number, string>; // noteId -> ISO-Zeit

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
  await Notifications.scheduleNotificationAsync({
    content: { title: '🪶 Pozume', body: `Erinnerung: ${title}` },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(whenIso) } as any,
  });
  const m = await readAll();
  m[noteId] = whenIso;
  await writeAll(m);
}

export async function removeReminder(noteId: number): Promise<void> {
  const m = await readAll();
  delete m[noteId];
  await writeAll(m);
}

export async function getReminder(noteId: number): Promise<string | null> {
  const m = await readAll();
  return m[noteId] ?? null;
}

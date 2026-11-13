import * as SecureStore from 'expo-secure-store';

const PIN_KEY = 'pozume.noteLock.pin';
const LOCKED_KEY = 'pozume.noteLock.locked'; // JSON-Array noteIds

export async function hasPin(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(PIN_KEY));
}

export async function setPin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(PIN_KEY, pin);
}

export async function verifyPin(pin: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN_KEY)) === pin;
}

async function readLocked(): Promise<number[]> {
  const raw = await SecureStore.getItemAsync(LOCKED_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeLocked(ids: number[]): Promise<void> {
  await SecureStore.setItemAsync(LOCKED_KEY, JSON.stringify(ids));
}

export async function lockNote(noteId: number): Promise<void> {
  const ids = await readLocked();
  if (!ids.includes(noteId)) { ids.push(noteId); await writeLocked(ids); }
}

export async function unlockNoteRecord(noteId: number): Promise<void> {
  const ids = await readLocked();
  await writeLocked(ids.filter((id) => id !== noteId));
}

export async function isNoteLocked(noteId: number): Promise<boolean> {
  const ids = await readLocked();
  return ids.includes(noteId);
}

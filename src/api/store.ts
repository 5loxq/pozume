import * as SecureStore from 'expo-secure-store';

const KEY = 'pozume.server';

export interface StoredServer {
  baseUrl: string;
  username: string;
  password: string;
  userId?: string;
}

export async function saveServer(cfg: StoredServer): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg));
}

export async function loadServer(): Promise<StoredServer | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? JSON.parse(raw) as StoredServer : null;
}

export async function clearServer(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** App-Lock-Einstellung */
const LOCK_KEY = 'pozume.appLock';
export async function setAppLock(enabled: boolean) {
  await SecureStore.setItemAsync(LOCK_KEY, enabled ? '1' : '0');
}
export async function getAppLock(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LOCK_KEY)) === '1';
}

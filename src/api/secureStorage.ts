import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import { aesCtr, utf8Encode, utf8Decode, bytesToHex, hexToBytes, bytesToBase64, base64ToBytes } from './crypto';

/**
 * Verschlüsselter AsyncStorage: schützt Cache, Entwürfe, Offline-Queue und
 * Zeichnungen vor direktem Auslesen (P0-5). Der 256-Bit-Schlüssel liegt in
 * der iOS-Keychain (SecureStore) und verlässt das Gerät nicht.
 *
 * Format: "enc1:<iv-Base64>.<ciphertext-Base64>" (AES-256-CTR).
 * Werte ohne Präfix sind Alt-Klartexte und werden zur Migration noch gelesen.
 */
const KEY_NAME = 'pozume.datakey';
const PREFIX = 'enc1:';

let keyPromise: Promise<Uint8Array> | null = null;

async function getDataKey(): Promise<Uint8Array> {
  if (keyPromise == null) {
    keyPromise = (async () => {
      let hex = await SecureStore.getItemAsync(KEY_NAME);
      if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
        hex = bytesToHex(getRandomBytes(32));
        await SecureStore.setItemAsync(KEY_NAME, hex);
      }
      return hexToBytes(hex);
    })().catch((e) => {
      keyPromise = null;
      throw e;
    });
  }
  return keyPromise;
}

/** Wert verschlüsselt ablegen */
export async function secureSetItem(key: string, value: string): Promise<void> {
  const dataKey = await getDataKey();
  const iv = getRandomBytes(16);
  const ct = aesCtr(dataKey, iv, utf8Encode(value));
  await AsyncStorage.setItem(key, `${PREFIX}${bytesToBase64(iv)}.${bytesToBase64(ct)}`);
}

/**
 * Wert lesen und entschlüsseln.
 * Rückgabewerte: entschlüsselter Text, null (nicht vorhanden) oder bei
 * Beschädigung/Fremdschlüssel ebenfalls null (Cache wird neu aufgebaut).
 * Klartext-Altwerte ohne Präfix werden zur Migration unverändert geliefert.
 */
export async function secureGetItem(key: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return null;
  if (!raw.startsWith(PREFIX)) return raw;
  try {
    const dot = raw.indexOf('.', PREFIX.length);
    if (dot < 0) return null;
    const iv = base64ToBytes(raw.slice(PREFIX.length, dot));
    const ct = base64ToBytes(raw.slice(dot + 1));
    if (iv.length !== 16 || ct.length === 0) return null;
    const dataKey = await getDataKey();
    return utf8Decode(aesCtr(dataKey, iv, ct));
  } catch {
    return null;
  }
}

/** Schlüssel für Verschlüsselung und gespeicherte Zugangsdaten entfernen (Logout) */
export async function clearDataKey(): Promise<void> {
  keyPromise = null;
  try { await SecureStore.deleteItemAsync(KEY_NAME); } catch {}
}

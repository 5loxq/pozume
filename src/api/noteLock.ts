import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const PIN_KEY = 'pozume.noteLock.pin';
const LOCKED_KEY = 'pozume.noteLock.locked'; // JSON-Array noteIds

/** Rate-Limit je Notiz (bzw. global, wenn ohne noteId geprüft wird) */
const retryKey = (noteId?: number) => `pozume.noteLock.retry.${noteId ?? 'all'}`;
/** 5 Fehlversuche sperren die Prüfung 60 s */
const MAX_FAILS = 5;
const LOCKOUT_MS = 60_000;

/** Zufalls-Salt als Hex-String (expo-crypto getRandomBytes) */
function randomSaltHex(): string {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Salted SHA-256 des PIN (digestStringAsync liefert standardmäßig Hex) */
function hashPin(pin: string, saltHex: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${saltHex}:${pin}`);
}

export async function hasPin(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(PIN_KEY));
}

/** PIN speichern — nur als salted SHA-256-Hash, nie im Klartext */
export async function setPin(pin: string): Promise<void> {
  const salt = randomSaltHex();
  const hash = await hashPin(pin, salt);
  await SecureStore.setItemAsync(PIN_KEY, `sha256:${salt}:${hash}`);
}

interface RetryState { fails: number; lockedUntil: number }

async function readRetry(key: string): Promise<RetryState | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function writeRetry(key: string, s: RetryState): Promise<void> {
  try { await SecureStore.setItemAsync(key, JSON.stringify(s)); } catch {}
}

async function clearRetry(key: string): Promise<void> {
  try { await SecureStore.deleteItemAsync(key); } catch {}
}

/**
 * Verbleibende Lockout-Sekunden für eine Notiz (0 = keine Sperre).
 * Ohne noteId wird der globale Zähler abgefragt.
 */
export async function pinRetryDelay(noteId?: number): Promise<number> {
  const key = retryKey(noteId);
  const s = await readRetry(key);
  if (!s?.lockedUntil) return 0;
  const remaining = Math.ceil((s.lockedUntil - Date.now()) / 1000);
  if (remaining <= 0) {
    // Abgelaufene Sperre aufräumen, damit der Zähler neu beginnt
    await clearRetry(key);
    return 0;
  }
  return remaining;
}

/**
 * PIN prüfen. Der optionale noteId-Parameter schlüsselt den Fehlversuch-
 * Zähler je Notiz; ohne ihn gilt ein gemeinsamer Zähler (ein PIN schützt
 * alle gesperrten Notizen). Während des Lockouts wird immer false
 * geliefert, ohne den Hash überhaupt zu berechnen.
 *
 * Backward-Kompatibilität: Ist der gespeicherte Wert noch ein Klartext-PIN
 * (Muster ^\d{4,8}$), wird direkt verglichen und bei Erfolg automatisch auf
 * das Hash-Format migriert.
 */
export async function verifyPin(pin: string, noteId?: number): Promise<boolean> {
  const key = retryKey(noteId);
  if ((await pinRetryDelay(noteId)) > 0) return false;

  const stored = await SecureStore.getItemAsync(PIN_KEY);
  if (!stored) return false;

  let ok = false;
  if (/^\d{4,8}$/.test(stored)) {
    // Alter Klartext-PIN: direkt vergleichen, bei Erfolg auf Hash migrieren
    ok = stored === pin;
    if (ok) await setPin(pin);
  } else {
    const m = stored.match(/^sha256:([0-9a-f]+):([0-9a-f]+)$/);
    if (m) ok = (await hashPin(pin, m[1])) === m[2];
  }

  if (ok) {
    await clearRetry(key);
  } else {
    const s = (await readRetry(key)) ?? { fails: 0, lockedUntil: 0 };
    const fails = (s.fails ?? 0) + 1;
    if (fails >= MAX_FAILS) {
      // Lockout setzen und Zähler zurücksetzen (Sperre gilt danach als Strafe)
      await writeRetry(key, { fails: 0, lockedUntil: Date.now() + LOCKOUT_MS });
    } else {
      await writeRetry(key, { fails, lockedUntil: 0 });
    }
  }
  return ok;
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

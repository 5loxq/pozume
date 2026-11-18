import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureSetItem, secureGetItem } from './secureStorage';

/**
 * Lokales Absturzprotokoll: nicht abgefangene JS-Fehler werden mit Zeitstempel
 * verschlüsselt festgehalten (die letzten 20) und sind in den Einstellungen
 * einsehbar — ein Mindestmaß an Diagnose ohne Cloud-Dienst.
 */
const KEY = 'pozume.crashlog.v1';
const MAX_ENTRIES = 20;

export interface CrashEntry {
  t: number;
  message: string;
  stack?: string;
  fatal?: boolean;
}

async function readAll(): Promise<CrashEntry[]> {
  try {
    const raw = await secureGetItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function readCrashLog(): Promise<CrashEntry[]> {
  return (await readAll()).sort((a, b) => b.t - a.t);
}

export async function clearCrashLog(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch {}
}

/**
 * Noch nicht sicher persistierter Fehler: Bei einem Fatal-Crash stirbt das
 * asynchrone Write mit dem Prozess — der Eintrag bleibt dann hier geparkt
 * und wird beim nächsten Handler-Lauf mitgeschrieben.
 *
 * Restriktion (ehrlich): Vollständig synchrone Persistenz ist in React
 * Native nicht möglich — AsyncStorage/SecureStore sind rein asynchron, ein
 * synchroner Dateizugriff existiert nicht. Der garantiert synchrone Anteil
 * ist das console.error (landet im Systemlog, z.B. adb logcat / Xcode).
 */
let parkedEntry: CrashEntry | null = null;

/** Globalen Fehler-Hook installieren (einmal beim App-Start aufrufen) */
export function installCrashHandler(): void {
  const g = global as any;
  if (!g.ErrorUtils?.setGlobalHandler) return;
  const prev = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    // Meldungen kürzen: Fehlerprotokolle dürfen keine vollständigen
    // Notizinhalte enthalten (z.B. wenn ein Server sie zurückgibt)
    const entry: CrashEntry = {
      t: Date.now(),
      message: String(error?.message ?? error).slice(0, 300),
      stack: error?.stack?.slice(0, 2000),
      fatal: !!isFatal,
    };
    // Synchron: landet zumindest im Systemlog, auch wenn der Prozess
    // direkt danach stirbt und das persistente Write nie fertig wird
    console.error(`[crash${isFatal ? ' fatal' : ''}] ${entry.message}`, entry.stack ?? '');
    // Beim letzten Lauf geparkten Fehler mitgeschreiben (falls dessen
    // Write dem Crash zum Opfer gefallen ist); aktuellen danach parken
    const prevParked = parkedEntry;
    parkedEntry = entry;
    readAll()
      .then((entries) => {
        const next = [...entries, ...(prevParked ? [prevParked] : []), entry].slice(-MAX_ENTRIES);
        return secureSetItem(KEY, JSON.stringify(next));
      })
      .then(() => {
        // Erfolgreich persistiert — nur den eigenen Eintrag ausparken
        // (ein zwischenzeitlich neu geparkter bleibt stehen)
        if (parkedEntry === entry) parkedEntry = null;
      })
      .catch(() => {});
    prev?.(error, isFatal);
  });
}

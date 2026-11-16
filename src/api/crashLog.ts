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

/** Globalen Fehler-Hook installieren (einmal beim App-Start aufrufen) */
export function installCrashHandler(): void {
  const g = global as any;
  if (!g.ErrorUtils?.setGlobalHandler) return;
  const prev = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    readAll()
      .then((entries) => {
        const next = [
          ...entries,
          // Meldungen kürzen: Fehlerprotokolle dürfen keine vollständigen
          // Notizinhalte enthalten (z.B. wenn ein Server sie zurückgibt)
          { t: Date.now(), message: String(error?.message ?? error).slice(0, 300), stack: error?.stack?.slice(0, 2000), fatal: !!isFatal },
        ].slice(-MAX_ENTRIES);
        return secureSetItem(KEY, JSON.stringify(next));
      })
      .catch(() => {});
    prev?.(error, isFatal);
  });
}

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Lokales Absturzprotokoll: nicht abgefangene JS-Fehler werden mit Zeitstempel
 * in AsyncStorage festgehalten (die letzten 20) und sind in den Einstellungen
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
    const raw = await AsyncStorage.getItem(KEY);
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
          { t: Date.now(), message: String(error?.message ?? error), stack: error?.stack?.slice(0, 2000), fatal: !!isFatal },
        ].slice(-MAX_ENTRIES);
        return AsyncStorage.setItem(KEY, JSON.stringify(next));
      })
      .catch(() => {});
    prev?.(error, isFatal);
  });
}

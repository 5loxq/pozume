import { requireNativeModule } from 'expo-modules-core';

/**
 * App-Group-Name: gemeinsamer Speicher von Haupt-App, Widget und Share-Extension.
 * Muss identisch zu den Entitlements aller drei Targets sein.
 */
export const APP_GROUP = 'group.de.inthielligent.pozume';

/** Schlüssel, unter dem die Server-Konfiguration (JSON) in der App Group liegt. */
const SERVER_CONFIG_KEY = 'pozume.server';

/** Signatur des nativen PozumeAppGroup-Moduls (Swift-Seite). */
type PozumeAppGroupModule = {
  saveValue(key: string, value: string): boolean;
  readValue(key: string): string | null;
  removeValue(key: string): boolean;
};

let nativeModule: PozumeAppGroupModule | null = null;

/**
 * Liefert das native Modul, oder null, wenn es nicht verfügbar ist
 * (z.B. in Expo Go oder wenn die native Seite fehlt).
 * Wird einmalig gelöst und dann gecacht.
 */
function mod(): PozumeAppGroupModule | null {
  if (nativeModule != null) return nativeModule;
  try {
    nativeModule = requireNativeModule('PozumeAppGroup') as unknown as PozumeAppGroupModule;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

/**
 * Schreibt einen String-Wert in die App Group.
 * @returns true bei Erfolg, false wenn das native Modul fehlt oder der Schreibvorgang scheitert.
 */
export function saveValue(key: string, value: string): boolean {
  try {
    return mod()?.saveValue(key, value) ?? false;
  } catch {
    return false;
  }
}

/**
 * Liest einen String-Wert aus der App Group.
 * @returns der Wert oder null, wenn er nicht existiert bzw. das native Modul fehlt.
 */
export function readValue(key: string): string | null {
  try {
    return mod()?.readValue(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Löscht einen Wert aus der App Group.
 * @returns true bei Erfolg, false wenn das native Modul fehlt oder das Löschen scheitert.
 */
export function removeValue(key: string): boolean {
  try {
    return mod()?.removeValue(key) ?? false;
  } catch {
    return false;
  }
}

/**
 * Server-Konfiguration (als JSON) für Widget und Share-Extension in die App Group schreiben.
 * Wird beim Login/Boot der Haupt-App aufgerufen; Widget und Extension lesen sie
 * direkt (UserDefaults) und reden damit selbst mit dem PozNote-Server.
 * @returns true bei Erfolg.
 */
export function saveServerConfig(cfg: { baseUrl: string; username: string; password: string }): boolean {
  return saveValue(SERVER_CONFIG_KEY, JSON.stringify(cfg));
}

/**
 * Server-Konfiguration aus der App Group löschen — beim Logout aufrufen,
 * damit Widget und Extension keine gültigen Zugangsdaten mehr haben.
 * @returns true bei Erfolg.
 */
export function clearServerConfig(): boolean {
  return removeValue(SERVER_CONFIG_KEY);
}

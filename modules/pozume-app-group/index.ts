import { requireNativeModule } from 'expo-modules-core';

/**
 * App-Group-Name: gemeinsamer Speicher von Haupt-App, Widget und Share-Extension.
 * Muss identisch zu den Entitlements aller drei Targets sein.
 */
export const APP_GROUP = 'group.de.inthielligent.pozume';

/**
 * Schlüssel, unter dem die unkritische Server-Konfiguration (baseUrl +
 * Benutzername, JSON) in der App Group liegt. Das Passwort liegt NICHT hier,
 * sondern verschlüsselt in der gemeinsamen Keychain.
 */
const SERVER_CONFIG_KEY = 'pozume.server';

/** Signatur des nativen PozumeAppGroup-Moduls (Swift-Seite). */
type PozumeAppGroupModule = {
  saveValue(key: string, value: string): boolean;
  readValue(key: string): string | null;
  removeValue(key: string): boolean;
  savePassword(value: string): boolean;
  readPassword(): string | null;
  clearPassword(): boolean;
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
 * Speichert das Server-Passwort verschlüsselt in der gemeinsamen Keychain
 * (Access Group) — von Widget und Share-Extension direkt lesbar, taucht
 * aber nicht in Klartext in Backups auf.
 * @returns true bei Erfolg.
 */
export function savePassword(password: string): boolean {
  try {
    return mod()?.savePassword(password) ?? false;
  } catch {
    return false;
  }
}

/**
 * Löscht das Server-Passwort aus der Keychain.
 * @returns true bei Erfolg.
 */
export function clearPassword(): boolean {
  try {
    return mod()?.clearPassword() ?? false;
  } catch {
    return false;
  }
}

/**
 * Server-Zugangsdaten für Widget und Share-Extension verteilen:
 * baseUrl + Benutzername gehen als JSON in die App Group (unkritisch),
 * das Passwort in die verschlüsselte gemeinsame Keychain.
 * Wird beim Login/Boot der Haupt-App aufgerufen.
 * @returns true, wenn beide Schreibvorgänge erfolgreich waren.
 */
export function saveServerConfig(cfg: { baseUrl: string; username: string; password: string }): boolean {
  const groupOk = saveValue(SERVER_CONFIG_KEY, JSON.stringify({ baseUrl: cfg.baseUrl, username: cfg.username }));
  const keychainOk = savePassword(cfg.password);
  return groupOk && keychainOk;
}

/**
 * Alle verteilten Zugangsdaten löschen — beim Logout aufrufen,
 * damit Widget und Share-Extension keine gültigen Zugänge mehr haben.
 * @returns true, wenn beide Löschvorgänge erfolgreich waren.
 */
export function clearServerConfig(): boolean {
  const groupOk = removeValue(SERVER_CONFIG_KEY);
  const keychainOk = clearPassword();
  return groupOk && keychainOk;
}

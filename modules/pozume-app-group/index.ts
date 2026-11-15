import { requireNativeModule } from 'expo-modules-core';

/**
 * Zugriff auf die App Group (group.de.inthielligent.pozume):
 * Die Haupt-App schreibt die Server-Konfiguration hierher, damit
 * Widget und Share-Extension sich direkt beim PozNote-Server anmelden können.
 */
const APP_GROUP = 'group.de.inthielligent.pozume';

type PozumeAppGroupModule = {
  saveValue(key: string, value: string): boolean;
  readValue(key: string): string | null;
  removeValue(key: string): boolean;
};

let nativeModule: PozumeAppGroupModule | null = null;
function mod(): PozumeAppGroupModule | null {
  if (nativeModule != null) return nativeModule;
  try {
    nativeModule = requireNativeModule('PozumeAppGroup') as unknown as PozumeAppGroupModule;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

export function saveValue(key: string, value: string): boolean {
  try {
    return mod()?.saveValue(key, value) ?? false;
  } catch {
    return false;
  }
}

export function readValue(key: string): string | null {
  try {
    return mod()?.readValue(key) ?? null;
  } catch {
    return null;
  }
}

export function removeValue(key: string): boolean {
  try {
    return mod()?.removeValue(key) ?? false;
  } catch {
    return false;
  }
}

/** Server-Konfiguration (JSON) für Widget/Share-Extension in die App Group schreiben */
export function saveServerConfig(cfg: { baseUrl: string; username: string; password: string }): boolean {
  return saveValue('pozume.server', JSON.stringify(cfg));
}

export function clearServerConfig(): boolean {
  return removeValue('pozume.server');
}

export { APP_GROUP };

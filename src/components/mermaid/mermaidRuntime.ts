import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { diagramHtml } from './mermaidHtml';

/**
 * Mermaid-Bibliothek als gebündeltes Asset (Metro assetExts: 'mjs').
 * Zur Laufzeit wird sie einmal in das Cache-Verzeichnis kopiert und von der
 * WebView über file:// geladen — kein CDN, keine Netzwerkzugriffe.
 */
const MERMAID_ASSET = require('../../../assets/mermaid.min.mjslib');

const DIR = `${FileSystem.cacheDirectory}pozume-mermaid/`;
const HTML_PATH = `${DIR}renderer.html`;
const JS_PATH = `${DIR}mermaid.min.js`;

let readyPromise: Promise<string> | null = null;

async function exists(path: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(path)).exists;
  } catch {
    return false;
  }
}

async function prepare(): Promise<string> {
  if (!(await exists(JS_PATH))) {
    const asset = Asset.fromModule(MERMAID_ASSET);
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Mermaid-Asset nicht im Paket gefunden');
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
    await FileSystem.copyAsync({ from: asset.localUri, to: JS_PATH });
  } else {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
  // Renderer-HTML bei jedem Start neu schreiben (Update des Templates ohne
  // Versionswechsel am Dateinamen möglich)
  await FileSystem.writeAsStringAsync(HTML_PATH, diagramHtml(true), { encoding: FileSystem.EncodingType.UTF8 });
  return HTML_PATH;
}

/** Einmalig Renderer vorbereiten; liefert die file://-URL von renderer.html. */
export function ensureRenderer(): Promise<string> {
  if (!readyPromise) {
    readyPromise = prepare().catch((e) => {
      readyPromise = null;
      throw e;
    });
  }
  return readyPromise;
}

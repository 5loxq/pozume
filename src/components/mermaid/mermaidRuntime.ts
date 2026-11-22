import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { diagramHtml } from './mermaidHtml';

/**
 * Mermaid-Bibliothek als gebündeltes Asset (Metro assetExts: 'mjslib').
 * Zur Laufzeit wird ihre Quelldatei gelesen und INLINIERT in die renderer.html
 * geschrieben (eine einzige selbstenthaltene Datei) — WKWebView unter file://
 * lädt Geschwister-Skripte nicht zuverlässig, INLINE-Code läuft immer.
 * Kein CDN, keine Netzwerkzugriffe.
 */
const MERMAID_ASSET = require('../../../assets/mermaid.min.mjslib');

const DIR = `${FileSystem.cacheDirectory}pozume-mermaid/`;
const HTML_PATH = `${DIR}renderer.html`;

let readyPromise: Promise<string> | null = null;

async function prepare(): Promise<string> {
  const asset = Asset.fromModule(MERMAID_ASSET);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('Mermaid-Asset nicht im Paket gefunden');
  const source = await FileSystem.readAsStringAsync(asset.localUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (!source || source.length < 1_000_000) {
    throw new Error('Mermaid-Asset unvollständig');
  }
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  // Renderer-HTML bei jedem Start neu schreiben (Template-Updates ohne
  // Versionswechsel am Dateinamen möglich)
  await FileSystem.writeAsStringAsync(HTML_PATH, diagramHtml(source), {
    encoding: FileSystem.EncodingType.UTF8,
  });
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

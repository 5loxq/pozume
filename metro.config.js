const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Mermaid-Bibliothek (assets/mermaid.min.mjs) als rohes Asset bündeln,
// damit sie zur Laufzeit ohne CDN aus dem App-Paket geladen werden kann.
// assetExts haben im Metro-Resolver Vorrang vor sourceExts, daher wird die
// Datei trotz .mjs-Endung als Asset kopiert und nicht als JS-Modul geparst.
config.resolver.assetExts.push('mjs');

module.exports = config;

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Mermaid-Bibliothek (assets/mermaid.min.mjslib) als rohes Asset bündeln,
// damit sie zur Laufzeit ohne CDN aus dem App-Paket geladen werden kann.
// Bewusst eine PRIVATE Endung (.mjslib): 'mjs' global zu assetExts hinzuzufügen
// würde auch ESM-Einträge echter Pakete (abort-controller, event-target-shim,
// NetInfo-Abhängigkeiten) zu Assets machen und deren Code still ersetzen.
// assetExts haben im Metro-Resolver Vorrang vor sourceExts.
config.resolver.assetExts.push('mjslib');

module.exports = config;

# Pozume

Eigener iOS/Android-Client für Poznote. Deutsch & Englisch von Tag 1.

## Setup (Mac)
```bash
npm install
npm run ios      # iOS-Simulator / Gerät
npm run android  # optional
```

## Architektur
- `src/i18n/` — DE/EN-Wörterbücher, Auto-Erkennung der Systemsprache
- `src/api/` — Poznote REST-Client (Basic Auth + X-User-ID)
- `src/screens/` — Screens (Login fertig, Notizliste als Nächstes)

## Poznote-API
- Base: `https://<server>/api/v1`
- Auth: Basic + `X-User-ID` Header
- App-Passwords werden empfohlen (Poznote ≥ 6.84)

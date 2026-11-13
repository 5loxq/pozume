# Pozume 🪶

**A native iOS & Android app for [Poznote](https://github.com/timothepoznanski/poznote)** — the free, self-hosted note-taking platform.

Pozume connects to your **own** Poznote server. Your notes stay on your hardware — no cloud, no trackers, no third parties.

> Pozume ist eine inoffizielle Community-App und steht in keiner Verbindung zum Poznote-Projekt.

## Features

- 📓 **Notes** — create, edit, autosave (1.2 s after last keystroke), delete to trash
- 🔍 **Instant search** across titles and content, debounced, live-filtered
- ★ **Favorites** — filter chips + one-tap toggle in the editor
- 📁 **Folders** — browse, create, per-folder note lists, move notes via bottom sheet
- 🏷 **Tags** — colored chips, tap a tag to see all notes with it
- 📝 **Markdown preview** — toggle between writing and reading (headings, lists, bold, code, quotes)
- 🗑 **Trash** — view, restore, delete forever
- 📤 **Share sheet** — share any note as formatted text
- ⚙️ **Settings** — app lock toggle, language override, server info, sign out
- 🔄 **Sorting** — last updated, created, title A–Z
- 🔢 **Word count & reading time** in the editor
- 📴 **Offline-first** — last known state from local cache, background refresh
- 🔒 **Security** — Face ID / Touch ID app lock, credentials in the iOS Keychain (SecureStore), app-password ready
- 🌍 **Bilingual from day one** — German & English, auto-detection + manual override, live switching
- 🎨 **Own design system** — indigo/ivory palette, colored tag chips, time-of-day greeting, haptic feedback

## Getting started

**Prerequisites:** Node.js, Xcode (iOS) or Android Studio.

```bash
git clone https://github.com/5loxq/poznote.git pozume
cd pozume
npm install
npm run ios        # iOS simulator / device
npm run android    # optional
```

1. Create an **app password** in your Poznote account (Poznote ≥ 6.84 recommended)
2. Enter your server URL (e.g. `https://notes.example.com`), username and app password
3. Done — Pozume stores the credentials securely and reconnects automatically

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React Native + Expo (TypeScript, strict) |
| i18n | Custom DE/EN dictionaries, auto-detection |
| API | Poznote REST v1 (Basic Auth + `X-User-ID`) |
| Storage | expo-secure-store (credentials), AsyncStorage (offline cache) |
| Auth | expo-local-authentication (Face ID / Touch ID) |

## Project structure

```
src/
├── api/          # Poznote REST client, secure credential store, offline cache
├── components/   # Note cards, shared UI
├── i18n/         # DE/EN dictionaries + template-variable support
├── screens/      # Login, Notes list, Editor, Folders, Trash, Lock
└── theme.ts      # Design tokens: colors, spacing, typography, tag palette
```

## Roadmap

- [ ] Android build + adaptive icon
- [ ] App Store / Play Store release

## License

MIT — see [LICENSE](LICENSE) (bilingual: English & Deutsch). Copyright 5loxq.

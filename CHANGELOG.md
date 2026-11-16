# Changelog

Kommentierung aller Vorgänge der Pozume-Entwicklung (neueste zuerst).
Entspricht den Git-Notizen (git notes) der jeweiligen Commits.

## 2026-11-16 — P0/P1/P2-Abarbeitung: Verschluesselung, Redirect-Schutz, Ordnerhierarchie, Kamera, Share-Flow, Pagination, Notizlinks

*Commit `63de35c`*

Gesamtabarbeitung der restlichen Punkte der Entwicklungsliste gegen den Live-Server: P0-5 Verschluesselung aller lokalen Daten (AES-256-CTR, Schluessel in der Keychain, gegen Node-Referenz verifiziert), P0-4 Redirect-Schutz, P1-9 Ordnerhierarchie/Umbenennen/Verschieben, P1-8 Kamera/Upload-Wiederholung/Offline-Anhaenge, P1-12 Share-Extension mit Ordner-/Tag-Auswahl in der App, P1-10 Tag-Vorschlaege, P1-14 Pagination + Cache-Begrenzung, P1-11 Snapshot vor Wiederherstellung, P1-13 Faelligkeit setzen, P2-16 Notizlinks, P2-17 Freigabe-Erklaerung. Verifikation: tsc fehlerfrei, Smoke-Test 22/22.

## 2026-11-16 — Changelog: Kommentierung aller Vorgaenge als normale Datei im Repo

*Commit `0bcb675`*

Changelog.md als normale Datei im Repository: dokumentiert alle bisherigen 42 Vorgaenge (Datum, Commit, Erklaerung) — dieselben Inhalte wie die Git-Notizen, aber ohne Sonderbehandlung beim Push.

## 2026-11-16 — Version 0.6.0 (iOS Build 4)

*Commit `bf1a2b0`*

Versionshub auf 0.6.0: app.json (expo.version) und package.json synchron angehoben, iOS-Build-Nummer auf 4 erhoeht (Voraussetzung fuer Update-Installation), package-lock.json mitgezogen. Der Versionshinweis in den Einstellungen liest die Nummer dynamisch aus der Expo-Konfiguration.

## 2026-11-16 — P0/P1-Nachrunde: Offline-Loeschung, Doppelanlage-Race, Queue-Blockaden, Such-Abbruch

*Commit `afd4921`*

P0/P1-Nachrunde: Offline-Loeschungen werden gequeued und lokal ausgeblendet; Doppelanlage-Race geschlossen (Flush merkt sich angelegte IDs, Editor uebernimmt sie); dauerhaft fehlschlagende Queue-Eintraege werden entnommen, statt jeden Flush zu blockieren; veraltete Suchanfragen werden per AbortSignal abgebrochen; kein Entwurfs-Restore auf schreibgeschuetzten Formaten.

## 2026-11-16 — P0-Datensicherheit: Kontotrennung, lokale Entwuerfe, Konflikt-Sync, HTTPS, Formattreue, Re-Lock

*Commit `a054725`*

P0-Datensicherheit (Review der Entwicklungsliste): Kontotrennung — Logout und Accountwechsel loeschen alle lokalen Daten; dauerhafte lokale Entwuerfe mit Wiederherstellung; Offline-Queue mit if_version, 409-Konflikte erhalten beide Fassungen als Konflikt-Entwurf; Duplikatschutz fuer Create-Retry; Status 'fehlgeschlagen'; HTTP wird abgewiesen; html/tasklist oeffnen schreibgeschuetzt; Re-Lock bei Rueckkehr aus dem Hintergrund; Crash-Log gekuerzt.

## 2026-11-15 — Security: Server-Passwort aus App Group in gemeinsame Keychain verschoben

*Commit `27c3645`*

Sicherheit: Das Server-Passwort liegt nicht mehr frei in der App Group, sondern in der gemeinsamen Keychain; Widget und Share-Extension greifen darauf ueber den Keychain-Zugriff zu.

## 2026-11-15 — Fix: aps-environment (broadcast) aus App-Entitlements entfernt

*Commit `1f298b9`*

Build-Fix: aps-environment (broadcast) aus den App-Entitlements entfernt — Push-Recht wurde fuer die App selbst nicht benoetigt und blockierte den Build.

## 2026-11-15 — Doku: Widget, Share-Extension und App-Group-Modul vollstaendig kommentiert

*Commit `ccb7c41`*

Dokumentation: Widget, Share-Extension und App-Group-Modul vollstaendig im Quellcode kommentiert.

## 2026-11-15 — Features: Home-Screen-Widget (WidgetKit) + Share-Extension (Safari/Text -> Notiz), App-Group-Datenaustausch via lokalem Expo-Modul

*Commit `1c79954`*

Home-Screen-Widget (WidgetKit) und Share-Extension (Safari/Text zu Notiz); Datenaustausch mit der App ueber ein lokales Expo-Modul und die iOS App Group.

## 2026-11-15 — P1/P2/P4-Abschluss: Multi-Select, iPad-Layout, Face ID, Ordner-Icons, Deep-Links, Crash-Log, FR/ES

*Commit `43a0802`*

P1/P2/P4-Abschluss: Multi-Select mit Massenaktionen, iPad-Layout, Face ID, Ordner-Icons, Deep-Links (pozume://note/ID), lokales Absturzprotokoll, Franzoesisch/Spanisch.

## 2026-11-15 — P2-Polish + Kanban-Drag&Drop + Smoke-Test-Skript

*Commit `f89cd3a`*

P2-Polish, Kanban mit Drag&Drop zwischen Spalten, Smoke-Test-Skript (scripts/smoke-test.mjs) das alle genutzten Endpunkte gegen einen echten Server prueft.

## 2026-11-15 — P1-Features: Kollisions-Schutz (if_version), Server-Tasks-UI, Kanban-Board, Archiv

*Commit `0c91dd5`*

P1-Features: Kollisionsschutz ueber if_version (409 version_conflict mit Auswahl-Dialog), Aufgaben-UI fuer Server-Tasklisten, Kanban-Board, Archiv-Workspace.

## 2026-11-15 — P0-Blocker behoben: Offline-Schreib-Queue, Export, Anhang-Upload, Edit-Lock

*Commit `65234ab`*

P0-Blocker behoben: persistente Offline-Schreib-Queue (ueberlebt App-Kill), ZIP-Export, Anhang-Upload (multipart), Server-Edit-Lock mit Heartbeat.

## 2026-11-14 — Pozume 0.5: API-Fixes nach Live-Test, 13 neue REST-Features, Excalidraw-Text, Code-Review

*Commit `7d7bd23`*

v0.5: API-Fixes nach Live-Test gegen einen echten PozNote-Server, 13 neue REST-Features (Snapshots, Backlinks, Shares, Tasks, Graph, Trash, Export), Excalidraw-Text, Code-Review.

## 2026-11-14 — Features: Long-Press-Kontextmenue (Anpinnen/Duplizieren/Link teilen), Pins oben in Liste mit 📌-Icon

*Commit `1b74894`*

Long-Press-Kontextmenue in der Notizliste (Anpinnen/Duplizieren/Share-Link); angepinnte Notizen stehen mit Pin-Icon oben.

## 2026-11-14 — Optimierung: Fetch-Timeout 30s (AbortController), KI-Kontextfenster + Textlimit, FlatList-Scroll-Performance

*Commit `629ede1`*

Performance: Fetch-Timeout (30s, spaeter 12s) mit AbortController, KI-Kontextfenster mit Textlimit, FlatList-Scroll-Performance.

## 2026-11-14 — Fix: Zeichnungs-Canvas Touch (pageX/measure statt locationX, pointerEvents=none), Undo-Guard, lesbare API-Fehler, Banner bei fehlender Zeichnung

*Commit `f91da97`*

Fix-Runde: Zeichnungs-Canvas-Touch ueber pageX/measure statt locationX (pointerEvents=none), Undo-Guard, lesbare API-Fehlermeldungen, Hinweis-Banner wenn die Zeichnung auf dem Server fehlt.

## 2026-11-13 — Excalidraw-Integration: Inhaltsbasierte Erkennung, Nachladen, 🎨-Button — 2 Fehler OFFEN

*Commit `0621a5b`*

Excalidraw-Integration: inhaltsbasierte Erkennung von Zeichnungen, Nachladen aus SVG-Anhaengen, Malen-Button. Zwei bekannte Fehler blieben zu diesem Zeitpunkt offen.

## 2026-11-13 — Pozume 0.2 → 0.3: iOS-26-Build-Fixes, Dark Mode, Theme-Wechsler, Zeichnungs-Editor, REST-API-Features

*Commit `d0f1ebc`*

v0.3-Ausbaustufe: iOS-26-Build-Fixes, Dark Mode mit Theme-Wechsler, eigener Zeichnungs-Editor, zusaetzliche REST-API-Features.

## 2026-11-13 — Fix: TypeScript-Fehler behoben (en.ts-Syntax, Style-Factory, Palette-Imports, t()-Signatur) — tsc --noEmit jetzt fehlerfrei

*Commit `d0141ab`*

TypeScript-Fehler bereinigt (en.ts-Syntax, Style-Factory, Palette-Imports, t()-Signatur) — tsc --noEmit seitdem fehlerfrei.

## 2026-11-13 — Aufgaben-Ansicht: Markdown-Checkboxen aller Notizen, abhaken mit Live-Sync in die Notiz, ☑️-Button

*Commit `a76b544`*

Aufgaben-Ansicht: Markdown-Checkboxen ([ ]/[x]) aller Notizen werden gesammelt; Abhaken schreibt die Aenderung live zurueck in die Notiz.

## 2026-11-13 — KI-Kontext: Titel + Inhaltsauszug der 40 neuesten Notizen

*Commit `f1701e5`*

KI-Kontext erweitert: Titel und Inhaltsauszug der 40 neuesten Notizen gehen mit jeder Anfrage mit.

## 2026-11-13 — UX-Fixes: Listen-Refresh nach Editor, Autosave-Flush bei Preview-Toggle, KI bekommt echte Notizliste als Kontext

*Commit `58b098b`*

UX-Fixes: Notizliste aktualisiert sich nach dem Schliessen des Editors, Autosave wird beim Vorschau-Umschalten sofort geflushed, KI erhaelt die echte Notizliste als Kontext.

## 2026-11-13 — Dark Mode: adaptive Palette (usePalette), dunkle Tag-Farben, alle Screens umgestellt

*Commit `c54abc3`*

Dark Mode: adaptive Palette ueber usePalette (System-Farbschema), dunkle Tag-Farben, alle Screens umgestellt.

## 2026-11-13 — KI-Screen in Navigation verdrahtet (✨-Button), en.ts vervollständigt (109/109 Keys)

*Commit `a497348`*

KI-Screen in die Navigation verdrahtet (Stern-Button); en.ts vervollstaendigt (109/109 Schluessel).

## 2026-11-13 — v0.3: KI-Assistent (OpenAI-kompatibel, SecureStore), Erinnerungen (expo-notifications), Notiz-PIN-Lock, iPad-Zwei-Spalten

*Commit `f2d4f94`*

v0.3: KI-Assistent (OpenAI-kompatible API, Key im SecureStore), Erinnerungen ueber expo-notifications, PIN-Lock fuer einzelne Notizen, iPad-Zwei-Spalten-Layout.

## 2026-11-13 — README: v0.2-Features (Sortierung, Wortzähler)

*Commit `579e480`*

README um die v0.2-Features ergaenzt (Sortierung, Wortzaehler).

## 2026-11-13 — v0.2.0: Sortierung (geändert/erstellt/A–Z), Wortzähler + Lesezeit im Editor

*Commit `e7104a1`*

v0.2.0: Sortierung der Notizliste (zuletzt geaendert/erstellt/Titel A-Z), Wortzaehler und geschaetzte Lesezeit im Editor.

## 2026-11-13 — Fix: Poznote-Update nutzt PATCH (nicht PUT) — kritisch für Autosave/Favoriten/Ordnerwechsel

*Commit `815ab3b`*

Kritischer API-Fix: Notiz-Updates laufen ueber PATCH statt PUT. Ohne diesen Fix wuerden Autosave, Favoriten und Ordnerwechsel auf dem Server scheitern.

## 2026-11-13 — Such-Debounce, Haptik (Light/Success/Warning), Login-Fehlermeldung deutsch, README auf Finalstand

*Commit `f070737`*

Such-Debounce (300ms), Haptik-Feedback (Light/Success/Warning), deutsche Login-Fehlermeldung, README auf Finalstand.

## 2026-11-13 — Sprachumschaltung funktional (Override persistent, Live-Re-Render), App-Lock live aus Einstellungen

*Commit `2241f39`*

Sprachumschaltung funktioniert live: Override persistent in AsyncStorage, kompletter Neu-Re-Render. App-Lock laesst sich live aus den Einstellungen ein-/ausschalten.

## 2026-11-13 — Markdown-Preview (Schreiben/Lesen-Toggle), Share-Sheet, Einstellungen (Lock/Sprache/Server/Logout), Tag-Ansicht

*Commit `bd5e102`*

Markdown-Vorschau als Schreiben/Lesen-Toggle, System-Share-Sheet, Einstellungs-Screen (Lock/Sprache/Server/Logout), Tag-Ansicht.

## 2026-11-13 — LICENSE: Copyright 5loxq, zweisprachig (English & Deutsch); README-Lizenzzeile angepasst

*Commit `7ef69a9`*

Lizenz: Copyright 5loxq, zweisprachig (English/Deutsch); README-Lizenzzeile angepasst.

## 2026-11-13 — Ordner-Picker im Editor: Bottom-Sheet, Notiz verschieben, aktiver Ordner markiert

*Commit `54c72ba`*

Ordner-Picker als Bottom-Sheet im Editor: Notiz verschieben, aktiver Ordner markiert.

## 2026-11-13 — Branding: Feder statt Eule (Login & Lock), README/ICONS.md angepasst

*Commit `cc64544`*

Branding-Wechsel von der Eule zur Feder in Login und Sperrbildschirm; README/ICONS.md angepasst.

## 2026-11-13 — SVG-Quellen für alle 4 Icon-Konzepte + ICONS.md (Änderungs- und Export-Anleitung)

*Commit `db4911f`*

SVG-Quellen aller vier Icon-Konzepte mit ICONS.md: Aenderungs- und Export-Anleitung.

## 2026-11-13 — Alternative Icon-Entwürfe als Design-Referenz zurück im Repo

*Commit `dc43a21`*

Alternative Icon-Entwuerfe zurueck ins Repository (Design-Referenz).

## 2026-11-13 — App-Icon (Konzept B, Indigo-Feder) in allen iOS-Größen + Splash, README (EN), MIT-Lizenz

*Commit `1676681`*

Finales App-Icon (Konzept B, Indigo-Feder) in allen iOS-Groessen plus Splash-Screen. README auf Englisch, MIT-Lizenz.

## 2026-11-13 — Icon-Entwuerfe: 4 Konzepte (Feder-Emblem violett/indigo, Feder-P, Notizkarte mit Feder)

*Commit `f919fd5`*

Vier App-Icon-Entwuerfe (Feder-Emblem violett/indigo, Feder-P, Notizkarte mit Feder) als Design-Referenz.

## 2026-11-13 — Design-Pass: Tageszeit-Begruessung, Notizzähler, farbige Tag-Chips, Hero-Login, feinere Typografie

*Commit `654ad49`*

Design-Pass: Tageszeit-Begruessung, Notizzehler, farbige Tag-Chips, Hero-Login mit Blobs, feinere Typografie.

## 2026-11-13 — Offline-Cache (stale-while-revalidate), Papierkorb: Ansehen, Wiederherstellen, Endgültig löschen

*Commit `e7a1f70`*

Offline-Cache nach stale-while-revalidate: App startet sofort mit letztem Stand und aktualisiert im Hintergrund. Papierkorb mit Ansehen, Wiederherstellen und Endgueltig Loeschen.

## 2026-11-13 — Ordner-Screen + Ordnerfilter, Favoriten-Toggle im Editor, FaceID-App-Lock, SecureStore-Auto-Login

*Commit `702cb09`*

Ordner-Screen mit Ordnerfilter, Favoriten-Toggle im Editor, Face-ID-App-Lock (expo-local-authentication) und Auto-Login: Server-Zugangsdaten liegen im SecureStore.

## 2026-11-13 — Notizliste + Editor mit Autosave, Design-System, Tag-Chips, Favoriten-Filter, Suche

*Commit `2670508`*

Erste Notizliste und Notiz-Editor mit Autosave (1,2s nach letzter Eingabe). Design-System (theme.ts), Tag-Chips, Favoriten-Filter, lokale Suche.

## 2026-11-13 — Pozume: frischer Expo/React-Native Start — DE/EN i18n, Poznote-API-Client, Login-Screen

*Commit `fdb3722`*

Projektstart: Expo/React-Native-Grundgeruest der iOS-App. Poznote-REST-Client (HTTP Basic + X-User-ID), Login-Screen, DE/EN-i18n, Theme-Grundlagen.


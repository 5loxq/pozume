# Gefundene Poznote-Server-Fehler

Verifiziert am **2026-11-21** gegen `https://admirable-squid.pikapod.net`
(Poznote-Server **6.155.0**, User `roman`).
Beide Fehler sind clientseitig in Pozume abgesichert (Commit `320983e`), sollten
aber idealerweise im Poznote-Projekt (github.com/timothepoznanski/poznote)
serverseitig behoben werden — sie betreffen auch den Web-Client.

---

## Bug 1: `PATCH folder_id: null` wird still ignoriert

### Verhalten

Sendet der Client `PATCH /api/v1/notes/{id}` mit `"folder_id": null`, antwortet
der Server `{"success": true, ...}` — **übernimmt die Änderung aber nicht**.
Die Notiz bleibt im bisherigen Ordner.

```
PATCH /api/v1/notes/44  {"folder_id": null}
→ {"success": true, "note": { ... }}            (Erfolg gemeldet)

GET  /api/v1/notes/44
→ note.folder_id: 17                             (unverändert!)
```

### Workaround (von Pozume verwendet)

`folder_id: 0` wird als „kein Ordner / oberste Ebene“ interpretiert und
funktioniert verifiziert:

```
PATCH /api/v1/notes/44  {"folder_id": 0}
→ GET note.folder_id: null                       (korrekt)
```

Pozume sendet deshalb über `client.moveNote()` für „kein Ordner“ den Wert `0`.
Betroffene Stellen: Editor-Verschiebung, Mehrfach-Verschiebung der Liste,
Offline-Queue (`kind: 'move'`), Ordner-Nachzug bei Konflikt-Wiederherstellung.

### Datenverlust-Risiko

**Hoch**, in Kombination mit Bug 2: Der Client zeigt „kein Ordner“ an und der
Nutzer hält die Notiz für herausverschoben — der Server behält sie im Ordner.
Wird der Ordner später gelöscht, wird die Notiz mitgelöscht (siehe Bug 2).
Genau diese Kombination wurde mit einer Test-Notiz reproduziert.

---

## Bug 2: Ordner löschen entfernt Notizen endgültig (kein Papierkorb, kein Restore)

### Verhalten

`DELETE /api/v1/folders/{id}` löscht den Ordner samt Unterordnern **und aller
enthaltener Notizen**. Die Notizen landen dabei:

- **nicht** im Papierkorb (`GET /api/v1/trash` bleibt leer),
- **nicht** wiederherstellbar über `POST /api/v1/notes/{id}/restore`
  (→ `{"success": false, "error": "Note not found"}`),
- **nicht** über die Volltextsuche erreichbar (`count: 0`).

Die Antwort von `DELETE /folders/{id}` erwähnt zwar ein `restore_snapshot`,
ein Restore der betroffenen Notizen war jedoch mit keinem verfügbaren Endpunkt
möglich.

### Reproduktion (2026-11-21, verifiziert)

```bash
# Notiz anlegen und in Ordner 16 verschieben
POST /api/v1/notes            → id 43
POST /api/v1/folders          → id 16
PATCH /api/v1/notes/43  {"folder_id": 16}

# „Herausverschieben“ — wird wegen Bug 1 ignoriert!
PATCH /api/v1/notes/43  {"folder_id": null}   → success:true
GET  /api/v1/notes/43                         → folder_id: 16 (!)

# Ordner löschen
DELETE /api/v1/folders/16     → success:true, „Folder and all subfolders deleted“

# Notiz ist unwiederbringlich weg
GET  /api/v1/notes/43                         → 404
GET  /api/v1/trash                            → []
POST /api/v1/notes/43/restore                 → "Note not found"
```

### Absicherung in Pozume

Der Lösch-Dialog warnt jetzt ausdrücklich:

> „Achtung: Der Server löscht alle Notizen im Ordner ENDGÜLTIG mit — sie landen
> nicht im Papierkorb. Notizen, die du behalten willst, vorher herausverschieben.“

(War vorher: „Der Server legt ein Wiederherstellungs-Snapshot an.“ — das ist
für die betroffenen Notizen nachweislich nicht der Fall.)

---

## Zusatz-Befund: Kein Delta-Sync in der API (Limitation, kein Bug)

Für „nur Änderungen nachladen“ (P1-14) existiert **keine** Server-Unterstützung:

- `GET /notes?updated_after=…`, `?since=…`, `?updated_min=…` werden ignoriert
  (Antwortmenge/`total` unverändert — Server filtert nicht).
- `GET /notes/sync` ist **kein** Delta-Endpunkt, sondern ein Notiz-Lookup:
  `reference` ist eine Notiz-ID
  (Fehler ohne: `"workspace is required when using reference"`,
  mit `reference=7` → `{"success":true,"note":{"id":7,…}}`).
- Die Standard-Sortierung von `GET /notes` ist nicht zuverlässig
  aktualitätsbasiert (Beispiel: id 35, dann 11, dann 8 mit aufsteigendem
  `updated`), daher ist auch ein „erste Seite = alles Neue“-Ansatz unzuverlässig.

Pozume lädt deshalb paginiert (100er-Seiten, Obergrenze 1000). Der Smoke-Test
enthält eine Prüfung, die **anschlägt, sobald ein Server `updated_after`
tatsächlich filtert** — dann kann der Delta-Sync in der App umgesetzt werden.

---

## Verifikation

- Pozume-Smoke-Test gegen den Live-Server: **24/24 bestanden**
  (`npm run smoke`, POZNOTE_URL=…, Poznote-Server 6.155.0),
  inklusive eines eigenen Checks für den `folder_id: 0`-Workaround.
- Test-Notizen und Test-Ordner wurden jeweils endgültig aufgeräumt;
  der Datenbestand ist unverändert.

*Diese Datei beschreibt ausschließlich das Serververhalten; Pozume-Seite ist
alles abgesichert — siehe CHANGELOG.md, Eintrag 2026-11-21, Runde 3.*

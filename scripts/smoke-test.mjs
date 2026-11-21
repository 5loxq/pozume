#!/usr/bin/env node
/**
 * Pozume-API-Smoke-Test: prüft alle von der App genutzten Endpunkte gegen
 * einen echten PozNote-Server. Legt dafür eine temporäre Notiz an und
 * räumt sie am Ende wieder weg — der Datenbestand bleibt unverändert.
 *
 * Aufruf:
 *   POZNOTE_URL=https://server POZNOTE_USER=roman POZNOTE_PASSWORD=... npm run smoke
 * oder: node scripts/smoke-test.mjs --url https://server --user roman --password ...
 */

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return undefined;
};
const BASE = (arg('url') ?? process.env.POZNOTE_URL ?? '').replace(/\/+$/, '');
const USER = arg('user') ?? process.env.POZNOTE_USER ?? '';
const PASSWORD = arg('password') ?? process.env.POZNOTE_PASSWORD ?? '';

if (!BASE || !USER || !PASSWORD) {
  console.error('Fehlende Zugangsdaten. POZNOTE_URL, POZNOTE_USER und POZNOTE_PASSWORD setzen (oder --url/--user/--password).');
  process.exit(2);
}

const API = `${BASE}/api/v1`;
const H = {
  Authorization: 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64'),
  'X-User-ID': '1',
  'Content-Type': 'application/json',
};
const H_NOCT = { ...H }; delete H_NOCT['Content-Type'];

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}

const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers: H });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 120)}`);
  return body;
};
const send = async (path, method, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function main() {
  console.log(`Pozume Smoke-Test gegen ${BASE}\n`);

  let tempId = null;

  await check('Notizen auflisten (GET /notes)', async () => {
    const d = await get('/notes?limit=5');
    assert(Array.isArray(d.notes), 'notes fehlt in der Antwort');
  });
  await check('Tags (GET /tags)', async () => {
    const d = await get('/tags');
    assert(Array.isArray(d.tags), 'tags fehlt');
  });
  await check('Workspaces (GET /workspaces)', async () => {
    const d = await get('/workspaces');
    assert(Array.isArray(d.workspaces), 'workspaces fehlt');
  });
  await check('Ordner (GET /folders?hierarchical)', async () => {
    const d = await get('/folders?hierarchical=true');
    assert(Array.isArray(d.folders), 'folders fehlt');
  });
  await check('Aufgaben (GET /tasks)', async () => {
    const d = await get('/tasks');
    assert(Array.isArray(d.notes ?? d.checklists ?? []), 'notes/checklists fehlen');
  });
  await check('Papierkorb (GET /trash)', async () => {
    const d = await get('/trash');
    assert(Array.isArray(d.notes), 'notes fehlt');
  });
  await check('Erinnerungen (GET /reminders)', async () => {
    const d = await get('/reminders?scope=all');
    assert(Array.isArray(d.notifications ?? d.reminders ?? []), 'notifications fehlen');
  });
  await check('Graph (GET /graph)', async () => {
    const d = await get('/graph');
    assert(Array.isArray(d.nodes), 'nodes fehlen');
  });
  await check('Server-Version (GET /system/version)', async () => {
    const d = await get('/system/version');
    assert(!!d.current_version, 'current_version fehlt');
  });
  await check('Volltextsuche (GET /notes/search)', async () => {
    const d = await get(`/notes/search?q=${encodeURIComponent('a')}`);
    assert(Array.isArray(d.results ?? d.notes ?? []), 'results fehlen');
  });

  // --- Schreibzyklus auf einer temporären Notiz ---
  await check('Notiz anlegen (POST /notes)', async () => {
    const r = await send('/notes', 'POST', { heading: 'Smoke-Test (loeschen)', content: '# Smoke', type: 'markdown', tags: 'smoketest' });
    assert(r.ok && r.data.note?.id, `Anlegen fehlgeschlagen: ${r.status}`);
    tempId = r.data.note.id;
  });
  if (tempId != null) {
    await check('Notiz lesen (GET /notes/{id})', async () => {
      const d = await get(`/notes/${tempId}`);
      assert(d.note?.heading === 'Smoke-Test (loeschen)', 'heading falsch');
    });
    await check('if_version: aktueller Stand akzeptiert', async () => {
      const d = await get(`/notes/${tempId}`);
      const r = await send(`/notes/${tempId}`, 'PATCH', { content: '# Smoke v2', if_version: d.note.version });
      assert(r.ok && r.data.note?.version, `PATCH fehlgeschlagen: ${r.status}`);
    });
    await check('if_version: veralteter Stand -> 409', async () => {
      const r = await send(`/notes/${tempId}`, 'PATCH', { content: 'x', if_version: '00000000000000000000000000000000' });
      assert(r.status === 409 && r.data.code === 'version_conflict', `erwartet 409 version_conflict, bekam ${r.status}`);
    });
    await check('Edit-Lock: nehmen/pruefen/freigeben', async () => {
      const a = await send(`/notes/${tempId}/lock`, 'POST', { editor_session_id: 'smoke-test' });
      assert(a.ok, `Lock-Annehmen fehlgeschlagen: ${a.status}`);
      const s = await get(`/notes/${tempId}/lock`);
      // GET ohne X-Editor-Session-ID meldet holder_is_current_editor_session:false —
      // verlässlich prüfbar: Lock existiert und gehört dem eigenen Account
      assert(s.lock != null && s.lock.holder_is_current_user === true, 'Lock-Status falsch');
      const rel = await send(`/notes/${tempId}/lock/release`, 'POST', { editor_session_id: 'smoke-test' });
      assert(rel.ok, 'Freigabe fehlgeschlagen');
    });
    await check('Erinnerung setzen/lesen/loeschen', async () => {
      const when = new Date(Date.now() + 86400000).toISOString();
      const set = await send(`/notes/${tempId}/reminder`, 'POST', { reminder_at: when, message: 'smoke' });
      assert(set.ok, `Setzen fehlgeschlagen: ${set.status}`);
      const rd = await get(`/notes/${tempId}/reminder`);
      assert(!!rd.reminder_at, 'reminder_at fehlt');
      const del = await send(`/notes/${tempId}/reminder`, 'DELETE');
      assert(del.ok, 'Loeschen fehlgeschlagen');
    });
    await check('Snapshot anlegen/auflisten', async () => {
      const c = await send(`/notes/${tempId}/snapshot?manual=1`, 'POST');
      assert(c.ok, `Anlegen fehlgeschlagen: ${c.status}`);
      const d = await get(`/notes/${tempId}/snapshots`);
      assert((d.snapshots ?? []).length > 0, 'keine Snapshots');
    });
    await check('Share erstellen/zurueckziehen', async () => {
      const c = await send(`/notes/${tempId}/share`, 'POST', { indexable: false });
      assert(c.ok && (c.data.url || c.data.token), 'keine Share-URL');
      const r = await send(`/notes/${tempId}/share`, 'DELETE');
      assert(r.ok, 'Zurueckziehen fehlgeschlagen');
    });
    await check('Anhang hochladen/loeschen', async () => {
      const form = new FormData();
      form.append('file', new Blob(['smoke-test-anhang'], { type: 'text/plain' }), 'smoke.txt');
      const res = await fetch(`${API}/notes/${tempId}/attachments`, { method: 'POST', headers: H_NOCT, body: form });
      const data = await res.json().catch(() => ({}));
      assert(res.ok && data.attachment_id, `Upload fehlgeschlagen: HTTP ${res.status}`);
      // Duplikatschutz der Upload-Queue (P1-8) verlaesst sich auf Name+Groesse
      const list = await get(`/notes/${tempId}/attachments`);
      const att = (list.attachments ?? []).find((a) => a.id === data.attachment_id);
      assert(att?.file_size != null && att.file_size > 0, 'file_size fehlt — Duplikatschutz der App braeuchte Ersatz');
      assert(!!(att?.original_filename || att?.filename), 'Dateiname fehlt');
      const del = await send(`/notes/${tempId}/attachments/${data.attachment_id}`, 'DELETE');
      assert(del.ok, 'Loeschen fehlgeschlagen');
    });
    await check('Ordner wechseln (PATCH folder_id — offline gequeueute Verschiebungen)', async () => {
      const c = await send('/folders', 'POST', { name: 'smoke-test-folder' });
      const folderId = c.data.folder?.id ?? c.data.id;
      assert(folderId != null, `Ordner anlegen fehlgeschlagen: ${c.status}`);
      try {
        const m = await send(`/notes/${tempId}`, 'PATCH', { folder_id: folderId });
        assert(m.ok, `Verschieben fehlgeschlagen: ${m.status}`);
        const d = await get(`/notes/${tempId}`);
        assert(d.note?.folder_id === folderId, 'folder_id nicht uebernommen');
        // Poznote-Bug: folder_id: null wird ignoriert — nur 0 erreicht die
        // oberste Ebene (App-Workaround moveNote). Beides hier verifizieren:
        const back = await send(`/notes/${tempId}`, 'PATCH', { folder_id: 0 });
        assert(back.ok, 'Zurueckverschieben fehlgeschlagen');
        const rd = await get(`/notes/${tempId}`);
        assert(rd.note?.folder_id == null, `folder_id nach Zurueckverschieben erwartet null, bekam ${rd.note?.folder_id}`);
      } finally {
        await send(`/folders/${folderId}`, 'DELETE');
      }
    });
    await check('Delta-Sync: updated_after wird (noch) ignoriert — bekannte Limitation', async () => {
      const all = await get('/notes?limit=1');
      const cut = await get('/notes?limit=1&updated_after=2000-01-01%2000:00:00');
      assert((all.total ?? 0) === (cut.total ?? -1),
        `Server filtert jetzt nach updated_after (${all.total} vs ${cut.total}) — Delta-Sync in der App implementieren!`);
    });
    await check('Aufgabe anlegen/loeschen (eigene Taskliste)', async () => {
      const list = await send('/notes', 'POST', { heading: 'Smoke-Aufgaben', content: '[]', type: 'tasklist' });
      assert(list.ok && list.data.note?.id, `Taskliste anlegen fehlgeschlagen: ${list.status}`);
      const listId = list.data.note.id;
      try {
        const c = await send(`/notes/${listId}/tasks`, 'POST', { text: 'Smoke-Aufgabe', priority: 'high' });
        assert(c.ok && c.data.task?.id, `Anlegen fehlgeschlagen: ${c.status}`);
        const del = await send(`/notes/${listId}/tasks/${c.data.task.id}`, 'DELETE');
        assert(del.ok, 'Loeschen fehlgeschlagen');
      } finally {
        await send(`/notes/${listId}?permanent=true`, 'DELETE');
      }
    });
    await check('Export: Einzelnotiz als Markdown', async () => {
      const res = await fetch(`${BASE}/api_export_note.php?id=${tempId}&format=markdown&disposition=inline`, { headers: H });
      const text = await res.text();
      assert(res.ok && text.length > 0, `Export fehlgeschlagen: HTTP ${res.status}`);
    });
    await check('Aufraeumen: Notiz endgueltig loeschen', async () => {
      const r = await send(`/notes/${tempId}?permanent=true`, 'DELETE');
      assert(r.ok, `Loeschen fehlgeschlagen: ${r.status}`);
      tempId = null;
    });
  }

  console.log(`\nErgebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  if (failed > 0) {
    console.log('\nFehlgeschlagen:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`Abbruch: ${e.message}`);
  process.exit(1);
});

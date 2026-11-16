/**
 * Poznote REST API Client.
 * Auth: HTTP Basic + X-User-ID header.
 * Doku: docs/API-REST.md im Poznote-Repository (github.com/timothepoznanski/poznote).
 */
export interface PoznoteConfig {
  baseUrl: string;
  username: string;
  password: string;
  userId?: string;
}

export interface Note {
  id: number;
  heading: string;
  content?: string;
  tags?: string;
  folder_id?: number | null;
  favorite?: boolean;
  pinned?: boolean;
  updated_at?: string;
  type?: string;
  locked?: boolean;
  workspace?: string;
  color?: string | null;
  color_hex?: string | null;
  /** Version-Token für optimistische Konkurrenz (if_version) */
  version?: string;
}

export interface GraphNode {
  id: number;
  title: string;
  folder?: string | null;
  folder_id?: number | null;
  type?: string;
  favorite?: boolean;
  tags?: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: Array<{ source: number; target: number }>;
  folders: Array<{ id: number; name: string; parent_id?: number | null }>;
  total?: number;
}

export interface TemplateInfo {
  id: number;
  heading: string;
  type?: string;
  workspace?: string;
  folder_id?: number;
  folder?: string;
}

export interface Backlink {
  id: number;
  heading: string;
  workspace?: string;
  mentions?: Array<{ text: string; preview: string; label: string }>;
}

export interface SnapshotInfo {
  snapshot_key: string;
  date: string;
  heading: string;
  tags?: string | null;
  type?: string;
  manual?: boolean;
  origin?: string;
  created_at?: string;
  content_hash?: string;
  size?: number;
}

export interface ReminderRow {
  id: number;
  state?: 'fired' | 'upcoming';
  note_id?: number;
  note_heading?: string | null;
  workspace?: string;
  message?: string;
  trigger_at?: string;
  recurrence?: string | null;
  is_read?: boolean;
  task_id?: string | null;
}

export interface NoteLockInfo {
  holder_username?: string;
  holder_is_public?: boolean;
  holder_is_current_user?: boolean;
  holder_is_current_editor_session?: boolean;
  expires_at?: string;
  last_seen_at?: string;
}

export class PoznoteError extends Error {
  status: number;
  /** Geparpte Fehler-Antwort des Servers (z.B. {code, current} bei 409 version_conflict) */
  data?: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * Server-Datum ("YYYY-MM-DD HH:MM:SS", UTC) in ein für Date() sicheres ISO-Format
 * überführen. Bereits ISO-formatierte Strings bleiben unverändert (kein doppeltes "Z").
 */
function toIsoDateTime(s: string | undefined | null): string | undefined {
  if (typeof s !== 'string') return s as undefined;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
}

/**
 * Server-Notiz in das App-Format überführen.
 * Der Server liefert `updated` statt `updated_at` und `favorite` als 0/1 statt boolean.
 */
function normalizeNote(raw: any): Note {
  return {
    ...raw,
    updated_at: toIsoDateTime(raw?.updated ?? raw?.updated_at),
    favorite: !!raw?.favorite,
    pinned: !!raw?.pinned,
  };
}

/** UTF-8-sicheres Base64 (btoa wirft bei Zeichen außerhalb Latin-1, z.B. Umlaut-Passwörtern) */
function base64Encode(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.codePointAt(i)!;
    if (cp > 0xffff) i++; // Surrogatpaar verbraucht zwei Code-Einheiten
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

export class PoznoteClient {
  constructor(public cfg: PoznoteConfig) {}

  /** Auth-Header für rohe fetch-Aufrufe (Attachments etc.) */
  authHeaders(): Record<string, string> {
    return {
      Authorization: 'Basic ' + base64Encode(`${this.cfg.username}:${this.cfg.password}`),
      'X-User-ID': this.cfg.userId ?? '1',
    };
  }

  private async req<T>(path: string, init: RequestInit = {}, attempt = 0, outerSignal?: AbortSignal): Promise<T> {
    // Timeout + ein Retry: Manche Server bewerben HTTP/3 (Alt-Svc), beantworten QUIC aber nicht —
    // erste Verbindungen hängen dann bis zum Systemtimeout. Der Retry läuft dann über TCP.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    // Äußerer Abbruch (z.B. veraltete Suchanfrage) leitet auf den internen Controller durch
    const onOuterAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onOuterAbort);
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/api/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      if (outerSignal?.aborted) throw new PoznoteError(0, 'aborted');
      if (attempt < 1) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 400));
        return this.req<T>(path, init, attempt + 1, outerSignal);
      }
      throw new PoznoteError(0, 'network');
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onOuterAbort);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const isHtml = text.trimStart().startsWith('<');
      const detail = isHtml ? 'HTML-Fehlerseite (ggf. WAF/CSRF)' : text.slice(0, 200);
      // Strukturierte Fehler (z.B. 409 version_conflict mit `current`) mitliefern
      let data: any;
      if (!isHtml) {
        try { data = JSON.parse(text); } catch { data = undefined; }
      }
      throw new PoznoteError(res.status, `HTTP ${res.status}: ${detail}`, data);
    }
    return res.json() as Promise<T>;
  }

  // --- Notes ---
  async listNotes(params: { folder_id?: number; tags?: string; search?: string; workspace?: string; favorite?: boolean } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
    ).toString();
    const res = await this.req<{ notes: Note[] }>(`/notes${qs ? `?${qs}` : ''}`);
    return { notes: (res.notes ?? []).map(normalizeNote) };
  }

  async getNote(id: number) {
    const res = await this.req<{ note: Note }>(`/notes/${id}`);
    return { note: normalizeNote(res.note) };
  }

  createNote(input: { heading: string; content: string; type?: string; folder_id?: number; tags?: string; workspace?: string }) {
    return this.req<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) });
  }

  /**
   * Notiz aktualisieren. `if_version` = Version-Token aus GET /notes/{id}:
   * Wurde die Notiz zwischenzeitlich geändert, antwortet der Server mit 409
   * (code "version_conflict") und dem aktuellen Stand in `data.current`.
   */
  updateNote(id: number, patch: Partial<Pick<Note, 'heading' | 'content' | 'tags' | 'folder_id' | 'favorite'>> & { if_version?: string }) {
    return this.req<{ success: boolean; note?: { version?: string } }>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  deleteNote(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}`, { method: 'DELETE' });
  }

  duplicateNote(id: number) {
    return this.req<{ note: Note }>(`/notes/${id}/duplicate`, { method: 'POST' });
  }

  setPinned(id: number, pinned: boolean) {
    return this.req<{ success: boolean }>(`/notes/${id}/pinned`, { method: 'PUT', body: JSON.stringify({ pinned }) });
  }

  toggleFavorite(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}/favorite`, { method: 'POST' });
  }

  /** Serverseitiger Schreibschutz für Titel+Text (PUT /notes/{id}/locked) */
  setNoteLocked(id: number, locked: boolean) {
    return this.req<{ success: boolean }>(`/notes/${id}/locked`, { method: 'PUT', body: JSON.stringify({ locked }) });
  }

  /** Notiz ins Archives-Workspace verschieben */
  archiveNote(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}/archive`, { method: 'POST' });
  }

  /** Karten-Farbe der Notiz (Palette-ID oder Hex, leerer String entfernt sie) */
  setNoteColor(id: number, color: string) {
    return this.req<{ success: boolean; color: string | null; color_hex: string | null }>(`/notes/${id}/color`, { method: 'PUT', body: JSON.stringify({ color }) });
  }

  /** Zwischen Markdown und HTML (Rich-Text) konvertieren */
  convertNote(id: number, target: 'markdown' | 'html') {
    return this.req<{ success: boolean; type: string }>(`/notes/${id}/convert`, { method: 'POST', body: JSON.stringify({ target }) });
  }

  /** Vorlagen (Notizen in einem "Templates"-Ordner/-Workspace) */
  listTemplates(workspace?: string) {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.req<{ notes: TemplateInfo[]; count?: number }>(`/notes/templates${qs}`);
  }

  /** Serverseitige Volltextsuche (ignoriert Groß-/Kleinschreibung und Akzente).
   *  `signal` bricht veraltete Anfragen ab, sobald eine neuere Suche startet. */
  async searchNotes(q: string, opts: { limit?: number; mode?: 'all' | 'any' | 'phrase'; workspace?: string; tags?: string; signal?: AbortSignal } = {}) {
    const { signal, ...params } = opts;
    const qs = new URLSearchParams({ q, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])) });
    const res = await this.req<{ results?: any[]; notes?: any[] }>(`/notes/search?${qs.toString()}`, {}, 0, signal);
    // Server antwortet mit `results` (inkl. excerpt); `notes` als Fallback für ältere Versionen
    const list: any[] = res.results ?? res.notes ?? [];
    return { notes: list.map((n) => normalizeNote({ ...n, content: n.content ?? n.excerpt })) };
  }

  // --- Backlinks ---
  getBacklinks(id: number) {
    return this.req<{ backlinks: Backlink[]; count: number }>(`/notes/${id}/backlinks?context=1`);
  }

  // --- Snapshots (Versionen) ---
  listSnapshots(id: number) {
    return this.req<{ snapshots: SnapshotInfo[]; current_hash?: string; current_heading?: string; current_tags?: string }>(`/notes/${id}/snapshots`);
  }

  getSnapshot(id: number, snapshotKey: string) {
    return this.req<{ snapshot: { content?: string; heading?: string; tags?: string | null } }>(`/notes/${id}/snapshot?snapshot_key=${encodeURIComponent(snapshotKey)}`);
  }

  createSnapshot(id: number, manual = true) {
    return this.req<{ success: boolean }>(`/notes/${id}/snapshot?manual=${manual ? '1' : '0'}`, { method: 'POST' });
  }

  restoreSnapshot(id: number, snapshotKey: string, meta = true) {
    return this.req<{ success: boolean; heading?: string | null; tags?: string | null }>(
      `/notes/${id}/snapshot/restore?snapshot_key=${encodeURIComponent(snapshotKey)}&meta=${meta ? '1' : '0'}`,
      { method: 'POST' },
    );
  }

  // --- Server-Reminders ---
  async getNoteReminder(id: number) {
    // Antwort ist flach: { reminder_at, message, recurrence } bzw. reminder_at: null
    const res = await this.req<{ reminder_at?: string | null; message?: string; recurrence?: string | null }>(`/notes/${id}/reminder`);
    return { reminder: res.reminder_at != null ? { reminder_at: res.reminder_at, message: res.message, recurrence: res.recurrence } : null };
  }

  setNoteReminder(id: number, reminderAtIso: string, opts: { message?: string; recurrence?: string } = {}) {
    return this.req<{ success: boolean }>(`/notes/${id}/reminder`, { method: 'POST', body: JSON.stringify({ reminder_at: reminderAtIso, ...opts }) });
  }

  removeNoteReminder(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}/reminder`, { method: 'DELETE' });
  }

  async listReminders(scope: 'fired' | 'upcoming' | 'all' = 'all', limit = 100) {
    // Server antwortet mit `notifications` (nicht `reminders`)
    const res = await this.req<{ notifications?: ReminderRow[]; reminders?: ReminderRow[]; unread_count?: number; total_count?: number; upcoming_count?: number }>(`/reminders?scope=${scope}&limit=${limit}`);
    return {
      reminders: (res.notifications ?? res.reminders ?? []).map((r) => ({ ...r, trigger_at: toIsoDateTime(r.trigger_at) })),
      unread_count: res.unread_count,
      total_count: res.total_count,
      upcoming_count: res.upcoming_count,
    };
  }

  markReminderRead(id: number) {
    return this.req<{ success: boolean }>(`/reminders/${id}/read`, { method: 'POST' });
  }

  dismissReminder(id: number) {
    return this.req<{ success: boolean }>(`/reminders/${id}/dismiss`, { method: 'POST' });
  }

  dismissAllReminders() {
    return this.req<{ success: boolean }>('/reminders/dismiss-all', { method: 'POST' });
  }

  // --- Graph ---
  getGraph(workspace?: string) {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.req<GraphData>(`/graph${qs}`);
  }

  // --- Sharing ---
  getShare(id: number) {
    // Server meldet den Status als `public` (nicht `shared`)
    return this.req<{ public?: boolean; shared?: boolean; url?: string; token?: string }>(`/notes/${id}/share`);
  }

  async shareNote(id: number, opts: { theme?: string; indexable?: boolean; access_mode?: string } = {}) {
    const res = await this.req<{ success: boolean; url?: string; token?: string; share_url?: string }>(`/notes/${id}/share`, { method: 'POST', body: JSON.stringify({ indexable: false, ...opts }) });
    // Der Server liefert ein protokoll-relatives URL ("//host/token") — für Share/Clipboard absolut machen
    let url = res.url ?? res.share_url ?? (res.token ? `${this.cfg.baseUrl}/${res.token}` : undefined);
    if (url && url.startsWith('//')) url = `https:${url}`;
    return { ...res, url };
  }

  revokeShare(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}/share`, { method: 'DELETE' });
  }

  // --- Tasks (serverseitige Tasklisten) ---
  async listTasks(workspace?: string) {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    // Server liefert Tasklisten teils unter `checklists`, teils unter `notes` — beides zusammenführen
    const res = await this.req<{ notes?: unknown[]; checklists?: unknown[] }>(`/tasks${qs}`);
    const list = [...(res.notes ?? []), ...(res.checklists ?? [])] as Array<{
      id: number; heading: string; folder?: string;
      tasks: Array<{ id: number; text: string; completed: boolean; priority?: string | null; dueAt?: string | null }>;
    }>;
    return { notes: list };
  }

  /** Aufgabe an eine Tasklisten-Notiz anhängen */
  addTask(noteId: number, input: { text: string; due_at?: string; priority?: 'high' | 'medium' | 'low' | 'none'; reminder?: boolean }) {
    return this.req<{ success: boolean; task: { id: number } }>(`/notes/${noteId}/tasks`, { method: 'POST', body: JSON.stringify(input) });
  }

  deleteTask(noteId: number, taskId: number) {
    return this.req<{ success: boolean }>(`/notes/${noteId}/tasks/${taskId}`, { method: 'DELETE' });
  }

  updateTask(noteId: number, taskId: number, patch: { completed?: boolean; text?: string; priority?: string | null; due_at?: string | null }) {
    return this.req<{ success: boolean }>(`/notes/${noteId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  // --- Workspaces ---
  listWorkspaces() {
    return this.req<{ workspaces: Array<{ name: string; color?: string | null }> }>('/workspaces');
  }

  // --- Tags ---
  async listTags(workspace?: string) {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    // Server liefert ein reines String-Array; Objekte mit count als Fallback
    const res = await this.req<{ tags: Array<string | { tag: string; count?: number }> }>(`/tags${qs}`);
    return { tags: (res.tags ?? []).map((x) => (typeof x === 'string' ? { tag: x } : x)) };
  }

  renameTag(tag: string, newName: string, workspace?: string) {
    return this.req<{ success: boolean }>(`/tags/${encodeURIComponent(tag)}`, { method: 'PATCH', body: JSON.stringify({ new_name: newName, ...(workspace ? { workspace } : {}) }) });
  }

  deleteTag(tag: string, workspace?: string) {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.req<{ success: boolean }>(`/tags/${encodeURIComponent(tag)}${qs}`, { method: 'DELETE' });
  }

  // --- Trash ---
  async listTrash() {
    const res = await this.req<{ notes: Note[] }>('/trash');
    return { notes: (res.notes ?? []).map(normalizeNote) };
  }

  restoreNote(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}/restore`, { method: 'POST' });
  }

  deleteFromTrashForever(id: number) {
    return this.req<{ success: boolean }>(`/trash/${id}`, { method: 'DELETE' });
  }

  emptyTrash() {
    return this.req<{ success: boolean }>('/trash', { method: 'DELETE' });
  }

  // --- Folders ---
  listFolders(workspace?: string, hierarchical?: boolean) {
    const params = new URLSearchParams();
    if (workspace) params.set('workspace', workspace);
    if (hierarchical) params.set('hierarchical', 'true');
    const qs = params.toString();
    return this.req<{ folders: unknown[] }>(`/folders${qs ? `?${qs}` : ''}`);
  }

  createFolder(name: string, workspace?: string) {
    return this.req<{ id?: number; folder_id?: number; folder?: { id: number; name: string } }>('/folders', { method: 'POST', body: JSON.stringify({ name, ...(workspace ? { workspace } : {}) }) });
  }

  /** Ordner samt Unterordnern löschen (Server legt ein Restore-Snapshot an) */
  deleteFolder(id: number) {
    return this.req<{ success: boolean }>(`/folders/${id}`, { method: 'DELETE' });
  }

  /** Ordner-Icon setzen (Lucide-Klassenname, leerer String = Standard) */
  setFolderIcon(id: number, icon: string, iconColor?: string) {
    return this.req<{ success: boolean }>(`/folders/${id}/icon`, {
      method: 'PUT',
      body: JSON.stringify({ icon, ...(iconColor ? { icon_color: iconColor } : {}) }),
    });
  }

  // --- System ---
  getSystemVersion() {
    return this.req<{ current_version?: string; latest_version?: string; is_up_to_date?: boolean }>('/system/version');
  }

  // --- Export (Legacy-Endpunkte außerhalb /api/v1) ---
  /** Einzelne Notiz exportieren (format: markdown | html | json) */
  async exportNote(id: number, format: 'markdown' | 'html' | 'json'): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/api_export_note.php?id=${id}&format=${format}&disposition=inline`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new PoznoteError(res.status, `HTTP ${res.status}`);
    return res.text();
  }

  /** Serverseitigen ZIP-Export herunterladen (alle Notizen oder alle Anhänge) */
  async downloadExport(kind: 'entries' | 'attachments'): Promise<Uint8Array> {
    const path = kind === 'entries' ? 'api_export_entries.php' : 'api_export_attachments.php';
    const res = await fetch(`${this.cfg.baseUrl}/${path}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new PoznoteError(res.status, `HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // --- Edit-Locks (wer hat die Notiz gerade offen?) ---
  getNoteLock(id: number) {
    return this.req<{ lock: NoteLockInfo | null }>(`/notes/${id}/lock`);
  }

  /** Edit-Lock für diese Editor-Session nehmen; 423 = jemand anderes hält ihn */
  acquireNoteLock(id: number, editorSessionId: string) {
    return this.req<{ lock: NoteLockInfo; taken_over?: boolean }>(`/notes/${id}/lock`, { method: 'POST', body: JSON.stringify({ editor_session_id: editorSessionId }) });
  }

  refreshNoteLock(id: number, editorSessionId: string) {
    return this.req<{ success: boolean }>(`/notes/${id}/lock/heartbeat`, { method: 'POST', body: JSON.stringify({ editor_session_id: editorSessionId }) });
  }

  releaseNoteLock(id: number, editorSessionId: string) {
    return this.req<{ released: boolean }>(`/notes/${id}/lock/release`, { method: 'POST', body: JSON.stringify({ editor_session_id: editorSessionId }) });
  }

  // --- Attachments ---
  listAttachments(noteId: number) {
    return this.req<{ attachments: Array<{ id: string; filename: string; original_filename?: string; file_size?: number; file_type?: string; uploaded_at?: string }> }>(`/notes/${noteId}/attachments`);
  }

  /** Datei als Anhang hochladen (multipart; uri = lokale Datei, z.B. aus dem Document-Picker) */
  async uploadAttachment(noteId: number, file: { uri: string; name: string; mimeType?: string }): Promise<{ attachment_id: string; filename: string }> {
    const form = new FormData();
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    } as any);
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/notes/${noteId}/attachments`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PoznoteError(res.status, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async deleteAttachment(noteId: number, attachmentId: string) {
    return this.req<{ success: boolean }>(`/notes/${noteId}/attachments/${attachmentId}`, { method: 'DELETE' });
  }

  /** Anhang als Text roh laden (z.B. SVG-Zeichnungen) */
  async getAttachmentText(noteId: number, attachmentId: string): Promise<string> {
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/notes/${noteId}/attachments/${attachmentId}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new PoznoteError(res.status, `HTTP ${res.status}`);
    return res.text();
  }

  /** Anhang als Bytes laden (für Teilen/Speichern) */
  async getAttachmentBytes(noteId: number, attachmentId: string): Promise<Uint8Array> {
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/notes/${noteId}/attachments/${attachmentId}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new PoznoteError(res.status, `HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

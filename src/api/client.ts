/**
 * Poznote REST API Client.
 * Auth: HTTP Basic + X-User-ID header.
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
}

export class PoznoteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class PoznoteClient {
  constructor(public cfg: PoznoteConfig) {}

  private authHeader(): string {
    const raw = `${this.cfg.username}:${this.cfg.password}`;
    return 'Basic ' + btoa(raw);
  }

  private async req<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    // Timeout + ein Retry: Manche Server bewerben HTTP/3 (Alt-Svc), beantworten QUIC aber nicht —
    // erste Verbindungen hängen dann bis zum Systemtimeout. Der Retry läuft dann über TCP.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/api/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: this.authHeader(),
          'X-User-ID': this.cfg.userId ?? '1',
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      if (attempt < 1) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 400));
        return this.req<T>(path, init, attempt + 1);
      }
      throw new PoznoteError(0, 'network');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const isHtml = text.trimStart().startsWith('<');
      const detail = isHtml ? 'HTML-Fehlerseite (ggf. WAF/CSRF)' : text.slice(0, 200);
      throw new PoznoteError(res.status, `HTTP ${res.status}: ${detail}`);
    }
    return res.json() as Promise<T>;
  }

  // --- Notes ---
  listNotes(params: { folder_id?: number; tag?: string; search?: string } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.req<{ notes: Note[] }>(`/notes${qs ? `?${qs}` : ''}`);
  }

  getNote(id: number) {
    return this.req<{ note: Note }>(`/notes/${id}`);
  }

  createNote(input: { heading: string; content: string; type?: string; folder_id?: number; tags?: string; workspace?: string }) {
    return this.req<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) });
  }

  updateNote(id: number, patch: Partial<Pick<Note, 'heading' | 'content' | 'tags' | 'folder_id' | 'favorite'>>) {
    return this.req<{ success: boolean }>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
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

  // --- Sharing ---
  getShare(id: number) {
    return this.req<{ shared: boolean; url?: string; token?: string }>(`/notes/${id}/share`);
  }

  shareNote(id: number, opts: { theme?: string; indexable?: boolean; access_mode?: string } = {}) {
    return this.req<{ success: boolean; url?: string; token?: string; share_url?: string }>(`/notes/${id}/share`, { method: 'POST', body: JSON.stringify({ indexable: false, ...opts }) });
  }

  revokeShare(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}/share`, { method: 'DELETE' });
  }

  // --- Tasks (serverseitige Tasklisten) ---
  listTasks(workspace?: string) {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.req<{ notes: Array<{ id: number; heading: string; folder?: string; tasks: Array<{ id: number; text: string; completed: boolean; dueAt?: string | null }> }> }>(`/tasks${qs}`);
  }

  updateTask(noteId: number, taskId: number, patch: { completed?: boolean; text?: string; priority?: string | null }) {
    return this.req<{ success: boolean }>(`/notes/${noteId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }

  // --- Workspaces ---
  listWorkspaces() {
    return this.req<{ workspaces: Array<{ name: string; color?: string | null }> }>('/workspaces');
  }

  // --- Trash ---
  listTrash() {
    return this.req<{ notes: Note[] }>('/trash');
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
  listFolders(workspace?: string) {
    const qs = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.req<{ folders: unknown[] }>(`/folders${qs}`);
  }

  createFolder(name: string, workspace?: string) {
    return this.req<{ id: number }>('/folders', { method: 'POST', body: JSON.stringify({ name, ...(workspace ? { workspace } : {}) }) });
  }

  // --- Attachments ---
  listAttachments(noteId: number) {
    return this.req<{ attachments: Array<{ id: string; filename: string; original_filename?: string; file_size?: number; file_type?: string; uploaded_at?: string }> }>(`/notes/${noteId}/attachments`);
  }
}

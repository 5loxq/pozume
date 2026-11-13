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

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/api/v1${path}`, {
        ...init,
        headers: {
          Authorization: this.authHeader(),
          'X-User-ID': this.cfg.userId ?? '1',
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (e) {
      throw new PoznoteError(0, 'network');
    }
    if (!res.ok) {
      const text = await res.text();
      throw new PoznoteError(res.status, text.slice(0, 300));
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
    return this.req<{ success: boolean }>(`/notes/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
  }

  deleteNote(id: number) {
    return this.req<{ success: boolean }>(`/notes/${id}`, { method: 'DELETE' });
  }

  // --- Folders ---
  listFolders() {
    return this.req<{ folders: unknown[] }>('/folders');
  }

  createFolder(name: string, workspace?: string) {
    return this.req<{ id: number }>('/folders', { method: 'POST', body: JSON.stringify({ name, workspace }) });
  }
}

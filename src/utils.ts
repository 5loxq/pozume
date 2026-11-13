export function formatRelativeDate(iso?: string, locale = 'de'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diffMin < 1) return locale === 'de' ? 'gerade eben' : 'just now';
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return rtf.format(-diffH, 'hour');
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return rtf.format(-diffD, 'day');
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

/** Erste ~2 Zeilen Klartext aus Markdown/HTML-Inhalt */
export function excerpt(content?: string, max = 120): string {
  if (!content) return '';
  const text = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>\-\[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

/** Checkbox-Aufgaben aus Markdown extrahieren: [ ] offen, [x] erledigt */
export interface Task { noteId: number; noteHeading: string; text: string; done: boolean; lineIndex: number }

export function extractTasks(content: string | undefined, noteId: number, noteHeading: string): Task[] {
  if (!content) return [];
  const out: Task[] = [];
  content.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) {
      out.push({ noteId, noteHeading, text: m[2].trim(), done: m[1].toLowerCase() === 'x', lineIndex: i });
    }
  });
  return out;
}

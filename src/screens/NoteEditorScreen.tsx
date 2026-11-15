import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, FlatList, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { setReminder, removeReminder } from '../api/reminders';
import { enqueueWrite, removeWrite } from '../api/offlineQueue';
import { lockNote, unlockNoteRecord, isNoteLocked, verifyPin, hasPin, setPin } from '../api/noteLock';
import FolderPickerSheet from '../components/FolderPickerSheet';
import MarkdownView from '../components/MarkdownView';
import PromptModal from '../components/PromptModal';
import DrawingEditor, { isDrawingContent, emptyDrawingHtml } from '../components/DrawingEditor';
import { usePalette, spacing, radius, typeFor, primaryButton, shadow,
  Palette,
} from '../theme';
import { t, getLocale } from '../i18n';
import type { PoznoteClient, Note, Backlink, TemplateInfo, NoteLockInfo } from '../api';
import { base64FromBytes } from '../utils';

interface Props {
  client: PoznoteClient;
  note: Note | null;          // null = neue Notiz
  drawing?: boolean;          // true = neue Notiz startet als Zeichnung
  onClose: () => void;
  onSaved: (note: Note) => void;
  onDeleted: (id: number) => void;
  onOpenNote?: (note: Note) => void;
  onOpenVersions?: (noteId: number) => void;
}

interface Attachment { id: string; filename: string; original_filename?: string; file_size?: number; file_type?: string }

/** Farb-Palette für Notiz-Karten (Hex geht direkt an den Server, unabhängig von dessen Palette) */
const NOTE_COLORS = ['#3b82f6', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed', '#db2777', '#0d9488'];

export default function NoteEditorScreen({ client, note, drawing, onClose, onSaved, onDeleted, onOpenNote, onOpenVersions }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const locale = getLocale();
  const isNew = note == null;
  const [heading, setHeading] = useState(note?.heading ?? '');
  const [content, setContent] = useState(isNew && drawing ? emptyDrawingHtml() : (note?.content ?? ''));
  const [tags, setTags] = useState(note?.tags ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'dirty' | 'queued'>('idle');
  const [noteId, setNoteId] = useState<number | null>(note?.id ?? null);
  const [folderId, setFolderId] = useState<number | null>(note?.folder_id ?? null);
  const [favorite, setFavorite] = useState(!!note?.favorite);
  // Die Notizliste liefert keinen Inhalt — die volle Notiz muss nachgeladen werden,
  // bevor der Editor interaktiv wird (sonst überschreibt Autosave leeren Inhalt).
  const [loaded, setLoaded] = useState(isNew);
  const noteIdRef = useRef<number | null>(note?.id ?? null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ heading, content, tags });
  latest.current = { heading, content, tags };
  // Version-Token des Servers für optimistische Konkurrenz (if_version)
  const versionRef = useRef<string | undefined>(note?.version);
  // Eindeutiger Schlüssel für die Offline-Queue (neue Notizen haben noch keine ID)
  const localQueueKey = useRef(`new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).current;
  // Editor-Session für den Server-Edit-Lock
  const editorSessionId = useRef(`pozume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).current;
  const lockHeld = useRef(false);
  const lockTried = useRef(false);
  const [foreignLock, setForeignLock] = useState<NoteLockInfo | null>(null);
  const [uploading, setUploading] = useState(false);

  const persist = async (opts: { ignoreVersion?: boolean } = {}) => {
    setSaveState('saving');
    const body = { heading: latest.current.heading, content: latest.current.content, tags: latest.current.tags };
    const queueKey = noteIdRef.current != null ? `note-${noteIdRef.current}` : localQueueKey;
    try {
      if (noteIdRef.current == null) {
        const res = await client.createNote({
          heading: body.heading || 'Ohne Titel',
          content: body.content,
          type: isDrawingContent(body.content) ? 'note' : 'markdown',
          tags: body.tags,
        });
        noteIdRef.current = res.note.id;
        setNoteId(res.note.id);
        versionRef.current = res.note.version;
        onSaved(res.note);
      } else {
        // if_version: wurde die Notiz zwischenzeitlich woanders geändert,
        // antwortet der Server 409 mit dem aktuellen Stand — kein stilles Überschreiben.
        const res = await client.updateNote(noteIdRef.current, {
          ...body,
          ...(opts.ignoreVersion ? {} : versionRef.current ? { if_version: versionRef.current } : {}),
        });
        if (res.note?.version) versionRef.current = res.note.version;
        onSaved({ ...(note as Note), ...body, updated_at: new Date().toISOString() });
      }
      setSaveState('saved');
      removeWrite(queueKey).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (e?.status === 0) {
        // Offline: Schreibvorgang dauerhaft einreihen — kein Datenverlust bei App-Kill.
        // Die Queue wird beim nächsten Start/Vordergrund-Wechsel automatisch geleert.
        enqueueWrite({
          key: queueKey,
          kind: noteIdRef.current == null ? 'create' : 'update',
          noteId: noteIdRef.current ?? undefined,
          body,
        }).catch(() => {});
        setSaveState('queued');
        return;
      }
      if (e?.status === 409 && e?.data?.code === 'version_conflict') {
        setSaveState('dirty');
        handleVersionConflict(e.data.current);
        return;
      }
      setSaveState('dirty');
      const msg = e?.message ?? String(e);
      Alert.alert(t('common.error'), msg.includes('403') ? t('editor.lockFailed') : msg);
    }
  };

  /** 409 version_conflict: Nutzer entscheidet, ob die eigene oder die Server-Version gewinnt */
  const handleVersionConflict = (current: { version?: string; heading?: string; content?: string }) => {
    Alert.alert(t('editor.conflictTitle'), t('editor.conflictText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('editor.conflictUseServer'),
        onPress: () => {
          setHeading(current.heading ?? '');
          setContent(current.content ?? '');
          versionRef.current = current.version;
          setSaveState('saved');
        },
      },
      {
        text: t('editor.conflictOverwrite'), style: 'destructive',
        onPress: () => { persist({ ignoreVersion: true }); },
      },
    ]);
  };

  // Autosave 1.2s nach letzter Eingabe
  const scheduleSave = () => {
    setSaveState('dirty');
    ensureLock();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 1200);
  };

  // --- Server-Edit-Lock: sichtbar machen, wer die Notiz offen hat ---
  // Lock beim ersten Editieren nehmen, per Heartbeat halten, beim Verlassen freigeben
  const ensureLock = () => {
    if (note?.id == null || lockTried.current) return;
    lockTried.current = true;
    client.acquireNoteLock(note.id, editorSessionId)
      .then(() => { lockHeld.current = true; })
      .catch(() => { /* 423: hält jemand anders — der Status-Poll zeigt das Banner */ });
  };

  // Lock-Status beim Öffnen laden und laufend prüfen (Web-Editor kann ihn jederzeit nehmen)
  useEffect(() => {
    if (note?.id == null) return;
    let cancelled = false;
    const check = () => {
      client.getNoteLock(note.id!)
        .then((r) => {
          if (cancelled) return;
          setForeignLock(r.lock && !r.lock.holder_is_current_editor_session ? r.lock : null);
        })
        .catch(() => {});
    };
    check();
    const iv = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [note?.id, client]);

  // Heartbeat halten + Lock beim Verlassen des Editors freigeben
  useEffect(() => {
    const iv = setInterval(() => {
      if (lockHeld.current && note?.id != null) {
        client.refreshNoteLock(note.id, editorSessionId).catch(() => { lockHeld.current = false; });
      }
    }, 30000);
    return () => {
      clearInterval(iv);
      if (lockHeld.current && note?.id != null) {
        client.releaseNoteLock(note.id, editorSessionId).catch(() => {});
        lockHeld.current = false;
      }
    };
  }, [note?.id, client, editorSessionId]);

  // Beim Schließen: ausstehenden Autosave nicht verwerfen, sondern speichern
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      persistRef.current();
    }
  }, []);

  const confirmDelete = () => {
    if (noteId == null) return onClose();
    Alert.alert(t('editor.deleteConfirmTitle'), t('editor.deleteConfirmText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await client.deleteNote(noteId);
            onDeleted(noteId);
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const [preview, setPreview] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pinPrompt, setPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinned, setPinned] = useState(!!note?.pinned);
  const [shared, setShared] = useState(false);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null);
  // Serverseitiger Schreibschutz (PUT /notes/{id}/locked) — nur wenn der Server das Feld liefert
  const [serverLocked, setServerLocked] = useState(false);
  const [serverLockSupported, setServerLockSupported] = useState(false);
  // Server-Erinnerung (ISO) + lokale Erinnerung
  const [serverReminder, setServerReminder] = useState<string | null>(null);
  // Karten-Farbe (color_hex aus Server-Antwort)
  const [noteColorHex, setNoteColorHex] = useState<string | null>(note?.color_hex ?? null);
  // Notiz-Typ für Konvertierung (markdown ↔ html/note)
  const [noteType, setNoteType] = useState<string | undefined>(note?.type);
  // Vorlagen für neue Notizen
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  // Ältere Excalidraw-Notizen tragen die Zeichnung nur als SVG-Anhang (Inhalt leer oder nur <img>)
  const [svgFallback, setSvgFallback] = useState<string | null>(null);
  const [drawMissing, setDrawMissing] = useState(false);
  // Prompt-Dialoge (plattformübergreifend, ersetzt iOS-only Alert.prompt)
  const [promptKind, setPromptKind] = useState<'pin' | 'reminder' | null>(null);
  const [promptValue, setPromptValue] = useState('');
  // In-Notiz-Suche: Treffer im Inhalt markieren und durchspringen
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findSelection, setFindSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const findMatches = useMemo(() => {
    const q = findQuery.toLowerCase();
    if (!q) return [] as Array<{ start: number; end: number }>;
    const hay = latest.current.content.toLowerCase();
    const out: Array<{ start: number; end: number }> = [];
    let i = hay.indexOf(q);
    while (i >= 0 && out.length < 500) {
      out.push({ start: i, end: i + q.length });
      i = hay.indexOf(q, i + q.length);
    }
    return out;
  }, [findQuery, content]);
  const gotoMatch = (idx: number) => {
    if (findMatches.length === 0) { setFindSelection(undefined); return; }
    const safe = ((idx % findMatches.length) + findMatches.length) % findMatches.length;
    setFindIndex(safe);
    setFindSelection(findMatches[safe]);
  };
  // Erkennung über den Inhalt-STATE (nicht die Prop — bei neuen Notizen ist die Prop null)
  const drawingContent = isDrawingContent(content) ? content : svgFallback;
  const isExcalidraw = note?.type === 'excalidraw' || drawingContent != null;

  // Volle Notiz nachladen (Inhalt fehlt in der Listen-Antwort)
  useEffect(() => {
    if (note?.id == null) return;
    let cancelled = false;
    client.getNote(note.id)
      .then(async (res) => {
        if (cancelled || !res.note) return;
        const n = res.note;
        const c = n.content ?? '';
        setHeading(n.heading ?? '');
        setContent(c);
        setTags(n.tags ?? '');
        setPinned(!!n.pinned);
        setFavorite(!!n.favorite);
        setFolderId(n.folder_id ?? null);
        setServerLocked(!!n.locked);
        setNoteColorHex(n.color_hex ?? null);
        setNoteType(n.type);
        versionRef.current = n.version;
        // Ältere Server-Versionen kennen kein `locked`-Feld — Chip dann gar nicht erst anbieten
        setServerLockSupported('locked' in n);
        // Zeichnung nur als SVG-Anhang? (älteres Format: Inhalt leer oder nur <img>) → SVG laden
        if (!isDrawingContent(c) && (c.trim() === '' || c.includes('excalidraw'))) {
          try {
            const atts = (await client.listAttachments(note.id)).attachments ?? [];
            const svgAtt = atts.find((a) =>
              (a.original_filename || a.filename).toLowerCase().endsWith('.svg') ||
              (a.file_type ?? '').includes('svg'));
            if (!svgAtt) {
              // Zeichnung fehlt (Anhang geloescht?) — Nutzer informieren statt stiller Leere
              if (!cancelled) setDrawMissing(true);
            } else {
              const svg = await client.getAttachmentText(note.id, svgAtt.id);
              if (!cancelled && svg.trimStart().startsWith('<svg')) setSvgFallback(svg);
            }
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [note?.id]);

  // Gespuerrte Notiz: Face ID/Touch ID anbieten, sonst PIN (einmal pro Oeffnen)
  useEffect(() => {
    if (note?.id == null) return;
    (async () => {
      if (!(await isNoteLocked(note.id))) return;
      setLocked(true);
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (hasHardware && enrolled) {
          const res = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Pozume',
            cancelLabel: t('common.cancel'),
          });
          if (res.success) { setLocked(false); return; }
        }
      } catch {}
      setPinPrompt(true); // Biometrie abgebrochen/fehlgeschlagen -> PIN
    })();
    client.getShare(note.id)
      .then((r) => { setShared(!!(r.public ?? r.shared)); setSharedUrl(r.url ?? null); })
      .catch(() => {});
    client.listAttachments(note.id)
      .then((r) => setAttachments(r.attachments ?? []))
      .catch(() => {});
    // Backlinks + Server-Erinnerung laden
    client.getBacklinks(note.id)
      .then((r) => setBacklinks(r.backlinks ?? []))
      .catch(() => setBacklinks([]));
    client.getNoteReminder(note.id)
      .then((r) => setServerReminder(r.reminder?.reminder_at ?? null))
      .catch(() => {});
  }, [note?.id]);

  const openAttachment = async (att: Attachment) => {
    if (noteId == null) return;
    try {
      const bytes = await client.getAttachmentBytes(noteId, att.id);
      const fileName = att.original_filename || att.filename || 'anhang';
      const path = `${FileSystem.cacheDirectory}${fileName.replace(/[/\\]/g, '_')}`;
      await FileSystem.writeAsStringAsync(path, base64FromBytes(bytes), { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: att.file_type || 'application/octet-stream', dialogTitle: fileName });
      }
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const tryUnlock = async () => {
    if (await verifyPin(pinInput)) {
      setLocked(false); setPinPrompt(false); setPinInput('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setPinInput('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const toggleNoteLock = async () => {
    if (noteId == null) return;
    if (await isNoteLocked(noteId)) {
      await unlockNoteRecord(noteId);
      Alert.alert('🪶', t('lock.unlockNote'));
    } else {
      if (!(await hasPin())) {
        setPromptValue('');
        setPromptKind('pin');
      } else {
        await lockNote(noteId);
        Alert.alert('🔒', t('lock.noteLock'));
      }
    }
  };

  const submitPinPrompt = async (pin: string) => {
    if (noteId == null) { setPromptKind(null); return; }
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      // Modal offen lassen und Feedback geben statt still zu schließen
      Alert.alert(t('common.error'), t('lock.enterPass') + ': 4–8 Ziffern');
      return;
    }
    setPromptKind(null);
    await setPin(pin);
    await lockNote(noteId);
    Alert.alert('🔒', t('lock.noteLock'));
  };

  const [showPicker, setShowPicker] = useState(false);

  const togglePin = async () => {
    if (noteId == null) return;
    try {
      await client.setPinned(noteId, !pinned);
      setPinned(!pinned);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('📌', !pinned ? t('editor.pinned') : t('editor.unpinned'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const duplicate = async () => {
    if (noteId == null) return;
    try {
      await client.duplicateNote(noteId);
      onSaved({ ...(note as Note) });
      Alert.alert('🪶', t('editor.duplicated'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const toggleServerLock = async () => {
    if (noteId == null) return;
    try {
      await client.setNoteLocked(noteId, !serverLocked);
      setServerLocked(!serverLocked);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('🔒', !serverLocked ? t('editor.lockSet') : t('editor.lockRemoved'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const archive = () => {
    if (noteId == null) return;
    Alert.alert(t('editor.archiveConfirmTitle'), t('editor.archiveConfirmText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('editor.archive'), style: 'destructive',
        onPress: async () => {
          try {
            await client.archiveNote(noteId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('🪶', t('editor.archived'));
            onSaved({ ...(note as Note) });
            onClose();
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const revokeShare = () => {
    if (noteId == null) return;
    Alert.alert(t('editor.shareRevoke'), t('editor.shareRevokeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await client.revokeShare(noteId);
            setShared(false); setSharedUrl(null);
            Alert.alert('🪶', t('editor.shareRevoked'));
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const shareLink = async () => {
    if (noteId == null) return;
    try {
      if (shared) {
        Alert.alert('🔗 ' + t('editor.shareActive'), sharedUrl ?? '', [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('share.noteTitle'), onPress: () => { if (sharedUrl) Share.share({ message: sharedUrl }).catch(() => {}); } },
          { text: t('editor.shareRevoke'), style: 'destructive', onPress: revokeShare },
        ]);
        return;
      }
      const res = await client.shareNote(noteId);
      const url = res.url ?? res.share_url ?? (res.token ? `${client.cfg.baseUrl}/${res.token}` : null);
      if (!url) throw new Error('no url');
      setShared(true); setSharedUrl(url);
      Share.share({ title: latest.current.heading || 'Pozume', message: url }).catch(() => {});
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  // Erinnerung: Server-Reminder + lokale Notification (funktioniert auch offline)
  const promptReminder = () => {
    if (noteId == null) return;
    if (serverReminder) {
      const when = new Date(serverReminder);
      Alert.alert('⏰ ' + t('reminder.title'), t('reminder.existing', {
        time: isNaN(when.getTime()) ? serverReminder : when.toLocaleString(locale),
      }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('reminder.set'), onPress: () => { setPromptValue(''); setPromptKind('reminder'); } },
        {
          text: t('reminder.remove'), style: 'destructive',
          onPress: async () => {
            try {
              await client.removeNoteReminder(noteId);
              await removeReminder(noteId);
              setServerReminder(null);
              Alert.alert('🪶', t('reminder.serverRemoved'));
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message ?? String(e));
            }
          },
        },
      ]);
      return;
    }
    setPromptValue('');
    setPromptKind('reminder');
  };

  const submitReminderPrompt = async (value: string) => {
    setPromptKind(null);
    if (noteId == null) return;
    // "JJJJ-MM-TT HH:MM" (Datum leer lassen = heute)
    const m = value.trim().match(/^(?:(\d{4})-(\d{2})-(\d{2})\s+)?(\d{1,2}):(\d{2})$/);
    if (!m) {
      Alert.alert(t('common.error'), t('reminder.timePrompt'));
      return;
    }
    const d = new Date();
    if (m[1]) d.setFullYear(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    d.setHours(parseInt(m[4], 10), parseInt(m[5], 10), 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    try {
      // Server-Erinnerung zuerst — sie funktioniert auch ohne Notification-Recht.
      // Die lokale Notification ist Bonus (offline/ohne Server-Push) und darf scheitern.
      await client.setNoteReminder(noteId, d.toISOString(), { message: latest.current.heading || undefined });
      setServerReminder(d.toISOString());
      let localWarning = false;
      try {
        await setReminder(noteId, latest.current.heading || 'Notiz', d.toISOString());
      } catch { localWarning = true; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('🪶', localWarning
        ? `${t('reminder.serverSaved')} — ${t('reminder.localDenied')}`
        : t('reminder.serverSaved'));
    } catch (e: any) {
      Alert.alert(t('common.error'), String(e?.message ?? e));
    }
  };

  const shareNote = async () => {
    try {
      await Share.share({
        title: latest.current.heading || 'Pozume',
        message: `# ${latest.current.heading}\n\n${latest.current.content ?? ''}`,
      });
    } catch {}
  };

  // --- Export (Markdown/HTML über den Server, dann Teilen-Menü) ---
  const exportNoteAs = async (format: 'markdown' | 'html') => {
    if (noteId == null) return;
    try {
      const text = await client.exportNote(noteId, format);
      const safeName = (latest.current.heading || 'notiz').replace(/[/\\?%*:|"<>\n]/g, '_').slice(0, 60) || 'notiz';
      const path = `${FileSystem.cacheDirectory}${safeName}.${format === 'markdown' ? 'md' : 'html'}`;
      await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: format === 'markdown' ? 'text/markdown' : 'text/html',
          dialogTitle: safeName,
        });
      } else {
        Alert.alert('🪶', t('editor.exported'));
      }
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const exportNote = () => {
    Alert.alert(t('editor.export'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('editor.exportMd'), onPress: () => exportNoteAs('markdown') },
      { text: t('editor.exportHtml'), onPress: () => exportNoteAs('html') },
    ]);
  };

  // --- Anhang hochladen (Document-Picker -> multipart) ---
  const pickAttachment = async () => {
    if (noteId == null || uploading) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      setUploading(true);
      await client.uploadAttachment(noteId, {
        uri: asset.uri,
        name: asset.name ?? 'anhang',
        mimeType: asset.mimeType ?? undefined,
      });
      const atts = await client.listAttachments(noteId);
      setAttachments(atts.attachments ?? []);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('🪶', t('editor.uploaded'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setUploading(false);
    }
  };

  const confirmDeleteAttachment = (att: Attachment) => {
    if (noteId == null) return;
    Alert.alert(t('editor.attachDelete'), att.original_filename || att.filename, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await client.deleteAttachment(noteId, att.id);
            setAttachments((prev) => prev.filter((a) => a.id !== att.id));
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  // --- Karten-Farbe ---
  const applyColor = async (hex: string) => {
    if (noteId == null) return;
    try {
      const res = await client.setNoteColor(noteId, hex);
      setNoteColorHex(res.color_hex ?? (hex || null));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onSaved({ ...(note as Note), color_hex: res.color_hex });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  // --- Vorlagen (nur neue Notizen) ---
  const openTemplates = async () => {
    try {
      if (templates == null) {
        const res = await client.listTemplates();
        setTemplates(res.notes ?? []);
      }
      setShowTemplates(true);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const applyTemplate = async (tpl: TemplateInfo) => {
    setShowTemplates(false);
    try {
      const res = await client.getNote(tpl.id);
      const n = res.note;
      setHeading(n.heading ?? tpl.heading);
      setContent(n.content ?? '');
      setTags(n.tags ?? '');
      setNoteType(n.type);
      scheduleSave();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  // --- Markdown ↔ Rich-Text konvertieren ---
  const convertType = () => {
    if (noteId == null) return;
    const target = noteType === 'markdown' ? 'html' : 'markdown';
    Alert.alert(t('convert.confirmTitle'), t('convert.confirmText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.save'),
        onPress: async () => {
          // Ausstehenden Autosave stoppen — sonst überschreibt er das konvertierte
          // Ergebnis mit dem alten Inhalt (Race zwischen Timer und Server-Antwort)
          if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
          try {
            await client.convertNote(noteId, target);
            // Inhalt in neuem Format nachladen
            const res = await client.getNote(noteId);
            setContent(res.note.content ?? '');
            setHeading(res.note.heading ?? '');
            setTags(res.note.tags ?? '');
            setNoteType(res.note.type);
            setSaveState('saved');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('🪶', t('convert.done'));
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const moveToFolder = async (targetId: number | null) => {
    setShowPicker(false);
    if (noteId == null) return;
    try {
      await client.updateNote(noteId, { folder_id: targetId });
      setFolderId(targetId);
      onSaved({ ...(note as Note), folder_id: targetId });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const toggleFavorite = async () => {
    if (noteId == null) return;
    try {
      // POST /notes/{id}/favorite toggelt serverseitig; PATCH favorite bleibt dort wirkungslos
      await client.toggleFavorite(noteId);
      setFavorite((v) => !v);
      onSaved({ ...(note as Note), favorite: !favorite });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const statusLabel =
    saveState === 'saving' ? t('editor.saving') :
    saveState === 'saved' ? t('editor.saved') :
    saveState === 'queued' ? t('editor.queued') :
    saveState === 'dirty' ? t('editor.unsaved') : '';

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (locked && pinPrompt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.pinTopBar}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          <Text style={{ fontSize: 52, marginBottom: spacing.lg }}>🔒</Text>
          <Text style={[type.h2, { marginBottom: spacing.lg }]}>{t('lock.noteLocked')}</Text>
          <TextInput
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, fontSize: 22, letterSpacing: 8, textAlign: 'center', width: 200, color: colors.text }}
            secureTextEntry keyboardType="number-pad" maxLength={8}
            value={pinInput} onChangeText={setPinInput}
            onSubmitEditing={tryUnlock}
            autoFocus
          />
          <TouchableOpacity style={[primaryButton, { marginTop: spacing.lg, paddingHorizontal: spacing.xxl }]} onPress={tryUnlock}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('lock.unlockNote')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { if (saveTimer.current) { clearTimeout(saveTimer.current); persist(); } setPreview((v) => !v); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.previewBtn}>{preview ? t('editor.write') : t('editor.preview')}</Text>
        </TouchableOpacity>
        <Text style={styles.status} numberOfLines={1}>{statusLabel}</Text>
        {!isNew && (
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => { setFindOpen((v) => !v); if (!findOpen) { setFindQuery(''); setFindSelection(undefined); } }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.folderIcon}>🔍</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={shareNote} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.folderIcon}>↗</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={promptReminder} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.folderIcon, serverReminder && styles.reminderActive]}>⏰</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleNoteLock} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.folderIcon}>🔒</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleFavorite}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.starBtn, favorite && styles.starActive]}>{favorite ? '★' : '☆'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.delete}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isNew ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionRow} contentContainerStyle={styles.actionRowContent}>
          <TouchableOpacity style={styles.actionChip} onPress={() => setShowPicker(true)}>
            <Text style={styles.actionChipIcon}>📁</Text>
            <Text style={styles.actionChipText}>{t('editor.moveFolder')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={togglePin}>
            <Text style={styles.actionChipIcon}>{pinned ? '📌' : '📍'}</Text>
            <Text style={styles.actionChipText}>{pinned ? t('editor.unpin') : t('editor.pin')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={duplicate}>
            <Text style={styles.actionChipIcon}>⧉</Text>
            <Text style={styles.actionChipText}>{t('editor.duplicate')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={shareLink}>
            <Text style={styles.actionChipIcon}>{shared ? '🔗' : '⛓︎'}</Text>
            <Text style={styles.actionChipText}>{shared ? t('editor.shareActive') : t('editor.shareLink')}</Text>
          </TouchableOpacity>
          {serverLockSupported ? (
            <TouchableOpacity style={styles.actionChip} onPress={toggleServerLock}>
              <Text style={styles.actionChipIcon}>{serverLocked ? '🔒' : '🔓'}</Text>
              <Text style={styles.actionChipText}>{serverLocked ? t('editor.unlock') : t('editor.lock')}</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenVersions && noteId != null ? (
            <TouchableOpacity style={styles.actionChip} onPress={() => onOpenVersions(noteId)}>
              <Text style={styles.actionChipIcon}>🕘</Text>
              <Text style={styles.actionChipText}>{t('editor.versions')}</Text>
            </TouchableOpacity>
          ) : null}
          {!isExcalidraw ? (
            <TouchableOpacity style={styles.actionChip} onPress={convertType}>
              <Text style={styles.actionChipIcon}>⇄</Text>
              <Text style={styles.actionChipText}>{noteType === 'markdown' ? t('convert.toHtml') : t('convert.toMarkdown')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={[styles.actionChip, styles.actionChipDanger]} onPress={archive}>
            <Text style={styles.actionChipIcon}>📦</Text>
            <Text style={[styles.actionChipText, styles.actionChipTextDanger]}>{t('editor.archive')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={exportNote}>
            <Text style={styles.actionChipIcon}>📤</Text>
            <Text style={styles.actionChipText}>{t('editor.export')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionChip, uploading && { opacity: 0.6 }]} onPress={pickAttachment} disabled={uploading}>
            {uploading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={styles.actionChipIcon}>📎</Text>}
            <Text style={styles.actionChipText}>{uploading ? t('editor.uploading') : t('editor.addAttachment')}</Text>
          </TouchableOpacity>
          <View style={styles.colorRow}>
            <Text style={styles.actionChipIcon}>🎨</Text>
            {NOTE_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.colorDot, { backgroundColor: c }, (noteColorHex ?? '').toLowerCase() === c && styles.colorDotActive]}
                onPress={() => applyColor(c)}
                hitSlop={{ left: 3, right: 3, top: 3, bottom: 3 }}
              />
            ))}
            {noteColorHex ? (
              <TouchableOpacity style={[styles.colorDot, styles.colorDotNone]} onPress={() => applyColor('')} hitSlop={{ left: 3, right: 3, top: 3, bottom: 3 }}>
                <Text style={styles.colorNoneText}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </ScrollView>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionRow} contentContainerStyle={styles.actionRowContent}>
          <TouchableOpacity style={styles.actionChip} onPress={openTemplates}>
            <Text style={styles.actionChipIcon}>📋</Text>
            <Text style={styles.actionChipText}>{t('templates.apply')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
      {findOpen && (
        <View style={styles.findBar}>
          <TextInput
            style={styles.findInput}
            placeholder={t('editor.find')}
            placeholderTextColor={colors.textFaint}
            value={findQuery}
            onChangeText={(v) => { setFindQuery(v); setFindIndex(0); setFindSelection(undefined); }}
            onSubmitEditing={() => gotoMatch(findIndex)}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.findCount}>
            {findMatches.length > 0 ? `${findIndex + 1}/${findMatches.length}` : (findQuery ? '0' : '')}
          </Text>
          <TouchableOpacity style={styles.findBtn} onPress={() => gotoMatch(findIndex - 1)} disabled={findMatches.length === 0}>
            <Text style={styles.findBtnText}>↑</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.findBtn} onPress={() => gotoMatch(findIndex + 1)} disabled={findMatches.length === 0}>
            <Text style={styles.findBtnText}>↓</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.findBtn} onPress={() => { setFindOpen(false); setFindSelection(undefined); }}>
            <Text style={styles.findBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      {saveState === 'queued' && (
        <View style={[styles.missingBanner, { backgroundColor: colors.primarySoft }]}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>
            📴 {t('editor.queued')} — {t('editor.queuedHint')}
          </Text>
        </View>
      )}
      {foreignLock && (
        <View style={[styles.missingBanner, { backgroundColor: colors.primarySoft }]}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>
            {t('editor.lockBanner', {
              who: foreignLock.holder_is_current_user
                ? t('editor.lockByYou')
                : foreignLock.holder_is_public
                  ? t('editor.lockByPublic')
                  : foreignLock.holder_username ?? '?',
            })}
          </Text>
        </View>
      )}
      {serverLocked && (
        <View style={[styles.missingBanner, { backgroundColor: colors.primarySoft }]}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>
            🔒 {t('editor.locked')}
          </Text>
        </View>
      )}
      {drawMissing && (
        <View style={[styles.missingBanner, { backgroundColor: colors.dangerSoft }]}>
          <Text style={{ color: colors.danger, fontSize: 13 }}>
            {t('draw.missing')}
          </Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          placeholder={t('editor.titlePlaceholder')}
          placeholderTextColor={colors.textFaint}
          value={heading}
          onChangeText={(v) => { setHeading(v); scheduleSave(); }}
          editable={!serverLocked}
        />
        {isExcalidraw && drawingContent ? (
          <DrawingEditor
            content={drawingContent}
            saveAsExcalidrawHtml={svgFallback != null && !isDrawingContent(content)}
            onChange={(next) => { setContent(next); scheduleSave(); }}
          />
        ) : preview ? (
          <View style={styles.previewWrap}>
            <MarkdownView content={content} />
          </View>
        ) : (
          <TextInput
            style={styles.contentInput}
            placeholder={t('editor.contentPlaceholder')}
            placeholderTextColor={colors.textFaint}
            value={content}
            onChangeText={(v) => { setContent(v); setFindSelection(undefined); scheduleSave(); }}
            selection={findSelection}
            editable={!serverLocked}
            multiline
            textAlignVertical="top"
          />
        )}
        <TextInput
          style={styles.tagsInput}
          placeholder={t('tags.addTag')}
          placeholderTextColor={colors.textFaint}
          value={tags}
          onChangeText={(v) => { setTags(v); scheduleSave(); }}
          autoCapitalize="none"
        />
        {!isExcalidraw && (
          <Text style={styles.meta}>
            {content.trim()
              ? `${t('editor.wordCount', { n: content.trim().split(/\s+/).length })} · ${t('editor.readingTime', { n: Math.max(1, Math.ceil(content.trim().split(/\s+/).length / 200)) })}`
              : ''}
          </Text>
        )}
        {attachments.length > 0 && (
          <View style={styles.attachSection}>
            <Text style={styles.attachTitle}>📎 {t('editor.attachments')} ({attachments.length})</Text>
            <View style={styles.attachRow}>
              {attachments.map((att) => (
                <TouchableOpacity key={att.id} style={styles.attachChip} onPress={() => openAttachment(att)} onLongPress={() => confirmDeleteAttachment(att)} activeOpacity={0.7}>
                  <Text style={styles.attachName} numberOfLines={1}>{att.original_filename || att.filename}</Text>
                  {att.file_size != null ? (
                    <Text style={styles.attachSize}>{att.file_size >= 1048576 ? `${(att.file_size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(att.file_size / 1024))} KB`}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {!isNew && backlinks != null && backlinks.length > 0 && (
          <View style={styles.backlinkSection}>
            <Text style={styles.attachTitle}>🔗 {t('backlinks.title')} ({backlinks.length})</Text>
            {backlinks.map((bl) => (
              <TouchableOpacity
                key={bl.id}
                style={styles.backlinkRow}
                activeOpacity={0.7}
                onPress={onOpenNote ? () => onOpenNote({ id: bl.id, heading: bl.heading }) : undefined}
              >
                <Text style={styles.backlinkHeading} numberOfLines={1}>{bl.heading}</Text>
                {bl.mentions && bl.mentions.length > 0 ? (
                  <Text style={styles.backlinkPreview} numberOfLines={2}>{bl.mentions[0].preview}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
      <FolderPickerSheet
        visible={showPicker}
        client={client}
        currentFolderId={folderId}
        onSelect={moveToFolder}
        onClose={() => setShowPicker(false)}
      />
      <PromptModal
        visible={promptKind === 'pin'}
        title={t('lock.enterPass')}
        message="4–8 Ziffern"
        secure
        keyboardType="number-pad"
        maxLength={8}
        defaultValue={promptValue}
        onCancel={() => setPromptKind(null)}
        onSubmit={submitPinPrompt}
      />
      <PromptModal
        visible={promptKind === 'reminder'}
        title={t('reminder.set')}
        message={`${t('reminder.datePrompt')} · ${t('reminder.timePrompt')}`}
        placeholder="2026-01-31 09:00"
        defaultValue={promptValue}
        onCancel={() => setPromptKind(null)}
        onSubmit={submitReminderPrompt}
      />
      <Modal visible={showTemplates} transparent animationType="slide" onRequestClose={() => setShowTemplates(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={() => setShowTemplates(false)} />
          <View style={[styles.sheet, shadow]}>
            <Text style={styles.sheetTitle}>📋 {t('templates.title')}</Text>
            {templates && templates.length > 0 ? (
              <FlatList
                data={templates}
                keyExtractor={(x) => String(x.id)}
                style={styles.tplList}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.tplRow} onPress={() => applyTemplate(item)}>
                    <Text style={styles.tplIcon}>📄</Text>
                    <View style={styles.tplTextWrap}>
                      <Text style={styles.tplName} numberOfLines={1}>{item.heading}</Text>
                      {item.folder ? <Text style={styles.tplMeta} numberOfLines={1}>{item.folder}</Text> : null}
                    </View>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={styles.tplEmpty}>{t('templates.empty')}</Text>
            )}
            <TouchableOpacity style={styles.tplClose} onPress={() => setShowTemplates(false)}>
              <Text style={styles.tplCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  missingBanner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  findBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  findInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: 6, fontSize: 14, color: colors.text,
  },
  findCount: { fontSize: 12, color: colors.textFaint, minWidth: 34, textAlign: 'center' },
  findBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  findBtnText: { fontSize: 15, color: colors.primary, fontWeight: '700' },
  pinTopBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { fontSize: 26, color: colors.text, width: 40 },
  status: { ...type.muted, flex: 1, textAlign: 'center', flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'flex-end' },
  actionRow: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  actionRowContent: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  actionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  actionChipDanger: { backgroundColor: colors.dangerSoft },
  actionChipIcon: { fontSize: 14 },
  actionChipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  actionChipTextDanger: { color: colors.danger },
  starBtn: { fontSize: 22, color: colors.textFaint },
  folderIcon: { fontSize: 20 },
  reminderActive: { color: colors.primary },
  starActive: { color: colors.star },
  delete: { fontSize: 20 },
  content: { padding: spacing.lg, paddingBottom: 60 },
  previewBtn: { color: colors.primary, fontWeight: '700', fontSize: 14, width: 80 },
  previewWrap: { minHeight: 300 },
  meta: { ...type.faint(), textAlign: 'right', marginTop: spacing.lg },
  titleInput: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4, color: colors.text, marginBottom: spacing.md },
  contentInput: { fontSize: 16, lineHeight: 26, color: colors.text, minHeight: 300, letterSpacing: 0.1 },
  tagsInput: {
    marginTop: spacing.lg, fontSize: 14, fontWeight: '600', color: colors.primary,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  attachSection: { marginTop: spacing.lg },
  attachTitle: { ...type.h2, fontSize: 14, marginBottom: spacing.sm },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  attachChip: {
    backgroundColor: colors.primarySoft, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: '100%',
  },
  attachName: { fontSize: 13, fontWeight: '600', color: colors.primary },
  attachSize: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
  backlinkSection: { marginTop: spacing.lg },
  backlinkRow: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm,
  },
  backlinkHeading: { fontSize: 13, fontWeight: '700', color: colors.text },
  backlinkPreview: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  colorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  colorDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: colors.text },
  colorDotNone: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  colorNoneText: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(21,26,35,0.5)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xl, maxHeight: '70%',
  },
  sheetTitle: { ...type.h2, textAlign: 'center', paddingVertical: spacing.md },
  tplList: { paddingHorizontal: spacing.lg, maxHeight: 320 },
  tplRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tplIcon: { fontSize: 18 },
  tplTextWrap: { flex: 1 },
  tplName: { ...type.body, fontWeight: '600' },
  tplMeta: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
  tplEmpty: { ...type.muted, textAlign: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  tplClose: {
    alignSelf: 'center', marginTop: spacing.lg, backgroundColor: colors.primary,
    borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
  },
  tplCloseText: { color: '#fff', fontWeight: '700' },
});

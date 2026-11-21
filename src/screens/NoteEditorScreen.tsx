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
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { setReminder, removeReminder } from '../api/reminders';
import { enqueueWrite, removeWrite, takeCreatedId } from '../api/offlineQueue';
import { saveDraft, readDraft, clearDraft, latestNewDraft, type Draft } from '../api/drafts';
import { getOfflineAttachment, readOfflineAttachmentBytes, downloadAttachmentOffline, removeOfflineAttachment } from '../api/attachmentStore';
import { enqueueUpload, uploadsFor, removeUpload } from '../api/uploadQueue';
import { lockNote, unlockNoteRecord, isNoteLocked, verifyPin, hasPin, setPin, pinRetryDelay } from '../api/noteLock';
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
  /** Vorbelegung für neue Notizen (z.B. aus dem Teilen-Menü übernommen) */
  prefill?: { heading: string; content: string } | null;
  /** Datei, die nach dem ersten erfolgreichen Speichern als Anhang hochgeladen wird */
  initialAttachment?: { uri: string; name?: string; mimeType?: string } | null;
  /** Alle Notizen (für Notizlinks und Link-Auswahl) */
  allNotes?: Note[];
  onClose: () => void;
  onSaved: (note: Note) => void;
  onDeleted: (id: number) => void;
  onOpenNote?: (note: Note) => void;
  onOpenVersions?: (noteId: number) => void;
}

interface Attachment { id: string; filename: string; original_filename?: string; file_size?: number; file_type?: string }

/** Farb-Palette für Notiz-Karten (Hex geht direkt an den Server, unabhängig von dessen Palette) */
const NOTE_COLORS = ['#3b82f6', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed', '#db2777', '#0d9488'];

/** Notiz-Typen, die der Editor sicher bearbeiten kann. Alles andere (html, tasklist, …)
 *  wird schreibgeschützt geöffnet — ein ungeeigneter Editor würde die Formatierung beschädigen. */
const EDITABLE_TYPES = new Set(['markdown', 'note', 'excalidraw']);

export default function NoteEditorScreen({ client, note, drawing, prefill, initialAttachment, allNotes, onClose, onSaved, onDeleted, onOpenNote, onOpenVersions }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const locale = getLocale();
  const isNew = note == null;
  const [heading, setHeading] = useState(note?.heading ?? prefill?.heading ?? '');
  const [content, setContent] = useState(
    isNew && drawing ? emptyDrawingHtml() : (note?.content ?? prefill?.content ?? ''),
  );
  const [tags, setTags] = useState(note?.tags ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'dirty' | 'local' | 'queued' | 'failed' | 'conflict'>('idle');
  const [noteId, setNoteId] = useState<number | null>(note?.id ?? null);
  const [folderId, setFolderId] = useState<number | null>(note?.folder_id ?? null);
  // Zielordner als Ref — persist/scheduleSave feuern in Timern mit älteren
  // Closures. Bei neuen Notizen ist dies der VOR dem ersten Speichern gewählte
  // Zielordner (P1-12): Er wandert mit ins createNote bzw. in die Offline-Queue.
  const folderIdRef = useRef<number | null>(note?.folder_id ?? null);
  folderIdRef.current = folderId;
  // Anzeigename des gewählten Ordners (Chip-Label bei neuen Notizen)
  const [pickedFolderName, setPickedFolderName] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(!!note?.favorite);
  // Die Notizliste liefert keinen Inhalt — die volle Notiz muss nachgeladen werden,
  // bevor der Editor interaktiv wird (sonst überschreibt Autosave leeren Inhalt).
  const [loaded, setLoaded] = useState(isNew);
  // Nachladen fehlgeschlagen (offline): Editor sperren statt leeren Inhalt
  // editierbar zu zeigen — Autosave würde sonst den echten Inhalt überschreiben
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const noteIdRef = useRef<number | null>(note?.id ?? null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ heading, content, tags });
  latest.current = { heading, content, tags };
  // Entwurf wiederhergestellt (letzte Sitzung endete vor dem Synchronisieren)
  const [draftRestored, setDraftRestored] = useState(false);
  // Offline-Fassung, die beim Synchronisieren mit dem Server kollidiert ist
  const [conflictDraft, setConflictDraft] = useState<Draft | null>(null);
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
  // Fehlgeschlagener Upload (Datei liegt noch lokal) — Wiederholen anbieten
  const [failedUpload, setFailedUpload] = useState<{ uri: string; name: string; mimeType?: string } | null>(null);
  // Offline verfügbare Anhänge (attachmentId -> lokaler Pfad vorhanden)
  const [offlineAtts, setOfflineAtts] = useState<Set<string>>(new Set());
  // Vorhandene Tags des Servers für Vorschläge unter dem Tag-Feld
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  // Notizlink-Auswahl (P2-16: [[Notiztitel]] einfügen)
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  // Initialer Anhang (z.B. aus dem Teilen-Menü): nach dem ersten erfolgreichen
  // persist hochladen und danach lokal verbrauchen — Fehler werden still übersprungen
  const initialAttachmentRef = useRef(initialAttachment ?? null);
  /**
   * Upload mit Duplikatschutz (P1-8): Kam der vorherige Versuch beim Server an,
   * ging aber die Antwort verloren (Timeout), existiert der Anhang bereits —
   * gleicher Name UND gleiche Größe. Liefert true, wenn die Datei (jetzt) auf
   * dem Server liegt; bei Erfolg werden passende Einträge aus der dauerhaften
   * Upload-Queue entfernt (manuelles Nachholen ersetzt das Warten auf den
   * nächsten Flush).
   */
  const uploadWithDupCheck = async (
    noteId: number,
    file: { uri: string; name: string; mimeType?: string },
  ): Promise<boolean> => {
    const size = await FileSystem.getInfoAsync(file.uri)
      .then((i: any) => (i?.exists ? (i.size ?? 0) : 0))
      .catch(() => 0);
    const list = (await client.listAttachments(noteId)).attachments ?? [];
    // Name + Größe ist die beste verfügbare Signatur — Server hat keinen Idempotenz-Schlüssel
    const duplicate = size > 0 && list.some((a) =>
      (a.original_filename || a.filename) === file.name && a.file_size === size,
    );
    if (!duplicate) {
      await client.uploadAttachment(noteId, { uri: file.uri, name: file.name, mimeType: file.mimeType });
    }
    for (const q of await uploadsFor(noteId)) {
      if (q.name === file.name && q.size === size) await removeUpload(q.id);
    }
    return true;
  };
  const uploadInitialAttachment = async () => {
    const file = initialAttachmentRef.current;
    if (!file || noteIdRef.current == null) return;
    // Vor dem Hochladen verbrauchen — ein erneuter persist lädt nicht nochmal
    initialAttachmentRef.current = null;
    try {
      // Duplikatschutz: kam der Upload schon an (verlorene Antwort), nicht erneut
      const uploaded = await uploadWithDupCheck(noteIdRef.current, {
        uri: file.uri,
        name: file.name ?? 'anhang',
        mimeType: file.mimeType,
      });
      if (uploaded) {
        const atts = await client.listAttachments(noteIdRef.current);
        setAttachments(atts.attachments ?? []);
      }
    } catch { /* still überspringen — der Editor darf nicht blockieren */ }
  };

  // In-Flight-Guard: überlappende persist()-Aufrufe (Autosave-Timer + Unmount-
  // Cleanup) würden sonst bei neuen Notizen dieselbe Notiz doppelt anlegen
  const persistingRef = useRef(false);
  // Änderungen, die während eines laufenden persist eingingen (Tastatureingabe,
  // Unmount-Cleanup): Der Abschluss des Requests holt sie nach, statt sie
  // still im lokalen Entwurf liegen zu lassen und fälschlich „gespeichert" zu melden
  const rescheduleRef = useRef(false);
  // Konflikt-Entwurf wiederhergestellt (Banner „Offline-Fassung wiederherstellen"):
  // Der Nutzer hat sich damit bereits für die lokale Fassung entschieden — der
  // nächste Speichervorgang überschreibt die neuere Server-Fassung bewusst und
  // darf dafür keinen erneuten 409-Dialog zur selben Entscheidung auslösen.
  // Verbraucht wird das Flag erst nach einem erfolgreichen Speichern.
  const overwriteNextSaveRef = useRef(false);
  const persist = async (opts: { ignoreVersion?: boolean } = {}) => {
    // Schreibgeschützte Formate und serverseitig gesperrte Notizen niemals
    // zurückschreiben — der PATCH wäre verlorene Arbeit bzw. ein 403 (P0-6)
    if (writeBlockedRef.current) return;
    if (persistingRef.current) { rescheduleRef.current = true; return; }
    persistingRef.current = true;
    setSaveState('saving');
    const snap = { heading: latest.current.heading, content: latest.current.content, tags: latest.current.tags };
    const body = { ...snap };
    const queueKey = noteIdRef.current != null ? `note-${noteIdRef.current}` : localQueueKey;
    const ignoreVersion = opts.ignoreVersion || overwriteNextSaveRef.current;
    try {
      if (noteIdRef.current == null) {
        // Hat der Queue-Flush diese Notiz bereits auf dem Server angelegt
        // (Editor war während des Flushs offen), die ID übernehmen — sonst
        // würde der Autosave dieselbe Notiz ein zweites Mal anlegen
        const created = await takeCreatedId(localQueueKey).catch(() => null);
        if (created != null) {
          noteIdRef.current = created.id;
          setNoteId(created.id);
          versionRef.current = created.version;
        }
      }
      if (noteIdRef.current == null) {
        const res = await client.createNote({
          heading: body.heading || 'Ohne Titel',
          content: body.content,
          type: isDrawingContent(body.content) ? 'note' : 'markdown',
          tags: body.tags,
          // Vor dem ersten Speichern gewählter Zielordner (P1-12 Share-Flow)
          ...(folderIdRef.current != null ? { folder_id: folderIdRef.current } : {}),
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
          ...(ignoreVersion ? {} : versionRef.current ? { if_version: versionRef.current } : {}),
        });
        if (res.note?.version) versionRef.current = res.note.version;
        // Überschreiben war die ausdrückliche Nutzerentscheidung — vollzogen
        if (ignoreVersion) overwriteNextSaveRef.current = false;
        onSaved({ ...(note as Note), ...body, updated_at: new Date().toISOString() });
      }
      removeWrite(queueKey).catch(() => {});
      // Server-Stand ist synchron — lokale Entwürfe dieser Notiz verwerfen
      clearDraft(localQueueKey).catch(() => {});
      if (noteIdRef.current != null) clearDraft(`note-${noteIdRef.current}`).catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Neuere Änderungen während des Requests? Nicht „gespeichert" melden —
      // stattdessen sofort nachspeichern (P0-3: alte Antworten dürfen neuere
      // Änderungen weder zurücksetzen noch als gesichert ausgeben)
      const newer =
        snap.heading !== latest.current.heading ||
        snap.content !== latest.current.content ||
        snap.tags !== latest.current.tags;
      if (newer) {
        setSaveState('dirty');
        scheduleSave();
      } else {
        setSaveState('saved');
      }
      // Notiz existiert jetzt — initialen Anhang nachziehen (still bei Fehler)
      uploadInitialAttachment();
      return;
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      // Sicherheitsereignis, kein Offline-Fall: Eine Weiterleitung hat den
      // konfigurierten Server verlassen oder sich nicht prüfen lassen — der
      // Schreibvorgang wird NICHT endlos für einen lateren Sync wiederholt
      if (e?.status === 0 && (msg.startsWith('redirect-unverifiable') || msg.startsWith('redirect-offsite'))) {
        setSaveState('failed');
        Alert.alert(t('common.error'), t('editor.unsecureServer'));
        return;
      }
      if (e?.status === 0) {
        // Offline: Schreibvorgang dauerhaft einreihen — kein Datenverlust bei App-Kill.
        // Die Queue wird beim nächsten Start/Vordergrund-Wechsel automatisch geleert.
        enqueueWrite({
          key: queueKey,
          kind: noteIdRef.current == null ? 'create' : 'update',
          noteId: noteIdRef.current ?? undefined,
          body,
          if_version: versionRef.current,
          // Typ wie beim Online-Create mitliefern — sonst legt der Queue-Flush
          // Zeichnungen als 'note' statt 'markdown' (oder umgekehrt) an; ebenso
          // den vor dem ersten Speichern gewählten Zielordner (P1-12)
          ...(noteIdRef.current == null ? {
            noteType: isDrawingContent(body.content) ? 'note' : 'markdown',
            ...(folderIdRef.current != null ? { folderId: folderIdRef.current } : {}),
          } : {}),
        }).catch(() => {});
        // Der Stand liegt jetzt dauerhaft in der Queue — der zugehörige Entwurf
        // ist verbraucht (verwaiste new-…-Entwürfe würden sich sonst ansammeln;
        // neuere Eingaben schreiben ihn ohnehin nach 400 ms neu)
        clearDraft(queueKey).catch(() => {});
        setSaveState('queued');
        return;
      }
      if (e?.status === 409 && e?.data?.code === 'version_conflict') {
        setSaveState('conflict');
        handleVersionConflict(e.data.current);
        return;
      }
      setSaveState('failed');
      Alert.alert(t('common.error'), msg.includes('403') ? t('editor.lockFailed') : msg);
      return;
    } finally {
      persistingRef.current = false;
      if (rescheduleRef.current) {
        rescheduleRef.current = false;
        // Erfolg: Änderungen nachziehen. Misserfolg: mindestens den lokalen
        // Entwurf sichern — endloses Offline-Neuversuchen wäre ein Loop.
        saveDraftNow();
      }
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

  /**
   * Konflikt-Entwurf aus der Offline-Synchronisierung (409 beim Nachtragen):
   * lokale Fassung in den Editor laden oder die neuere Server-Fassung behalten.
   * Beide Fassungen bleiben bis zur Entscheidung erhalten.
   */
  const resolveConflictDraft = (useLocal: boolean) => {
    const id = noteIdRef.current;
    const draft = conflictDraft;
    setConflictDraft(null);
    if (id != null) clearDraft(`conflict-${id}`).catch(() => {});
    if (useLocal && draft) {
      setHeading(draft.heading);
      setContent(draft.content);
      setTags(draft.tags);
      // Die Wiederherstellung ist die ausdrückliche Entscheidung für die lokale
      // Fassung — der folgende Autosave überschreibt die neuere Server-Fassung
      // bewusst (kein erneuter 409-Dialog zur bereits getroffenen Wahl, P0-1)
      overwriteNextSaveRef.current = true;
      scheduleSave();
    } else if (!useLocal) {
      // Server-Fassung bleibt im Editor — sie IST der aktuelle Stand
      setSaveState('saved');
    }
  };

  // --- Notizlinks (P2-16): [[Notiztitel]] einfuegen und in der Vorschau oeffnen ---
  const insertNoteLink = (target: Note) => {
    setShowLinkPicker(false);
    const link = `[[${target.heading}]]`;
    const next = latest.current.content ? `${latest.current.content}\n${link}` : link;
    setContent(next);
    scheduleSave();
  };

  const openNoteByTitle = async (title: string) => {
    if (!onOpenNote) return;
    const target = (allNotes ?? []).find((n) => (n.heading ?? '').toLowerCase() === title.toLowerCase());
    if (target) { onOpenNote(target); return; }
    // Notiz wurde (wegen Begrenzung, P1-14) nicht in die lokalen Notizen
    // geladen — auf dem Server nach dem Titel suchen statt still zu scheitern
    try {
      const res = await client.searchNotes(title, { limit: 5 });
      const hit = res.notes.find((n) => (n.heading ?? '').toLowerCase() === title.toLowerCase());
      if (hit) onOpenNote(hit);
    } catch {}
  };

  const openNoteById = (id: number) => {
    if (onOpenNote) onOpenNote({ id, heading: '' });
  };

  // --- Tag-Vorschlaege (P1-10): vorhandene Tags per Tipp uebernehmen ---
  const addTagSuggestion = (tag: string) => {
    const current = latest.current.tags.split(',').map((s) => s.trim()).filter(Boolean);
    if (current.some((s) => s.toLowerCase() === tag.toLowerCase())) return;
    const next = [...current, tag].join(', ');
    setTags(next);
    scheduleSave();
  };

  // Autosave 1.2s nach letzter Eingabe; Entwurf bereits nach 400ms lokal sichern —
  // überlebt App-Abbruch innerhalb der Autosave-Verzögerung oder während des Requests
  const draftKeyFor = (id: number | null) => (id != null ? `note-${id}` : localQueueKey);
  const saveDraftNow = () => {
    saveDraft(draftKeyFor(noteIdRef.current), {
      heading: latest.current.heading,
      content: latest.current.content,
      tags: latest.current.tags,
    }).catch(() => {});
  };
  const scheduleSave = () => {
    // Schreibgeschützte Formate / serverseitig gesperrte Notizen: kein Autosave
    if (writeBlockedRef.current) return;
    setSaveState('dirty');
    ensureLock();
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      saveDraftNow();
      // Sichtbarer Zwischenstand (P0-3): Änderung ist lokal gesichert, die
      // Übertragung zum Server läuft noch („Ungespeichert" wäre gelogen)
      setSaveState((s) => (s === 'dirty' ? 'local' : s));
    }, 400);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Timer-Ref im Callback nullen — sonst hält der Unmount-Cleanup einen
    // bereits gefeuerten Timer für aktiv und speichert doppelt
    saveTimer.current = setTimeout(() => { saveTimer.current = null; persist(); }, 1200);
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
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
      saveDraftNow();
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      // Läuft bereits ein persist, kehrt das sofort zurück (In-Flight-Guard).
      // Der bisherige Code hätte die Änderungen dann einfach fallen gelassen —
      // hier bleibt der letzte Stand mindestens im lokalen Entwurf (P0-2),
      // der Abschluss des Requests holt ihn via rescheduleRef nach.
      saveDraftNow();
      persistRef.current();
    }
  }, []);

  // Entwurf einer NEUEN Notiz wiederherstellen (P0-2): Wurde die App beendet,
  // bevor der erste Server-Autosave durchkam (Absturz, Kill, leerer Akku,
  // kein Netz), liegt die jüngste ungespeicherte Fassung noch unter einem
  // `new-…`-Schlüssel. Der jüngste wird hier angeboten; ältere verwaiste
  // Entwürfe rücken in späteren neuen Notizen nach. Vorbelegte Inhalte
  // (Teilen-Menü) und Zeichnungen haben Vorrang.
  useEffect(() => {
    if (!isNew || prefill || drawing) return;
    let cancelled = false;
    latestNewDraft().then(async (found) => {
      if (cancelled || !found) return;
      const d = found.draft;
      if (!(d.heading || d.content || d.tags)) return;
      // Erst unter dem frischen Sitzungs-Schlüssel NEU sichern, dann Queue-
      // Eintrag und alten Entwurf freigeben — schließt der Nutzer genau
      // dazwischen, liegt der Inhalt mindestens doppelt weiter bereit.
      await saveDraft(localQueueKey, d).catch(() => {});
      await removeWrite(found.key).catch(() => {});
      await clearDraft(found.key).catch(() => {});
      if (cancelled) return;
      setHeading(d.heading);
      setContent(d.content);
      setTags(d.tags);
      setDraftRestored(true);
      scheduleSave();
    });
    return () => { cancelled = true; };
    // Neue Notizen haben keine ID; Restore läuft bewusst nur einmal pro Öffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            if (e?.status === 0) {
              // Offline: Löschung einreihen und lokal ausblenden — der Server
              // übernimmt sie bei der nächsten Verbindung
              enqueueWrite({
                key: `delete-${noteId}`,
                kind: 'delete',
                noteId,
                body: { heading: '', content: '', tags: '' },
              }).catch(() => {});
              onDeleted(noteId);
              Alert.alert('🪶', t('editor.deleteQueued'));
              return;
            }
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
  // Nicht unterstützte Formate (html, tasklist, …) schreibgeschützt öffnen —
  // Bearbeiten im Text-Editor würde die Struktur beschädigen
  const formatReadOnly = !isNew && !isExcalidraw && noteType != null && !EDITABLE_TYPES.has(noteType);
  // Schreibschutz auch in Timern verfügbar (persist/scheduleSave feuern mit
  // älteren Closures) — daher als Ref gespiegelt. Verhindert, dass an einer
  // schreibgeschützten oder serverseitig gesperrten Notiz überhaupt gesendet
  // wird — der PATCH wäre verlorene Arbeit bzw. ein 403 (P0-6).
  const writeBlockedRef = useRef(false);
  writeBlockedRef.current = formatReadOnly || serverLocked;

  // Volle Notiz nachladen (Inhalt fehlt in der Listen-Antwort)
  useEffect(() => {
    if (note?.id == null) return;
    let cancelled = false;
    client.getNote(note.id)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.note) { setLoadFailed(true); return; }
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
        // Entwurf aus der letzten Sitzung wiederherstellen: Änderungen, die nie
        // synchronisiert wurden (App-Abbruch vor Autosave oder während des Requests).
        // Erfolgreich synchronisierte Entwürfe wurden beim Speichern gelöscht.
        // Bei schreibgeschützten Formaten keinen Entwurf einspielen — der
        // Autosave würde sonst Fremdformate beschädigen.
        const editableFormat = n.type == null
          // Ältere Server ohne type-Feld: HTML-artige Inhalte (erkennbar am
          // führenden Tag) keinen Entwurf einspielen lassen — der Autosave
          // würde sonst Fremdformaten schaden (P0-6)
          ? isDrawingContent(c) || !/^\s*</.test(c.trim())
          : (EDITABLE_TYPES.has(n.type) || isDrawingContent(c));
        const draft = await readDraft(`note-${note.id}`);
        if (!cancelled && draft && editableFormat &&
            (draft.heading !== (n.heading ?? '') || draft.content !== (n.content ?? '') || draft.tags !== (n.tags ?? ''))) {
          setHeading(draft.heading);
          setContent(draft.content);
          setTags(draft.tags);
          setDraftRestored(true);
          scheduleSave();
        }
        // Konflikt-Entwurf: Offline-Fassung kollidierte beim Synchronisieren
        // mit einer neueren Server-Fassung — beide bleiben erhalten.
        const conflict = await readDraft(`conflict-${note.id}`);
        if (!cancelled && conflict) setConflictDraft(conflict);
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
        if (!cancelled) setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [note?.id, reloadKey, client]);

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
      .then(async (r) => {
        setAttachments(r.attachments ?? []);
        // Welche Anhänge haben eine lokale Offline-Kopie?
        const local: string[] = [];
        for (const a of r.attachments ?? []) {
          if (await getOfflineAttachment(a.id).catch(() => null)) local.push(a.id);
        }
        setOfflineAtts(new Set(local));
      })
      .catch(() => {});
    // Wartende Uploads aus der letzten Sitzung (offline fehlgeschlagen): als
    // Banner anbieten — sofortiges manuelles Wiederholen möglich; ohne Retry
    // zieht die Wiederverbindung die Queue nach (P1-8)
    uploadsFor(note.id)
      .then((list) => {
        if (list.length === 0) return;
        const last = list[list.length - 1];
        setFailedUpload({ uri: last.localPath, name: last.name, mimeType: last.mimeType });
      })
      .catch(() => {});
    // Vorhandene Tags einmalig laden — Vorschläge unter dem Tag-Feld
    client.listTags()
      .then((r) => setTagSuggestions((r.tags ?? []).map((x) => x.tag).slice(0, 30)))
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
      // Offline-Kopie zuerst — funktioniert ohne Verbindung. Die liegt
      // verschlüsselt auf der Platte (P0-5) und wird erst hier entschlüsselt
      // und in eine temporäre Cache-Datei entpackt.
      const fileName = att.original_filename || att.filename || 'anhang';
      let path: string | null = null;
      const localBytes = await readOfflineAttachmentBytes(att.id).catch(() => null);
      if (localBytes) {
        path = `${FileSystem.cacheDirectory}${fileName.replace(/[/\\]/g, '_')}`;
        await FileSystem.writeAsStringAsync(path, base64FromBytes(localBytes), { encoding: FileSystem.EncodingType.Base64 });
      }
      if (!path) {
        const bytes = await client.getAttachmentBytes(noteId, att.id);
        path = `${FileSystem.cacheDirectory}${fileName.replace(/[/\\]/g, '_')}`;
        await FileSystem.writeAsStringAsync(path, base64FromBytes(bytes), { encoding: FileSystem.EncodingType.Base64 });
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: att.file_type || 'application/octet-stream', dialogTitle: fileName });
      }
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const tryUnlock = async () => {
    // noteId mitgeben, damit das Rate-Limit je Notiz greift
    if (await verifyPin(pinInput, noteId ?? undefined)) {
      setLocked(false); setPinPrompt(false); setPinInput('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setPinInput('');
      // Aktives Rate-Limit kurz sichtbar melden (nur wenn noch Sekunden übrig sind)
      const delay = await pinRetryDelay(noteId ?? undefined).catch(() => 0);
      if (delay > 0) Alert.alert(t('common.error'), t('lock.tooManyAttempts', { n: delay }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const toggleNoteLock = async () => {
    if (noteId == null) return;
    try {
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
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const submitPinPrompt = async (pin: string) => {
    if (noteId == null) { setPromptKind(null); return; }
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      // Modal offen lassen und Feedback geben statt still zu schließen
      Alert.alert(t('common.error'), `${t('lock.enterPass')}: ${t('lock.pinHint')}`);
      return;
    }
    setPromptKind(null);
    try {
      await setPin(pin);
      await lockNote(noteId);
      Alert.alert('🔒', t('lock.noteLock'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
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
      // Berechtigungen vor der Freigabe erklären (P2-17): Der Nutzer soll
      // erkennen, was "öffentlich" bedeutet, bevor der Link entsteht.
      Alert.alert(t('editor.shareExplainTitle'), t('editor.shareExplainText'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('editor.shareCreate'),
          onPress: async () => {
            try {
              const res = await client.shareNote(noteId);
              const url = res.url ?? res.share_url ?? (res.token ? `${client.cfg.baseUrl}/${res.token}` : null);
              if (!url) throw new Error('no url');
              setShared(true); setSharedUrl(url);
              Share.share({ title: latest.current.heading || 'Pozume', message: url }).catch(() => {});
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message ?? String(e));
            }
          },
        },
      ]);
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

  // --- Anhang hinzufügen: Datei wählen oder Kamera (P1-8) ---
  const uploadPicked = async (file: { uri: string; name: string; mimeType?: string }) => {
    if (noteId == null || uploading) return;
    setUploading(true);
    setFailedUpload(null);
    try {
      // Duplikatschutz + Nachholen wartender Uploads derselben Datei —
      // die dauerhafte Upload-Queue wird von uploadWithDupCheck mitgeleert
      const uploaded = await uploadWithDupCheck(noteId, file);
      if (uploaded) {
        const atts = await client.listAttachments(noteId);
        setAttachments(atts.attachments ?? []);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('🪶', t('editor.uploaded'));
      }
    } catch (e: any) {
      if (e?.status === 0) {
        // Offline: Upload dauerhaft einreihen — die Datei wird aus dem
        // Cache-Verzeichnis (iOS räumt es auf) in ein dauerhaftes Verzeichnis
        // kopiert. Der Banner bietet sofortiges Wiederholen; ohne Retry zieht
        // die Wiederverbindung die Queue nach (P1-8).
        const queued = await enqueueUpload(noteId, file);
        if (queued) {
          setFailedUpload({ uri: queued.localPath, name: file.name, mimeType: file.mimeType });
          Alert.alert('📴 ' + t('editor.uploadFailed'), t('editor.uploadQueued'));
        } else {
          setFailedUpload(file);
          Alert.alert(t('editor.uploadFailed'), e?.message ?? String(e));
        }
      } else {
        // Fehlgeschlagener Upload merken — die Datei liegt noch lokal und kann
        // mit einem Tipp wiederholt werden (kein erneutes Suchen nötig)
        setFailedUpload(file);
        Alert.alert(t('editor.uploadFailed'), e?.message ?? String(e));
      }
    } finally {
      setUploading(false);
    }
  };

  const pickAttachment = () => {
    if (noteId == null || uploading) return;
    Alert.alert(t('editor.addAttachment'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: '📷 ' + t('editor.takePhoto'),
        onPress: async () => {
          try {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert(t('common.error'), t('reminder.localDenied'));
              return;
            }
            const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
            if (res.canceled || !res.assets?.length) return;
            const asset = res.assets[0];
            await uploadPicked({ uri: asset.uri, name: asset.fileName ?? 'foto.jpg', mimeType: asset.mimeType ?? 'image/jpeg' });
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
      {
        text: '📄 ' + t('editor.attachFile'),
        onPress: async () => {
          try {
            const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
            if (res.canceled || !res.assets?.length) return;
            const asset = res.assets[0];
            await uploadPicked({ uri: asset.uri, name: asset.name ?? 'anhang', mimeType: asset.mimeType ?? undefined });
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  // --- Offline-Verfügbarkeit eines Anhangs (P1-8) ---
  const toggleAttachmentOffline = async (att: Attachment) => {
    if (noteId == null) return;
    try {
      if (offlineAtts.has(att.id)) {
        await removeOfflineAttachment(att.id);
        setOfflineAtts((prev) => { const n = new Set(prev); n.delete(att.id); return n; });
        Alert.alert('🪶', t('editor.attachOfflineRemove'));
      } else {
        await downloadAttachmentOffline(client, noteId, att);
        setOfflineAtts((prev) => new Set(prev).add(att.id));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('🪶', t('editor.attachOfflineDone'));
      }
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const confirmDeleteAttachment = (att: Attachment) => {
    if (noteId == null) return;
    Alert.alert(att.original_filename || att.filename, '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: offlineAtts.has(att.id) ? t('editor.attachOfflineRemove') : t('editor.attachOffline'), onPress: () => toggleAttachmentOffline(att) },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await client.deleteAttachment(noteId, att.id);
            await removeOfflineAttachment(att.id).catch(() => {});
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

  const moveToFolder = async (targetId: number | null, folderName?: string) => {
    setShowPicker(false);
    if (noteId == null) {
      // Neue Notiz (z.B. Share-Inhalt): Zielordner VOR dem ersten Speichern
      // wählen (P1-12) — er wird beim ersten persist mit createNote übernommen
      // bzw. in die Offline-Queue gelegt, ein Server-Kontakt ist vorher unnötig.
      setFolderId(targetId);
      setPickedFolderName(targetId == null ? null : (folderName ?? null));
      return;
    }
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
    saveState === 'local' ? t('editor.savedLocal') :
    saveState === 'queued' ? t('editor.queued') :
    saveState === 'failed' ? t('editor.failed') :
    saveState === 'conflict' ? t('editor.conflictState') :
    saveState === 'dirty' ? t('editor.unsaved') : '';

  if (!loaded) {
    if (loadFailed) {
      return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.pinTopBar}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.back}>←</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
            <Text style={{ fontSize: 44, marginBottom: spacing.md }}>📴</Text>
            <Text style={[type.h2, { marginBottom: spacing.sm, textAlign: 'center' }]}>{t('editor.loadFailedTitle')}</Text>
            <Text style={[type.muted, { textAlign: 'center', marginBottom: spacing.lg }]}>
              {t('editor.loadFailedText')}
            </Text>
            <TouchableOpacity
              style={primaryButton}
              onPress={() => { setLoadFailed(false); setLoaded(false); setReloadKey((k) => k + 1); }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
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
        <TouchableOpacity onPress={() => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; persist(); } setPreview((v) => !v); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
          {!isExcalidraw && !formatReadOnly ? (
            <TouchableOpacity style={styles.actionChip} onPress={() => setShowLinkPicker(true)}>
              <Text style={styles.actionChipIcon}>🔗</Text>
              <Text style={styles.actionChipText}>{t('editor.insertLink')}</Text>
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
          <TouchableOpacity style={styles.actionChip} onPress={() => setShowPicker(true)}>
            <Text style={styles.actionChipIcon}>📁</Text>
            <Text style={styles.actionChipText} numberOfLines={1}>{pickedFolderName ?? t('editor.moveFolder')}</Text>
          </TouchableOpacity>
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
      {failedUpload && (
        <View style={[styles.missingBanner, { backgroundColor: colors.dangerSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <Text style={{ color: colors.danger, fontSize: 13, flexShrink: 1 }}>
            ⚠️ {t('editor.uploadFailed')}: {failedUpload.name}
          </Text>
          <TouchableOpacity
            onPress={() => uploadPicked(failedUpload)}
            style={{ backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5, marginLeft: spacing.sm }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {isNew && prefill && (
        <View style={[styles.missingBanner, { backgroundColor: colors.primarySoft }]}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>
            🪶 {t('share.pendingTitle')} — {t('share.pendingHint')}
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
      {draftRestored && (
        <View style={[styles.missingBanner, { backgroundColor: colors.primarySoft }]}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>
            🕘 {t('editor.draftRestored')}
          </Text>
        </View>
      )}
      {conflictDraft && (
        <View style={[styles.missingBanner, { backgroundColor: colors.dangerSoft }]}>
          <Text style={{ color: colors.danger, fontSize: 13 }}>
            ⚠️ {t('editor.conflictPending')}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: 6 }}>
            <TouchableOpacity onPress={() => resolveConflictDraft(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>{t('editor.conflictUseLocal')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => resolveConflictDraft(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.textMuted, fontWeight: '700', fontSize: 12 }}>{t('editor.conflictKeepServer')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {formatReadOnly && (
        <View style={[styles.missingBanner, { backgroundColor: colors.primarySoft }]}>
          <Text style={{ color: colors.primary, fontSize: 13 }}>
            👁 {t('editor.readonlyFormat')}
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
          editable={!serverLocked && !formatReadOnly}
        />
        {isExcalidraw && drawingContent ? (
          <DrawingEditor
            content={drawingContent}
            saveAsExcalidrawHtml={svgFallback != null && !isDrawingContent(content)}
            onChange={(next) => { setContent(next); scheduleSave(); }}
          />
        ) : preview ? (
          <View style={styles.previewWrap}>
            <MarkdownView
              content={content}
              onOpenNoteId={openNoteById}
              onOpenNoteTitle={openNoteByTitle}
            />
          </View>
        ) : (
          <TextInput
            style={styles.contentInput}
            placeholder={t('editor.contentPlaceholder')}
            placeholderTextColor={colors.textFaint}
            value={content}
            onChangeText={(v) => { setContent(v); setFindSelection(undefined); scheduleSave(); }}
            selection={findSelection}
            editable={!serverLocked && !formatReadOnly}
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
          editable={!serverLocked && !formatReadOnly}
          autoCapitalize="none"
        />
        {tagSuggestions.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagSuggestRow}>
            {tagSuggestions
              .filter((sug) => !tags.split(',').map((s) => s.trim().toLowerCase()).includes(sug.toLowerCase()))
              .slice(0, 12)
              .map((sug) => (
                <TouchableOpacity key={sug} style={styles.tagSuggestChip} onPress={() => addTagSuggestion(sug)}>
                  <Text style={styles.tagSuggestText}>#{sug}</Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        )}
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
                  <Text style={styles.attachName} numberOfLines={1}>{offlineAtts.has(att.id) ? '💾 ' : '📎 '}{att.original_filename || att.filename}</Text>
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
        message={t('lock.pinHint')}
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
      <Modal visible={showLinkPicker} transparent animationType="slide" onRequestClose={() => setShowLinkPicker(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={() => setShowLinkPicker(false)} />
          <View style={[styles.sheet, shadow]}>
            <Text style={styles.sheetTitle}>🔗 {t('editor.linkPickerTitle')}</Text>
            {allNotes && allNotes.length > 0 ? (
              <FlatList
                data={allNotes.filter((n) => n.id !== noteId).slice(0, 100)}
                keyExtractor={(x) => String(x.id)}
                style={styles.tplList}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.tplRow} onPress={() => insertNoteLink(item)}>
                    <Text style={styles.tplIcon}>📄</Text>
                    <View style={styles.tplTextWrap}>
                      <Text style={styles.tplName} numberOfLines={1}>{item.heading}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={styles.tplEmpty}>{t('editor.linkEmpty')}</Text>
            )}
            <TouchableOpacity style={styles.tplClose} onPress={() => setShowLinkPicker(false)}>
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
  tagSuggestRow: { flexDirection: 'row', flexGrow: 0, marginTop: spacing.sm },
  tagSuggestChip: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4,
    marginRight: spacing.sm,
  },
  tagSuggestText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
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

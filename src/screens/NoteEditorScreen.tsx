import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { setReminder, removeReminder, getReminder } from '../api/reminders';
import { lockNote, unlockNoteRecord, isNoteLocked, verifyPin, hasPin, setPin } from '../api/noteLock';
import FolderPickerSheet from '../components/FolderPickerSheet';
import MarkdownView from '../components/MarkdownView';
import DrawingEditor, { isDrawingContent, emptyDrawingHtml } from '../components/DrawingEditor';
import { usePalette, spacing, radius, typeFor, primaryButton,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient, Note } from '../api';

interface Props {
  client: PoznoteClient;
  note: Note | null;          // null = neue Notiz
  drawing?: boolean;          // true = neue Notiz startet als Zeichnung
  onClose: () => void;
  onSaved: (note: Note) => void;
  onDeleted: (id: number) => void;
}

interface Attachment { id: string; filename: string; original_filename?: string; file_size?: number; file_type?: string }

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function NoteEditorScreen({ client, note, drawing, onClose, onSaved, onDeleted }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const isNew = note == null;
  const [heading, setHeading] = useState(note?.heading ?? '');
  const [content, setContent] = useState(isNew && drawing ? emptyDrawingHtml() : (note?.content ?? ''));
  const [tags, setTags] = useState(note?.tags ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'dirty'>('idle');
  const [noteId, setNoteId] = useState<number | null>(note?.id ?? null);
  // Die Notizliste liefert keinen Inhalt — die volle Notiz muss nachgeladen werden,
  // bevor der Editor interaktiv wird (sonst überschreibt Autosave leeren Inhalt).
  const [loaded, setLoaded] = useState(isNew);
  const noteIdRef = useRef<number | null>(note?.id ?? null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ heading, content, tags });
  latest.current = { heading, content, tags };

  const persist = async () => {
    setSaveState('saving');
    const body = { heading: latest.current.heading, content: latest.current.content, tags: latest.current.tags };
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
        onSaved(res.note);
      } else {
        await client.updateNote(noteIdRef.current, body);
        onSaved({ ...(note as Note), ...body, updated_at: new Date().toISOString() });
      }
      setSaveState('saved');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setSaveState('dirty');
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  // Autosave 1.2s nach letzter Eingabe
  const scheduleSave = () => {
    setSaveState('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 1200);
  };

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
  // Ältere Excalidraw-Notizen tragen die Zeichnung nur als SVG-Anhang (Inhalt leer oder nur <img>)
  const [svgFallback, setSvgFallback] = useState<string | null>(null);
  const [drawMissing, setDrawMissing] = useState(false);
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
        setFolderId(n.folder_id ?? null);
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
              const r = await fetch(`${client.cfg.baseUrl}/api/v1/notes/${note.id}/attachments/${svgAtt.id}`, {
                headers: {
                  Authorization: 'Basic ' + btoa(`${client.cfg.username}:${client.cfg.password}`),
                  'X-User-ID': client.cfg.userId ?? '1',
                },
              });
              if (r.ok) {
                const svg = await r.text();
                if (!cancelled && svg.trimStart().startsWith('<svg')) setSvgFallback(svg);
              }
            }
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [note?.id]);

  const isFavorite = !!(note?.favorite);

  // Gespuerrte Notiz: PIN verlangen (einmal pro Oeffnen)
  useEffect(() => {
    if (note?.id == null) return;
    isNoteLocked(note.id).then((v) => {
      if (v) { setLocked(true); setPinPrompt(true); }
    });
    client.getShare(note.id)
      .then((r) => { setShared(!!r.shared); setSharedUrl(r.url ?? null); })
      .catch(() => {});
    client.listAttachments(note.id)
      .then((r) => setAttachments(r.attachments ?? []))
      .catch(() => {});
  }, [note?.id]);

  const openAttachment = async (att: Attachment) => {
    if (noteId == null) return;
    try {
      const res = await fetch(`${client.cfg.baseUrl}/api/v1/notes/${noteId}/attachments/${att.id}`, {
        headers: {
          Authorization: 'Basic ' + btoa(`${client.cfg.username}:${client.cfg.password}`),
          'X-User-ID': client.cfg.userId ?? '1',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
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
        Alert.prompt(t('lock.enterPass'), '4–8 Ziffern', [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.save'), onPress: async (pin?: string) => {
              if (pin && /^\d{4,8}$/.test(pin)) { await setPin(pin); await lockNote(noteId); Alert.alert('🔒', t('lock.noteLock')); }
            } },
        ], 'secure-text');
      } else {
        await lockNote(noteId);
        Alert.alert('🔒', t('lock.noteLock'));
      }
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
      Alert.alert('🪶', t('editor.duplicated'));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
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

  const promptReminder = () => {
    if (noteId == null) return;
    Alert.prompt(
      t('reminder.set'),
      t('reminder.at') + ' (HH:MM)',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.save'),
          onPress: async (time?: string) => {
            const m = time?.match(/^(\d{1,2}):(\d{2})$/);
            if (!m) return;
            const d = new Date();
            d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
            if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
            try {
              await setReminder(noteId, latest.current.heading || 'Notiz', d.toISOString());
              Alert.alert('🪶', t('reminder.saved'));
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message === 'no-permission' ? 'Benachrichtigungen erlauben!' : String(e?.message ?? e));
            }
          },
        },
      ],
      'plain-text',
      new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    );
  };

  const shareNote = async () => {
    try {
      await Share.share({
        title: latest.current.heading || 'Pozume',
        message: `# ${latest.current.heading}\n\n${latest.current.content ?? ''}`,
      });
    } catch {}
  };
  const [folderId, setFolderId] = useState<number | null>(note?.folder_id ?? null);

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
      await client.updateNote(noteId, { favorite: !isFavorite });
      onSaved({ ...(note as Note), favorite: !isFavorite });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const statusLabel =
    saveState === 'saving' ? t('editor.saving') :
    saveState === 'saved' ? t('editor.saved') :
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
            <TouchableOpacity onPress={shareNote} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.folderIcon}>↗</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={promptReminder} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.folderIcon}>⏰</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleNoteLock} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.folderIcon}>🔒</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleFavorite}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.starBtn, isFavorite && styles.starActive]}>{isFavorite ? '★' : '☆'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={confirmDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.delete}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {!isNew && (
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
        </ScrollView>
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
            onChangeText={(v) => { setContent(v); scheduleSave(); }}
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
                <TouchableOpacity key={att.id} style={styles.attachChip} onPress={() => openAttachment(att)} activeOpacity={0.7}>
                  <Text style={styles.attachName} numberOfLines={1}>{att.original_filename || att.filename}</Text>
                  {att.file_size != null ? (
                    <Text style={styles.attachSize}>{att.file_size >= 1048576 ? `${(att.file_size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(att.file_size / 1024))} KB`}</Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
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
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  missingBanner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
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
  actionChipIcon: { fontSize: 14 },
  actionChipText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  starBtn: { fontSize: 22, color: colors.textFaint },
  folderIcon: { fontSize: 20 },
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
  excPlaceholder: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: spacing.xl },
  attachSection: { marginTop: spacing.lg },
  attachTitle: { ...type.h2, fontSize: 14, marginBottom: spacing.sm },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  attachChip: {
    backgroundColor: colors.primarySoft, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: '100%',
  },
  attachName: { fontSize: 13, fontWeight: '600', color: colors.primary },
  attachSize: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
});

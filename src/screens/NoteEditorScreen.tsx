import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import { setReminder, removeReminder, getReminder } from '../api/reminders';
import { lockNote, unlockNoteRecord, isNoteLocked, verifyPin, hasPin, setPin } from '../api/noteLock';
import FolderPickerSheet from '../components/FolderPickerSheet';
import MarkdownView from '../components/MarkdownView';
import { usePalette, spacing, radius, type, primaryButton,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient, Note } from '../api';

interface Props {
  client: PoznoteClient;
  note: Note | null;          // null = neue Notiz
  onClose: () => void;
  onSaved: (note: Note) => void;
  onDeleted: (id: number) => void;
}

export default function NoteEditorScreen({ client, note, onClose, onSaved, onDeleted }: Props) {
  const colors = usePalette();
  const styles = getStyles(colors);
  const isNew = note == null;
  const [heading, setHeading] = useState(note?.heading ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [tags, setTags] = useState(note?.tags ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'dirty'>('idle');
  const [noteId, setNoteId] = useState<number | null>(note?.id ?? null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ heading, content, tags });
  latest.current = { heading, content, tags };

  const persist = async () => {
    setSaveState('saving');
    const body = { heading: latest.current.heading, content: latest.current.content, tags: latest.current.tags };
    try {
      if (noteId == null) {
        const res = await client.createNote({
          heading: body.heading || 'Ohne Titel',
          content: body.content,
          type: 'markdown',
          tags: body.tags,
          workspace: 'Arbeit',
        });
        setNoteId(res.note.id);
        onSaved(res.note);
      } else {
        await client.updateNote(noteId, body);
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

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

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

  const isFavorite = !!(note?.favorite);

  // Gespuerrte Notiz: PIN verlangen (einmal pro Oeffnen)
  useEffect(() => {
    if (note?.id == null) return;
    isNoteLocked(note.id).then((v) => {
      if (v) { setLocked(true); setPinPrompt(true); }
    });
  }, [note?.id]);

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

  if (locked && pinPrompt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
            <TouchableOpacity onPress={() => setShowPicker(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.folderIcon}>📁</Text>
            </TouchableOpacity>
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          placeholder={t('editor.titlePlaceholder')}
          placeholderTextColor={colors.textFaint}
          value={heading}
          onChangeText={(v) => { setHeading(v); scheduleSave(); }}
        />
        {preview ? (
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
        <Text style={styles.meta}>
          {content.trim()
            ? `${t('editor.wordCount', { n: content.trim().split(/\s+/).length })} · ${t('editor.readingTime', { n: Math.max(1, Math.ceil(content.trim().split(/\s+/).length / 200)) })}`
            : ''}
        </Text>
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

const getStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { fontSize: 26, color: colors.text, width: 40 },
  status: { ...type.muted, flex: 1, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, width: 130, justifyContent: 'flex-end' },
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
});

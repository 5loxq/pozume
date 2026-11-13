import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import FolderPickerSheet from '../components/FolderPickerSheet';
import MarkdownView from '../components/MarkdownView';
import { colors, spacing, radius, type } from '../theme';
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

  const isFavorite = !!(note?.favorite);
  const [showPicker, setShowPicker] = useState(false);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setPreview((v) => !v)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { fontSize: 26, color: colors.text, width: 40 },
  status: { ...type.muted, flex: 1, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, width: 110, justifyContent: 'flex-end' },
  starBtn: { fontSize: 22, color: colors.textFaint },
  folderIcon: { fontSize: 20 },
  starActive: { color: colors.star },
  delete: { fontSize: 20 },
  content: { padding: spacing.lg, paddingBottom: 60 },
  previewBtn: { color: colors.primary, fontWeight: '700', fontSize: 14, width: 80 },
  previewWrap: { minHeight: 300 },
  titleInput: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4, color: colors.text, marginBottom: spacing.md },
  contentInput: { fontSize: 16, lineHeight: 26, color: colors.text, minHeight: 300, letterSpacing: 0.1 },
  tagsInput: {
    marginTop: spacing.lg, fontSize: 14, fontWeight: '600', color: colors.primary,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
});

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
            await client.deleteNote(noteId);
            onDeleted(noteId);
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const isFavorite = !!(note?.favorite);
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
        <Text style={styles.status} numberOfLines={1}>{statusLabel}</Text>
        {!isNew && (
          <View style={styles.actions}>
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
        <TextInput
          style={styles.contentInput}
          placeholder={t('editor.contentPlaceholder')}
          placeholderTextColor={colors.textFaint}
          value={content}
          onChangeText={(v) => { setContent(v); scheduleSave(); }}
          multiline
          textAlignVertical="top"
        />
        <TextInput
          style={styles.tagsInput}
          placeholder={t('tags.addTag')}
          placeholderTextColor={colors.textFaint}
          value={tags}
          onChangeText={(v) => { setTags(v); scheduleSave(); }}
          autoCapitalize="none"
        />
      </ScrollView>
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18, width: 90, justifyContent: 'flex-end' },
  starBtn: { fontSize: 22, color: colors.textFaint },
  starActive: { color: colors.star },
  delete: { fontSize: 20 },
  content: { padding: spacing.lg, paddingBottom: 60 },
  titleInput: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  contentInput: { fontSize: 16, lineHeight: 25, color: colors.text, minHeight: 300 },
  tagsInput: {
    marginTop: spacing.lg, fontSize: 14, color: colors.primary,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
});

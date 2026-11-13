import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette, spacing, radius, type, shadow} from '../theme';
import { t, getLocale } from '../i18n';
import type { PoznoteClient, Note } from '../api';
import { formatRelativeDate, excerpt } from '../utils';

interface Props {
  client: PoznoteClient;
  onBack: () => void;
}

export default function TrashScreen({ client, onBack }: Props) {
  const colors = usePalette();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const locale = getLocale();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.listTrash();
      setNotes(res.notes ?? []);
    } catch (e) {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const restore = async (note: Note) => {
    try {
      await client.restoreNote(note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const deleteForever = (note: Note) => {
    Alert.alert(t('trash.deleteForeverTitle'), t('trash.deleteForeverText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('trash.deleteForever'), style: 'destructive',
        onPress: async () => {
          try {
            await client.deleteFromTrashForever(note.id);
            setNotes((prev) => prev.filter((n) => n.id !== note.id));
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: Note }) => (
    <View style={[styles.row, shadow]}>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>{item.heading || '…'}</Text>
        {excerpt(item.content) ? <Text style={styles.excerpt} numberOfLines={1}>{excerpt(item.content, 80)}</Text> : null}
        <Text style={styles.date}>{formatRelativeDate(item.updated_at, locale)}</Text>
      </View>
      <TouchableOpacity style={[styles.action, styles.restoreBtn]} onPress={() => restore(item)}>
        <Text style={styles.restoreText}>{t('trash.restore')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.action} onPress={() => deleteForever(item)} hitSlop={{ left: 8, right: 8 }}>
        <Text style={styles.foreverText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('trash.title')}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(n) => String(n.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>🗑</Text>
              <Text style={styles.emptyText}>{t('trash.empty')}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.lg,
  },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  list: { padding: spacing.lg, paddingTop: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm,
  },
  rowText: { flex: 1, marginRight: spacing.sm },
  title: { ...type.h2, fontSize: 15 },
  excerpt: { ...type.muted, marginTop: 2 },
  date: { fontSize: 11, color: colors.textFaint, marginTop: 4 },
  action: { paddingHorizontal: spacing.sm },
  restoreBtn: {
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  restoreText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  foreverText: { color: colors.danger, fontSize: 18 },
  center: { alignItems: 'center', paddingVertical: 80 },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted },
});

import React, {useCallback, useEffect, useState, useMemo} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { usePalette, spacing, radius, typeFor, shadow, tagColors,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient } from '../api';
import { useColorScheme } from 'react-native';
import PromptModal from '../components/PromptModal';

interface Props {
  client: PoznoteClient;
  onOpenTag: (tag: string) => void;
  onBack: () => void;
}

export default function TagsScreen({ client, onOpenTag, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const isDark = useColorScheme() === 'dark';
  const [tags, setTags] = useState<Array<{ tag: string; count?: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [renameTag, setRenameTag] = useState<string | null>(null);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const res = await client.listTags();
      setTags(res.tags ?? []);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const doRename = async (newName: string) => {
    const old = renameTag;
    setRenameTag(null);
    if (!old || !newName.trim() || newName.trim() === old) return;
    try {
      await client.renameTag(old, newName.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      load({ silent: true });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const confirmDelete = (tag: string) => {
    Alert.alert(t('tags.deleteTitle'), t('tags.deleteText', { tag }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await client.deleteTag(tag);
            setTags((prev) => prev.filter((x) => x.tag !== tag));
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: { tag: string; count?: number } }) => {
    const c = tagColors(item.tag, isDark);
    return (
      <View style={[styles.row, shadow]}>
        <TouchableOpacity style={styles.rowMain} activeOpacity={0.7} onPress={() => onOpenTag(item.tag)}>
          <View style={[styles.tagChip, { backgroundColor: c.bg }]}>
            <Text style={[styles.tagText, { color: c.fg }]}>#{item.tag}</Text>
          </View>
          {item.count != null ? (
            <Text style={styles.count}>
              {item.count === 1 ? t('tags.countNote') : t('tags.countNotes', { n: item.count })}
            </Text>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => setRenameTag(item.tag)} hitSlop={{ left: 8, right: 8 }}>
          <Text style={styles.icon}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => confirmDelete(item.tag)} hitSlop={{ left: 8, right: 8 }}>
          <Text style={styles.icon}>🗑</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🏷 {t('tags.title')}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={tags}
          keyExtractor={(x) => x.tag}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>🏷</Text>
              <Text style={styles.emptyText}>{t('tags.empty')}</Text>
            </View>
          }
        />
      )}
      <PromptModal
        visible={renameTag != null}
        title={t('tags.renameTitle')}
        message={`#${renameTag ?? ''}`}
        placeholder={t('tags.renamePrompt')}
        defaultValue={renameTag ?? ''}
        onCancel={() => setRenameTag(null)}
        onSubmit={doRename}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  list: { padding: spacing.lg, paddingTop: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tagChip: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  tagText: { fontSize: 14, fontWeight: '700' },
  count: { ...type.muted },
  iconBtn: { paddingHorizontal: spacing.sm },
  icon: { fontSize: 16 },
  center: { alignItems: 'center', paddingVertical: 80 },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted },
});

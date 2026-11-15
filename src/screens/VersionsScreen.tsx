import React, {useCallback, useEffect, useState, useMemo} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { usePalette, spacing, radius, typeFor, shadow,
  Palette,
} from '../theme';
import { t, getLocale } from '../i18n';
import type { PoznoteClient, SnapshotInfo } from '../api';
import { formatRelativeDate, excerpt } from '../utils';

interface Props {
  client: PoznoteClient;
  noteId: number;
  onBack: () => void;
}

export default function VersionsScreen({ client, noteId, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const locale = getLocale();
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [currentHash, setCurrentHash] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<{ key: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const res = await client.listSnapshots(noteId);
      setSnapshots(res.snapshots ?? []);
      setCurrentHash(res.current_hash);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client, noteId]);

  useEffect(() => { load(); }, [load]);

  const createManual = async () => {
    try {
      await client.createSnapshot(noteId, true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('🪶', t('versions.created'));
      load({ silent: true });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const openPreview = async (snap: SnapshotInfo) => {
    setPreviewLoading(true);
    try {
      const res = await client.getSnapshot(noteId, snap.snapshot_key);
      setPreview({ key: snap.snapshot_key, content: res.snapshot?.content ?? '' });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const confirmRestore = (snap: SnapshotInfo) => {
    Alert.alert(t('versions.restoreTitle'), t('versions.restoreText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('versions.restore'), style: 'destructive',
        onPress: async () => {
          try {
            await client.restoreSnapshot(noteId, snap.snapshot_key, true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('🪶', t('versions.restored'), [{ text: t('common.done'), onPress: onBack }]);
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const originLabel = (snap: SnapshotInfo): string => {
    if (snap.origin === 'ai') return t('versions.originAi');
    if (snap.origin === 'mcp') return t('versions.originMcp');
    return snap.manual ? t('versions.manual') : t('versions.auto');
  };

  const renderItem = ({ item }: { item: SnapshotInfo }) => {
    const isCurrent = item.content_hash != null && item.content_hash === currentHash;
    return (
      <View style={[styles.row, shadow]}>
        <TouchableOpacity style={styles.rowMain} activeOpacity={0.7} onPress={() => openPreview(item)}>
          <Text style={styles.heading} numberOfLines={1}>{item.heading || '…'}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatRelativeDate(item.created_at, locale)} · {originLabel(item)}
            {item.tags ? ` · ${item.tags}` : ''}
            {isCurrent ? ` · ${t('versions.current')}` : ''}
          </Text>
          {previewLoading && preview?.key === item.snapshot_key ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity style={styles.restoreBtn} onPress={() => confirmRestore(item)} hitSlop={{ left: 8, right: 8 }}>
          <Text style={styles.restoreText}>↩</Text>
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
        <Text style={styles.title}>🕘 {t('versions.title')}</Text>
        <TouchableOpacity onPress={createManual} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.addIcon}>＋</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={snapshots}
          keyExtractor={(x) => x.snapshot_key}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>🕘</Text>
              <Text style={styles.emptyText}>{t('versions.empty')}</Text>
            </View>
          }
        />
      )}
      {preview ? (
        <TouchableOpacity style={styles.previewBackdrop} activeOpacity={1} onPress={() => setPreview(null)}>
          <View style={[styles.previewSheet, shadow]}>
            <Text style={styles.previewTitle} numberOfLines={1}>
              {snapshots.find((s) => s.snapshot_key === preview.key)?.heading ?? ''}
            </Text>
            <Text style={styles.previewContent}>{preview.content ? excerpt(preview.content, 600) : '—'}</Text>
            <TouchableOpacity style={styles.previewClose} onPress={() => setPreview(null)}>
              <Text style={styles.previewCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      ) : null}
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  addIcon: { fontSize: 26, color: colors.primary, width: 40, textAlign: 'right' },
  list: { padding: spacing.lg, paddingTop: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
  heading: { ...type.h2, fontSize: 15 },
  meta: { fontSize: 11, color: colors.textFaint, marginTop: 3 },
  restoreBtn: {
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  restoreText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  center: { alignItems: 'center', paddingVertical: 80 },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted },
  previewBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(21,26,35,0.5)', justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  previewSheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '70%' },
  previewTitle: { ...type.h2, marginBottom: spacing.sm },
  previewContent: { ...type.body, color: colors.textMuted },
  previewClose: {
    alignSelf: 'center', marginTop: spacing.lg, backgroundColor: colors.primary,
    borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
  },
  previewCloseText: { color: '#fff', fontWeight: '700' },
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette, spacing, radius, type, shadow,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient } from '../api';

interface Folder { id: number; name: string; notes_count?: number }

interface Props {
  client: PoznoteClient;
  onOpenFolder: (folder: Folder) => void;
}

export default function FoldersScreen({ client, onOpenFolder }: Props) {
  const colors = usePalette();
  const styles = getStyles(colors);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.listFolders();
      setFolders((res.folders ?? []) as Folder[]);
    } catch (e) {
      // still zeigen was da ist
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await client.createFolder(name, 'Arbeit');
      setNewName('');
      load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const renderFolder = ({ item }: { item: Folder }) => (
    <TouchableOpacity style={[styles.row, shadow]} activeOpacity={0.7} onPress={() => onOpenFolder(item)}>
      <Text style={styles.icon}>📁</Text>
      <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      {item.notes_count != null && <Text style={styles.count}>{item.notes_count}</Text>}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('nav.folders')}</Text>
        <View style={styles.newRow}>
          <TextInput
            style={styles.newInput}
            placeholder={t('folders.newPlaceholder')}
            placeholderTextColor={colors.textFaint}
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={createFolder}
            returnKeyType="done"
          />
          <TouchableOpacity style={styles.addBtn} onPress={createFolder}>
            <Text style={styles.addBtnText}>＋</Text>
          </TouchableOpacity>
        </View>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={folders}
          keyExtractor={(f) => String(f.id)}
          renderItem={renderFolder}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>🗂</Text>
              <Text style={styles.emptyText}>{t('folders.empty')}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg },
  title: { ...type.title, marginBottom: spacing.lg },
  newRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  newInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 15, color: colors.text,
    ...shadow,
  },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 24, marginTop: -2 },
  list: { padding: spacing.lg, paddingTop: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm,
  },
  icon: { fontSize: 20, marginRight: spacing.md },
  name: { ...type.h2, flex: 1, fontSize: 16 },
  count: { ...type.muted, marginRight: spacing.sm },
  chevron: { color: colors.textFaint, fontSize: 22 },
  center: { alignItems: 'center', paddingVertical: 60 },
  empty: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...type.muted },
});

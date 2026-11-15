import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette, spacing, radius, typeFor, shadow,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient } from '../api';
import { readCachedFolders, cacheFolders } from '../api/cache';

interface Folder { id: number; name: string; notes_count?: number; workspace?: string; color_hex?: string | null; icon?: string | null }

/** Lucide-Icon-Klassen des Servers -> Emoji für die App-Anzeige */
const FOLDER_ICONS: Array<[string, string]> = [
  ['lucide-briefcase', '💼'], ['lucide-home', '🏠'], ['lucide-lightbulb', '💡'],
  ['lucide-heart', '❤️'], ['lucide-rocket', '🚀'], ['lucide-book', '📚'],
  ['lucide-code', '💻'], ['lucide-shopping-cart', '🛒'], ['lucide-calendar', '📅'],
  ['lucide-star', '⭐'],
];
const iconToEmoji = (icon?: string | null) => FOLDER_ICONS.find(([k]) => k === icon)?.[1] ?? '📁';

interface Props {
  client: PoznoteClient;
  onOpenFolder: (folder: Folder) => void;
  onOpenKanban: (folder: Folder) => void;
  onBack: () => void;
}

export default function FoldersScreen({ client, onOpenFolder, onOpenKanban, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState('');
  const [firstWorkspace, setFirstWorkspace] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      // Ordner je Workspace laden und zusammenführen — GET /folders liefert sonst nur den ersten
      const wsRes = await client.listWorkspaces().catch(() => null);
      const workspaces = (wsRes?.workspaces ?? []).map((w) => w.name);
      if (workspaces.length > 0) setFirstWorkspace(workspaces[0]);
      const lists = await Promise.all(
        (workspaces.length > 0 ? workspaces : [undefined]).map((ws) =>
          client.listFolders(ws)
            .then((res) => ((res.folders ?? []) as Folder[]).map((f) => ({ ...f, workspace: ws })))
            .catch(() => [] as Folder[]),
        ),
      );
      const list = lists.flat();
      setFolders(list);
      cacheFolders(list).catch(() => {});
    } catch (e) {
      // Offline: letzten bekannten Stand zeigen
      const cached = await readCachedFolders<Folder[]>();
      if (cached && cached.length > 0) setFolders(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  // Boot: Cache sofort zeigen, dann live aktualisieren
  useEffect(() => {
    readCachedFolders<Folder[]>().then((cached) => {
      if (cached && cached.length > 0) setFolders(cached);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const inputRef = useRef<TextInput>(null);

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) {
      // Leeres Feld: Eingabe fokussieren statt still nichts zu tun
      inputRef.current?.focus();
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      await client.createFolder(name, firstWorkspace ?? undefined);
      setNewName('');
      await load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const confirmDeleteFolder = (folder: Folder) => {
    Alert.alert(t('folders.deleteTitle'), t('folders.deleteText', { name: folder.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await client.deleteFolder(folder.id);
            load({ silent: true });
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const folderMenu = (folder: Folder) => {
    Alert.alert(folder.name, '', [
      { text: t('folders.openKanban'), onPress: () => onOpenKanban(folder) },
      { text: t('folders.setIcon'), onPress: () => pickIcon(folder) },
      { text: t('common.delete'), style: 'destructive', onPress: () => confirmDeleteFolder(folder) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const pickIcon = (folder: Folder) => {
    Alert.alert(t('folders.setIcon'), folder.name, [
      ...FOLDER_ICONS.map(([key, emoji]) => ({
        text: emoji,
        onPress: async () => {
          try {
            await client.setFolderIcon(folder.id, key);
            load({ silent: true });
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      })),
      { text: '📁 ' + t('folders.resetIcon'), onPress: async () => {
        try {
          await client.setFolderIcon(folder.id, '');
          load({ silent: true });
        } catch (e: any) {
          Alert.alert(t('common.error'), e?.message ?? String(e));
        }
      } },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const renderFolder = ({ item }: { item: Folder }) => (
    <TouchableOpacity style={[styles.row, shadow]} activeOpacity={0.7} onPress={() => onOpenFolder(item)} onLongPress={() => folderMenu(item)}>
      <Text style={[styles.icon, item.color_hex ? { color: item.color_hex } : null]}>{iconToEmoji(item.icon)}</Text>
      <View style={styles.nameWrap}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {item.workspace ? <Text style={styles.wsLabel} numberOfLines={1}>{item.workspace}</Text> : null}
      </View>
      {item.notes_count != null && <Text style={styles.count}>{item.notes_count}</Text>}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('nav.folders')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.newRow}>
          <TextInput
            ref={inputRef}
            style={styles.newInput}
            placeholder={t('folders.newPlaceholder')}
            placeholderTextColor={colors.textFaint}
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={createFolder}
            returnKeyType="done"
          />
          <TouchableOpacity style={[styles.addBtn, creating && { opacity: 0.6 }]} onPress={createFolder} disabled={creating}>
            {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addBtnText}>＋</Text>}
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
          refreshControl={
            <RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />
          }
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

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
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
  nameWrap: { flex: 1 },
  name: { ...type.h2, fontSize: 16 },
  wsLabel: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
  count: { ...type.muted, marginRight: spacing.sm },
  chevron: { color: colors.textFaint, fontSize: 22 },
  center: { alignItems: 'center', paddingVertical: 60 },
  empty: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { ...type.muted },
});

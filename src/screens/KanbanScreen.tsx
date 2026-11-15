import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { usePalette, spacing, radius, typeFor, shadow,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient, Note } from '../api';

interface KanbanFolder { id: number; name: string; color_hex?: string | null; children?: KanbanFolder[] }

interface Props {
  client: PoznoteClient;
  folderId: number;
  folderName: string;
  onOpenNote: (note: Note) => void;
  onBack: () => void;
}

/**
 * Kanban-Board: Unterordner des gewählten Ordners sind die Spalten,
 * die Notizen darin die Karten. Karte verschieben = folder_id wechseln.
 */
export default function KanbanScreen({ client, folderId, folderName, onOpenNote, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const { width: winW } = useWindowDimensions();
  const columnW = Math.max(240, winW * 0.46);
  const [columns, setColumns] = useState<KanbanFolder[] | null>(null);
  const [cards, setCards] = useState<Record<number, Note[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Ordner über alle Workspaces suchen (GET /folders liefert sonst nur den ersten)
      const wsRes = await client.listWorkspaces().catch(() => null);
      const workspaces = (wsRes?.workspaces ?? []).map((w) => w.name);
      const lists = await Promise.all(
        (workspaces.length > 0 ? workspaces : [undefined]).map((ws) =>
          client.listFolders(ws, true)
            .then((res) => (res.folders ?? []) as KanbanFolder[])
            .catch(() => [] as KanbanFolder[]),
        ),
      );
      const all = lists.flat();
      const folder = all.find((f) => f.id === folderId);
      const children = folder?.children ?? [];
      setColumns(children);
      // Karten je Spalte laden
      const entries = await Promise.all(
        children.map((c) =>
          client.listNotes({ folder_id: c.id })
            .then((res) => [c.id, res.notes ?? []] as [number, Note[]])
            .catch(() => [c.id, [] as Note[]] as [number, Note[]]),
        ),
      );
      const map: Record<number, Note[]> = {};
      for (const [id, notes] of entries) map[id] = notes;
      setCards(map);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [client, folderId]);

  useEffect(() => { load(); }, [load]);

  const moveCard = (note: Note, target: KanbanFolder) => {
    Alert.alert(t('kanban.moveTo'), `„${note.heading}" → ${target.name}`, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.save'),
        onPress: async () => {
          try {
            await client.updateNote(note.id, { folder_id: target.id });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            load();
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const renderCard = (note: Note, column: KanbanFolder) => (
    <TouchableOpacity
      key={note.id}
      style={[styles.card, shadow, note.color_hex ? { borderLeftColor: note.color_hex, borderLeftWidth: 4 } : null]}
      activeOpacity={0.7}
      onPress={() => onOpenNote(note)}
      onLongPress={() => {
        // Ziel-Spalte wählen (andere als die aktuelle)
        const targets = (columns ?? []).filter((c) => c.id !== column.id);
        if (targets.length === 0) return;
        Alert.alert(t('kanban.moveTo'), note.heading, [
          ...targets.slice(0, 5).map((c) => ({ text: c.name, onPress: () => moveCard(note, c) })),
          { text: t('common.cancel'), style: 'cancel' },
        ]);
      }}
    >
      <Text style={styles.cardTitle} numberOfLines={3}>{note.heading || '…'}</Text>
      {note.tags ? <Text style={styles.cardMeta} numberOfLines={1}>{note.tags}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🗂 {folderName}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !columns || columns.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗂</Text>
          <Text style={styles.emptyText}>{t('kanban.empty')}</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
          {columns.map((column) => (
            <View key={column.id} style={[styles.column, { width: columnW }]}>
              <View style={[styles.columnHeader, column.color_hex ? { borderLeftColor: column.color_hex, borderLeftWidth: 3 } : null]}>
                <Text style={styles.columnTitle} numberOfLines={1}>{column.name}</Text>
                <Text style={styles.columnCount}>{cards[column.id]?.length ?? 0}</Text>
              </View>
              <FlatList
                data={cards[column.id] ?? []}
                keyExtractor={(n) => String(n.id)}
                renderItem={({ item }) => renderCard(item, column)}
                contentContainerStyle={styles.columnList}
                ListEmptyComponent={<Text style={styles.columnEmpty}>—</Text>}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  board: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  column: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, maxHeight: '100%' },
  columnHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginBottom: spacing.xs,
  },
  columnTitle: { ...type.h2, fontSize: 14, flex: 1 },
  columnCount: { fontSize: 12, color: colors.textFaint, fontWeight: '700' },
  columnList: { gap: spacing.sm, paddingBottom: spacing.lg },
  columnEmpty: { textAlign: 'center', color: colors.textFaint, paddingVertical: spacing.lg },
  card: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  cardMeta: { fontSize: 11, color: colors.textFaint, marginTop: 3 },
  center: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted, textAlign: 'center' },
});

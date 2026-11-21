import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, useWindowDimensions, PanResponder,
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

interface ColumnBounds { id: number; x: number; y: number; w: number; h: number }

/**
 * Kanban-Board: Unterordner des gewählten Ordners sind die Spalten,
 * die Notizen darin die Karten. Karten lassen sich per Drag&Drop zwischen
 * Spalten verschieben (folder_id-Wechsel); Long-Press öffnet alternativ ein Menü.
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
  // Drag&Drop: schwebende Karte + Spaltengrenzen (Screen-Koordinaten)
  const [drag, setDrag] = useState<{ note: Note; fromId: number; x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState<ColumnBounds[]>([]);
  const columnRefs = useRef<Record<number, View | null>>({});

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

  // Refs beim Unmount leeren — sonst halten sie Views einer abgebauten Board-Instanz fest
  useEffect(() => () => { columnRefs.current = {}; }, []);

  // --- Drag&Drop ---
  const hoveredColumn = useMemo(() => {
    if (!drag || bounds.length === 0) return null;
    return bounds.find((b) => drag.x >= b.x && drag.x <= b.x + b.w && drag.y >= b.y && drag.y <= b.y + b.h)?.id ?? null;
  }, [drag, bounds]);

  const onDragStart = (note: Note, fromId: number, x: number, y: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Spaltengrenzen einmalig beim Greifen messen
    const measured: ColumnBounds[] = [];
    let pending = Object.keys(columnRefs.current).length;
    if (pending === 0) { setDrag({ note, fromId, x, y }); return; }
    for (const [idStr, ref] of Object.entries(columnRefs.current)) {
      if (!ref) {
        // ohne View feuert measureInWindow nie — sonst käme pending nie auf 0
        if (--pending === 0) {
          setBounds(measured);
          setDrag({ note, fromId, x, y });
        }
        continue;
      }
      ref.measureInWindow((bx, by, bw, bh) => {
        measured.push({ id: Number(idStr), x: bx, y: by, w: bw, h: bh });
        if (--pending === 0) {
          setBounds(measured);
          setDrag({ note, fromId, x, y });
        }
      });
    }
  };

  const onDragMove = (x: number, y: number) => {
    setDrag((d) => (d ? { ...d, x, y } : d));
  };

  const onDragEnd = async (note: Note, fromId: number, x: number, y: number) => {
    setDrag(null);
    setBounds([]);
    if (x < 0 || y < 0) return; // abgebrochen
    const target = bounds.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!target || target.id === fromId) return;
    try {
      await client.updateNote(note.id, { folder_id: target.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

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

  const cardMenu = (note: Note, column: KanbanFolder) => {
    const targets = (columns ?? []).filter((c) => c.id !== column.id);
    Alert.alert(t('kanban.moveTo'), note.heading, [
      ...targets.slice(0, 5).map((c) => ({ text: c.name, onPress: () => moveCard(note, c) })),
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const renderCardContent = (note: Note) => (
    <View style={[styles.card, drag?.note.id === note.id && styles.cardDragging, note.color_hex ? { borderLeftColor: note.color_hex, borderLeftWidth: 4 } : null]}>
      <Text style={styles.cardTitle} numberOfLines={3}>{note.heading || '…'}</Text>
      {note.tags ? <Text style={styles.cardMeta} numberOfLines={1}>{note.tags}</Text> : null}
    </View>
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
            <View
              key={column.id}
              ref={(r) => { columnRefs.current[column.id] = r; }}
              style={[styles.column, { width: columnW }, hoveredColumn === column.id && styles.columnHovered]}
            >
              <View style={[styles.columnHeader, column.color_hex ? { borderLeftColor: column.color_hex, borderLeftWidth: 3 } : null]}>
                <Text style={styles.columnTitle} numberOfLines={1}>{column.name}</Text>
                <Text style={styles.columnCount}>{cards[column.id]?.length ?? 0}</Text>
              </View>
              <FlatList
                data={cards[column.id] ?? []}
                keyExtractor={(n) => String(n.id)}
                renderItem={({ item }) => (
                  <KanbanCard
                    note={item}
                    column={column}
                    onPress={onOpenNote}
                    onMenu={cardMenu}
                    onDragStart={onDragStart}
                    onDragMove={onDragMove}
                    onDragEnd={onDragEnd}
                    renderContent={renderCardContent}
                  />
                )}
                contentContainerStyle={styles.columnList}
                ListEmptyComponent={<Text style={styles.columnEmpty}>—</Text>}
              />
            </View>
          ))}
        </ScrollView>
      )}
      {/* Schwebende Karte folgt dem Finger */}
      {drag && (
        <View pointerEvents="none" style={[styles.dragLayer, { left: drag.x - 110, top: drag.y - 24 }]}>
          {renderCardContent(drag.note)}
        </View>
      )}
    </SafeAreaView>
  );
}

/** Karte mit eigener Gesten-Erkennung: Tap = öffnen, Long-Press = Menü, Ziehen = Drag&Drop */
function KanbanCard({ note, column, onPress, onMenu, onDragStart, onDragMove, onDragEnd, renderContent }: {
  note: Note;
  column: KanbanFolder;
  onPress: (note: Note) => void;
  onMenu: (note: Note, column: KanbanFolder) => void;
  onDragStart: (note: Note, fromId: number, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (note: Note, fromId: number, x: number, y: number) => void;
  renderContent: (note: Note) => React.ReactNode;
}) {
  const gesture = useRef({ x: 0, y: 0, t: 0, dragging: false, longFired: false });
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Neueste Props/Callbacks für die Pan-Handler: useRef(PanResponder.create(...))
  // behält die erste Instanz — ohne diesen Ref würden die Handler dauerhaft
  // die Werte des ersten Renders closen (z.B. onDragEnd mit bounds = [])
  const latest = useRef({ note, column, onPress, onMenu, onDragStart, onDragMove, onDragEnd });
  latest.current = { note, column, onPress, onMenu, onDragStart, onDragMove, onDragEnd };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const L = latest.current;
      gesture.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now(), dragging: false, longFired: false };
      longTimer.current = setTimeout(() => {
        if (!gesture.current.dragging) {
          gesture.current.longFired = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          latest.current.onMenu(latest.current.note, latest.current.column);
        }
      }, 550);
    },
    onPanResponderMove: (e) => {
      const L = latest.current;
      const g = gesture.current;
      const dx = e.nativeEvent.pageX - g.x;
      const dy = e.nativeEvent.pageY - g.y;
      if (!g.dragging && !g.longFired && (Math.abs(dx) > 12 || Math.abs(dy) > 12) && Date.now() - g.t > 150) {
        g.dragging = true;
        if (longTimer.current) clearTimeout(longTimer.current);
        L.onDragStart(L.note, L.column.id, e.nativeEvent.pageX, e.nativeEvent.pageY);
      } else if (g.dragging) {
        L.onDragMove(e.nativeEvent.pageX, e.nativeEvent.pageY);
      }
    },
    onPanResponderRelease: (e) => {
      if (longTimer.current) clearTimeout(longTimer.current);
      const L = latest.current;
      const g = gesture.current;
      if (g.dragging) {
        L.onDragEnd(L.note, L.column.id, e.nativeEvent.pageX, e.nativeEvent.pageY);
      } else if (!g.longFired && Date.now() - g.t < 400) {
        L.onPress(L.note);
      }
      g.dragging = false;
    },
    onPanResponderTerminate: () => {
      if (longTimer.current) clearTimeout(longTimer.current);
      const L = latest.current;
      if (gesture.current.dragging) L.onDragEnd(L.note, L.column.id, -1, -1);
      gesture.current.dragging = false;
    },
  })).current;

  // Long-Press-Timer beim Unmount aufräumen
  useEffect(() => () => {
    if (longTimer.current) clearTimeout(longTimer.current);
  }, []);

  return <View {...pan.panHandlers}>{renderContent(note)}</View>;
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  board: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  column: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, maxHeight: '100%' },
  columnHovered: { borderWidth: 2, borderColor: colors.primary },
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
  cardDragging: { opacity: 0.35 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  cardMeta: { fontSize: 11, color: colors.textFaint, marginTop: 3 },
  dragLayer: {
    position: 'absolute', width: 220,
    transform: [{ scale: 1.05 }, { rotate: '-2deg' }],
    ...shadow,
    zIndex: 100, elevation: 10,
  },
  center: { alignItems: 'center', paddingVertical: 80, paddingHorizontal: spacing.xl },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted, textAlign: 'center' },
});

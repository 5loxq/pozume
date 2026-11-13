import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette, spacing, radius, type, shadow,
  Palette,
} from '../theme';
import { t, getLocale } from '../i18n';
import type { PoznoteClient, Note } from '../api';
import { extractTasks, type Task } from '../utils';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onBack: () => void;
}

export default function TasksScreen({ client, onOpenNote, onBack }: Props) {
  const colors = usePalette();
  const styles = getStyles(colors);
  const locale = getLocale();
  const [tasks, setTasks] = useState<(Task & { note?: Note })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.listNotes();
      const all: (Task & { note?: Note })[] = [];
      for (const n of res.notes ?? []) {
        // Inhalt fehlt in Liste -> Details je Notiz mit Aufgaben nachladen (max 50)
        const detail = await client.getNote(n.id).catch(() => null);
        const content = detail?.note?.content ?? n.content ?? '';
        for (const task of extractTasks(content, n.id, n.heading)) {
          all.push({ ...task, note: n });
        }
      }
      all.sort((a, b) => Number(a.done) - Number(b.done));
      setTasks(all);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (task: Task & { note?: Note }) => {
    if (!task.note) return;
    const detail = await client.getNote(task.noteId).catch(() => null);
    if (!detail?.note?.content) return;
    const lines = detail.note.content.split('\n');
    const m = lines[task.lineIndex]?.match(/^(\s*[-*]\s+\[)( |x|X)(\])/);
    if (!m) return;
    lines[task.lineIndex] = m[1] + (task.done ? ' ' : 'x') + m[3] + lines[task.lineIndex].slice(m[0].length);
    await client.updateNote(task.noteId, { content: lines.join('\n') }).catch(() => {});
    load();
  };

  const renderItem = ({ item }: { item: Task & { note?: Note } }) => (
    <TouchableOpacity
      style={[styles.row, shadow]}
      activeOpacity={0.7}
      onPress={() => item.note && onOpenNote(item.note)}
    >
      <TouchableOpacity style={styles.checkbox} onPress={() => toggle(item)} hitSlop={{ left: 6, right: 6, top: 6, bottom: 6 }}>
        <Text style={[styles.checkIcon, { color: item.done ? colors.success : colors.border }]}>
          {item.done ? '✓' : '○'}
        </Text>
      </TouchableOpacity>
      <View style={styles.textWrap}>
        <Text style={[styles.taskText, item.done && styles.doneText]} numberOfLines={2}>{item.text}</Text>
        <Text style={styles.sourceText} numberOfLines={1}>{t('tasks.fromNote')} „{item.noteHeading}"</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.back, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>☑️ {t('tasks.title')}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>🎉</Text>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('tasks.empty')}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  list: { padding: spacing.lg, paddingTop: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm,
  },
  checkbox: { width: 36, alignItems: 'center' },
  checkIcon: { fontSize: 22, fontWeight: '700' },
  textWrap: { flex: 1, marginLeft: spacing.sm },
  taskText: { fontSize: 15, lineHeight: 21 },
  doneText: { textDecorationLine: 'line-through', opacity: 0.5 },
  sourceText: { fontSize: 12, marginTop: 2, opacity: 0.6 },
  center: { alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted },
});

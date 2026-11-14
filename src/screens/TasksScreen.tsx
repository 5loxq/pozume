import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette, spacing, radius, typeFor, shadow } from '../theme';
import { t } from '../i18n';
import type { PoznoteClient, Note } from '../api';
import { extractTasks, type Task } from '../utils';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onBack: () => void;
}

export default function TasksScreen({ client, onOpenNote, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = useMemo(() => getStyles(type), [colors]);
  const [tasks, setTasks] = useState<(Task & { note?: Note; serverTaskId?: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Server-Tasklisten (ein Request) und Markdown-Checkboxen (parallel, max 50) zusammenführen
      const [taskRes, notesRes] = await Promise.all([
        client.listTasks().catch(() => null),
        client.listNotes().catch(() => null),
      ]);
      const all: (Task & { note?: Note; serverTaskId?: number })[] = [];
      // Notizen, deren Aufgaben der Server schon über /tasks geliefert hat —
      // deren Checkboxen dürfen nicht zusätzlich lokal extrahiert werden (Duplikate)
      const serverNoteIds = new Set<number>();
      for (const n of taskRes?.notes ?? []) {
        serverNoteIds.add(n.id);
        for (const task of n.tasks ?? []) {
          all.push({
            noteId: n.id, noteHeading: n.heading, text: task.text,
            done: task.completed, lineIndex: -1, serverTaskId: task.id,
            note: { id: n.id, heading: n.heading } as Note,
          });
        }
      }
      const list = (notesRes?.notes ?? []).filter((n) => n.type !== 'tasklist' && !serverNoteIds.has(n.id)).slice(0, 50);
      const details = await Promise.all(list.map((n) => client.getNote(n.id).catch(() => null)));
      list.forEach((n, i) => {
        const content = details[i]?.note?.content ?? n.content ?? '';
        for (const task of extractTasks(content, n.id, n.heading)) {
          all.push({ ...task, note: n });
        }
      });
      all.sort((a, b) => Number(a.done) - Number(b.done));
      setTasks(all);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (task: Task & { note?: Note; serverTaskId?: number }) => {
    if (task.serverTaskId != null) {
      await client.updateTask(task.noteId, task.serverTaskId, { completed: !task.done }).catch(() => {});
      load();
      return;
    }
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

  const renderItem = ({ item }: { item: Task & { note?: Note; serverTaskId?: number } }) => (
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
          keyExtractor={(item, i) => `${item.noteId}-${item.serverTaskId ?? 'md'}-${item.lineIndex}-${i}`}
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

const getStyles = (type: ReturnType<typeof typeFor>) => StyleSheet.create({
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

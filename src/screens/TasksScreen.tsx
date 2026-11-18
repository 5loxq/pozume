import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { usePalette, spacing, radius, typeFor, shadow, Palette } from '../theme';
import { t } from '../i18n';
import type { PoznoteClient, Note } from '../api';
import { extractTasks, type Task } from '../utils';
import PromptModal from '../components/PromptModal';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onBack: () => void;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
export default function TasksScreen({ client, onOpenNote, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const [tasks, setTasks] = useState<(Task & { note?: Note; serverTaskId?: number; priority?: string | null; dueAt?: string | null })[]>([]);
  const [loading, setLoading] = useState(true);
  // Kurz sichtbare Fehlermeldung (z.B. gescheitertes Umschalten einer Aufgabe)
  const [error, setError] = useState<string | null>(null);
  const [taskLists, setTaskLists] = useState<Array<{ id: number; heading: string }>>([]);
  const [addPrompt, setAddPrompt] = useState(false);
  const [addText, setAddText] = useState('');
  const [duePrompt, setDuePrompt] = useState(false);
  const [dueTask, setDueTask] = useState<(Task & { serverTaskId?: number; dueAt?: string | null }) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Server-Tasklisten (ein Request) und Markdown-Checkboxen (parallel, max 50) zusammenführen
      const [taskRes, notesRes] = await Promise.all([
        client.listTasks().catch(() => null),
        client.listNotes().catch(() => null),
      ]);
      const serverLists = taskRes?.notes ?? [];
      setTaskLists(serverLists.map((n) => ({ id: n.id, heading: n.heading })));
      const all: (Task & { note?: Note; serverTaskId?: number; priority?: string | null; dueAt?: string | null })[] = [];
      // Notizen, deren Aufgaben der Server schon über /tasks geliefert hat —
      // deren Checkboxen dürfen nicht zusätzlich lokal extrahiert werden (Duplikate)
      const serverNoteIds = new Set<number>();
      for (const n of serverLists) {
        serverNoteIds.add(n.id);
        for (const task of n.tasks ?? []) {
          all.push({
            noteId: n.id, noteHeading: n.heading, text: task.text,
            done: task.completed, lineIndex: -1, serverTaskId: task.id,
            priority: task.priority ?? null, dueAt: task.dueAt ?? null,
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
      // Offene zuerst, dann nach Priorität (hoch > mittel > niedrig > keine), dann nach Fälligkeit
      all.sort((a, b) => {
        if (a.done !== b.done) return Number(a.done) - Number(b.done);
        const pa = PRIORITY_ORDER[a.priority ?? 'none'] ?? 3;
        const pb = PRIORITY_ORDER[b.priority ?? 'none'] ?? 3;
        if (pa !== pb) return pa - pb;
        const da = a.dueAt ?? '';
        const db = b.dueAt ?? '';
        if (da !== db) return da < db ? -1 : 1;
        return 0;
      });
      setTasks(all);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  /** Fehler kurz sichtbar melden und nach 4s wieder ausblenden */
  const flashError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError((cur) => (cur === msg ? null : cur)), 4000);
  }, []);

  const toggle = async (task: Task & { note?: Note; serverTaskId?: number }) => {
    if (task.serverTaskId != null) {
      try {
        await client.updateTask(task.noteId, task.serverTaskId, { completed: !task.done });
        load();
      } catch {
        // Fehlgeschlagen (z.B. Konflikt): Liste neu laden und kurz melden
        flashError(t('tasks.toggleFailed'));
        load();
      }
      return;
    }
    if (!task.note) return;
    const detail = await client.getNote(task.noteId).catch(() => null);
    if (!detail?.note?.content) return;
    const lines = detail.note.content.split('\n');
    const m = lines[task.lineIndex]?.match(/^(\s*[-*]\s+\[)( |x|X)(\])/);
    if (!m) return;
    lines[task.lineIndex] = m[1] + (task.done ? ' ' : 'x') + m[3] + lines[task.lineIndex].slice(m[0].length);
    try {
      await client.updateNote(task.noteId, {
        content: lines.join('\n'),
        // if_version der geladenen Notiz mitschicken — verlorene Updates vermeiden
        ...(detail.note.version ? { if_version: detail.note.version } : {}),
      });
      load();
    } catch {
      // Fehlgeschlagen (z.B. 409-Konflikt): Liste neu laden und kurz melden
      flashError(t('tasks.toggleFailed'));
      load();
    }
  };

  const cyclePriority = async (task: Task & { serverTaskId?: number; priority?: string | null }) => {
    if (task.serverTaskId == null) return;
    const order = ['none', 'high', 'medium', 'low'];
    const next = order[(order.indexOf(task.priority ?? 'none') + 1) % order.length];
    try {
      await client.updateTask(task.noteId, task.serverTaskId, { priority: next === 'none' ? 'none' : next });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const confirmDeleteTask = (task: Task & { serverTaskId?: number }) => {
    if (task.serverTaskId == null) return;
    Alert.alert(task.text, '', [
      { text: t('tasks.setDue'), onPress: () => { setDueTask(task); setDuePrompt(true); } },
      { text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await client.deleteTask(task.noteId, task.serverTaskId!);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            load();
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        } },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  // Faelligkeit einer Server-Aufgabe setzen (P1-13)
  const submitDueDate = async (value: string) => {
    const task = dueTask;
    setDuePrompt(false);
    if (!task?.serverTaskId) return;
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      Alert.alert(t('common.error'), t('tasks.duePrompt'));
      return;
    }
    try {
      await client.updateTask(task.noteId, task.serverTaskId, { due_at: value.trim() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  // --- Aufgabe hinzufügen: Text eingeben, dann Ziel-Taskliste wählen ---
  const submitAddText = (text: string) => {
    setAddPrompt(false);
    const trimmed = text.trim();
    if (!trimmed) return;
    setAddText(trimmed);
    if (taskLists.length === 0) {
      createInNewList(trimmed);
      return;
    }
    const buttons = taskLists.slice(0, 4).map((tl) => ({
      text: tl.heading.length > 18 ? tl.heading.slice(0, 18) + '…' : tl.heading,
      onPress: () => addToList(tl.id, trimmed),
    }));
    Alert.alert(t('tasks.chooseNote'), '', [
      ...buttons,
      { text: t('tasks.newList'), onPress: () => createInNewList(trimmed) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const addToList = async (noteId: number, text: string) => {
    try {
      await client.addTask(noteId, { text });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const createInNewList = async (text: string) => {
    try {
      const res = await client.createNote({ heading: t('tasks.defaultListName'), content: '[]', type: 'tasklist' });
      await client.addTask(res.note.id, { text });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const priorityColor = (p?: string | null): string | null => {
    if (p === 'high') return colors.danger;
    if (p === 'medium') return colors.star;
    if (p === 'low') return colors.accent;
    return null;
  };

  const dueLabel = (dueAt?: string | null): string | null => {
    if (!dueAt) return null;
    const d = new Date(dueAt.includes('T') ? dueAt : dueAt + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const dateStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' });
    // Überfällig = vor heute (heutige Fälligkeit ist noch nicht überfällig)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime()
      ? t('tasks.overdue', { date: dateStr })
      : t('tasks.due', { date: dateStr });
  };

  const renderItem = ({ item }: { item: Task & { note?: Note; serverTaskId?: number; priority?: string | null; dueAt?: string | null } }) => {
    const pColor = priorityColor(item.priority);
    const due = dueLabel(item.dueAt);
    return (
      <TouchableOpacity
        style={[styles.row, shadow]}
        activeOpacity={0.7}
        onPress={() => item.note && onOpenNote(item.note)}
        onLongPress={item.serverTaskId != null ? () => confirmDeleteTask(item) : undefined}
      >
        <TouchableOpacity style={styles.checkbox} onPress={() => toggle(item)} hitSlop={{ left: 6, right: 6, top: 6, bottom: 6 }}>
          <Text style={[styles.checkIcon, { color: item.done ? colors.success : colors.border }]}>
            {item.done ? '✓' : '○'}
          </Text>
        </TouchableOpacity>
        <View style={styles.textWrap}>
          <Text style={[styles.taskText, item.done && styles.doneText]} numberOfLines={2}>{item.text}</Text>
          <Text style={styles.sourceText} numberOfLines={1}>
            {t('tasks.fromNote')} „{item.noteHeading}"
            {item.serverTaskId != null && item.priority && item.priority !== 'none'
              ? ` · ${t(item.priority === 'high' ? 'tasks.priorityHigh' : item.priority === 'medium' ? 'tasks.priorityMedium' : 'tasks.priorityLow')}`
              : ''}
            {due ? ` · ${due}` : ''}
          </Text>
        </View>
        {item.serverTaskId != null && !item.done ? (
          <TouchableOpacity
            style={[styles.prioDot, pColor ? { backgroundColor: pColor } : { borderWidth: 1, borderColor: colors.border }]}
            onPress={() => cyclePriority(item)}
            hitSlop={{ left: 6, right: 6, top: 6, bottom: 6 }}
          />
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.back, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>☑️ {t('tasks.title')}</Text>
        <TouchableOpacity onPress={() => { setAddText(''); setAddPrompt(true); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.addIcon}>＋</Text>
        </TouchableOpacity>
      </View>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
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
      <PromptModal
        visible={addPrompt}
        title={t('tasks.add')}
        placeholder={t('tasks.addPrompt')}
        defaultValue={addText}
        onCancel={() => setAddPrompt(false)}
        onSubmit={submitAddText}
      />
      <PromptModal
        visible={duePrompt}
        title={t('tasks.setDue')}
        placeholder={t('tasks.duePrompt')}
        defaultValue={dueTask?.dueAt?.split('T')[0] ?? ''}
        onCancel={() => setDuePrompt(false)}
        onSubmit={submitDueDate}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  addIcon: { fontSize: 26, width: 40, textAlign: 'right' },
  list: { padding: spacing.lg, paddingTop: 0 },
  errorBanner: {
    backgroundColor: colors.dangerSoft, borderRadius: radius.md,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  errorText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm,
  },
  checkbox: { width: 36, alignItems: 'center' },
  checkIcon: { fontSize: 22, fontWeight: '700' },
  textWrap: { flex: 1, marginLeft: spacing.sm },
  taskText: { fontSize: 15, lineHeight: 21, color: colors.text },
  doneText: { textDecorationLine: 'line-through', opacity: 0.5 },
  sourceText: { fontSize: 12, marginTop: 2, color: colors.textMuted },
  prioDot: { width: 14, height: 14, borderRadius: 7, marginLeft: spacing.sm },
  center: { alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted },
});

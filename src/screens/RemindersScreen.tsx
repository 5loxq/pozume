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
import type { PoznoteClient, Note, ReminderRow } from '../api';
import { formatRelativeDate } from '../utils';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onBack: () => void;
}

/** Erinnerungs-Zentrale: bevorstehende und ausgelöste Server-Erinnerungen */
export default function RemindersScreen({ client, onOpenNote, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const locale = getLocale();
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const res = await client.listReminders('all');
      setRows(res.reminders);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const dismiss = async (row: ReminderRow) => {
    try {
      await client.dismissReminder(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const markRead = async (row: ReminderRow) => {
    try {
      await client.markReminderRead(row.id);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_read: true } : r)));
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const dismissAll = () => {
    Alert.alert(t('reminders.dismissAllTitle'), t('reminders.dismissAllText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('reminders.dismissAll'), style: 'destructive',
        onPress: async () => {
          try {
            await client.dismissAllReminders();
            setRows((prev) => prev.filter((r) => r.state !== 'fired'));
          } catch (e: any) {
            Alert.alert(t('common.error'), e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const upcoming = rows.filter((r) => r.state === 'upcoming');
  const fired = rows.filter((r) => r.state !== 'upcoming');

  const renderRow = (row: ReminderRow) => (
    <View key={row.id} style={[styles.row, shadow, row.state === 'fired' && !row.is_read && styles.rowUnread]}>
      <TouchableOpacity
        style={styles.rowMain}
        activeOpacity={0.7}
        onPress={row.note_id != null ? () => onOpenNote({ id: row.note_id!, heading: row.note_heading ?? '' }) : undefined}
      >
        <Text style={styles.heading} numberOfLines={1}>
          {row.state === 'upcoming' ? '⏰' : '🔔'} {row.note_heading ?? row.message ?? '…'}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatRelativeDate(row.trigger_at, locale) || row.trigger_at}
          {row.message ? ` · ${row.message}` : ''}
          {row.recurrence ? ` · ↻ ${row.recurrence}` : ''}
        </Text>
      </TouchableOpacity>
      {row.state === 'fired' && !row.is_read ? (
        <TouchableOpacity style={styles.smallBtn} onPress={() => markRead(row)} hitSlop={{ left: 6, right: 6 }}>
          <Text style={styles.smallBtnText}>{t('reminders.read')}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.smallBtnDanger} onPress={() => dismiss(row)} hitSlop={{ left: 6, right: 6 }}>
        <Text style={styles.smallBtnTextDanger}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🔔 {t('reminders.title')}</Text>
        {fired.length > 0 ? (
          <TouchableOpacity onPress={dismissAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.dismissAll}>{t('reminders.dismissAll')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : (
        <FlatList
          data={[...upcoming, ...fired]}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => renderRow(item)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyEmoji}>🔔</Text>
              <Text style={styles.emptyText}>{t('reminders.empty')}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  dismissAll: { fontSize: 13, fontWeight: '600', color: colors.danger, width: 60, textAlign: 'right' },
  list: { padding: spacing.lg, paddingTop: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm,
  },
  rowUnread: { borderWidth: 1, borderColor: colors.primary },
  rowMain: { flex: 1, marginRight: spacing.sm },
  heading: { ...type.h2, fontSize: 15 },
  meta: { fontSize: 11, color: colors.textFaint, marginTop: 3 },
  smallBtn: {
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6, marginRight: spacing.xs,
  },
  smallBtnText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  smallBtnDanger: { padding: spacing.xs },
  smallBtnTextDanger: { color: colors.danger, fontSize: 15, fontWeight: '700' },
  center: { alignItems: 'center', paddingVertical: 80 },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted },
});

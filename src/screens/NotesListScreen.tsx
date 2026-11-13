import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, type, shadow, shadowSoft, greetingForHour } from '../theme';
import { t, getLocale } from '../i18n';
import type { PoznoteClient, Note } from '../api';
import NoteCard from '../components/NoteCard';
import { readCachedNotes, cacheNotes } from '../api/cache';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onCreateNote: () => void;
  folderId?: number;
  title?: string;
  onBack?: () => void;
  onOpenFolders?: () => void;
  onOpenTrash?: () => void;
  onOpenSettings?: () => void;
  tag?: string;
  onBackFromTag?: () => void;
  onTagPress?: (tag: string) => void;
}

export default function NotesListScreen({ client, onOpenNote, onCreateNote, folderId, title, onBack, onOpenFolders, onOpenTrash, onOpenSettings, tag, onBackFromTag, onTagPress }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title'>('updated');
  const locale = getLocale();

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await client.listNotes({ ...(folderId != null ? { folder_id: folderId } : {}), ...(tag ? { tag } : {}) });
      setNotes(res.notes ?? []);
      cacheNotes(res.notes ?? []).catch(() => {});
    } catch (e: any) {
      // Offline: Cache zeigen statt harter Fehler
      const cached = await readCachedNotes<Note[]>();
      if (cached && cached.length > 0) {
        setNotes(cached);
      } else {
        setError(e?.message ?? String(e));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client, folderId]);

  // Boot: sofort Cache zeigen, dann live aktualisieren
  useEffect(() => {
    if (folderId == null) {
      readCachedNotes<Note[]>().then((cached) => {
        if (cached && cached.length > 0) setNotes(cached);
      });
    }
  }, [folderId]);

  // Such-Debounce: Input sofort, Filter mit 300ms Verzoegerung
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    let out = notes;
    if (showFavorites) out = out.filter((n) => n.favorite);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter((n) =>
        (n.heading ?? '').toLowerCase().includes(q) ||
        (n.content ?? '').toLowerCase().includes(q));
    }
    if (sortBy === 'title') {
      out.sort((a, b) => (a.heading ?? '').localeCompare(b.heading ?? '', locale));
    } else if (sortBy === 'created') {
      out.sort((a, b) => new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime());
    } else {
      out.sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime());
    }
    return out;
  }, [notes, search, showFavorites, sortBy, locale]);

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.backBtn}>←</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.greetingFlex}>
          <Text style={styles.greeting}>{title ?? greetingForHour(new Date().getHours(), locale)}</Text>
          <Text style={styles.countText}>
            {visible.length === 1 ? t('list.countNote') : t('list.countNotes', { n: visible.length })}
          </Text>
        </View>
        <View style={styles.headerBtns}>
          {onOpenFolders ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenFolders}>
              <Text style={styles.folderBtnText}>📁</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenTrash ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenTrash}>
              <Text style={styles.folderBtnText}>🗑</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenSettings ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenSettings}>
              <Text style={styles.folderBtnText}>⚙️</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('list.searchPlaceholder')}
          placeholderTextColor={colors.textFaint}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
      </View>
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.chip, !showFavorites && styles.chipActive]}
          onPress={() => setShowFavorites(false)}>
          <Text style={[styles.chipText, !showFavorites && styles.chipTextActive]}>{t('list.allNotes')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, showFavorites && styles.chipActive]}
          onPress={() => setShowFavorites(true)}>
          <Text style={[styles.chipText, showFavorites && styles.chipTextActive]}>★ {t('list.favorites')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, sortBy === 'title' && styles.chipActive]}
          onPress={() => setSortBy((v) => (v === 'title' ? 'updated' : 'title'))}>
          <Text style={[styles.chipText, sortBy === 'title' && styles.chipTextActive]}>A–Z</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, sortBy === 'created' && styles.chipActive]}
          onPress={() => setSortBy((v) => (v === 'created' ? 'updated' : 'created'))}>
          <Text style={[styles.chipText, sortBy === 'created' && styles.chipTextActive]}>↑↓</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.center}>
          <Text style={styles.errorText}>{t('common.error')}</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (visible.length === 0 && search.trim()) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🔍</Text>
          <Text style={styles.emptyTitle}>{t('list.searchEmpty', { q: searchQuery.trim() })}</Text>
        </View>
      );
    }
    if (visible.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🪶</Text>
          <Text style={styles.emptyTitle}>{t('list.emptyTitle')}</Text>
          <Text style={styles.emptyText}>{t('list.emptyText')}</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={visible}
        keyExtractor={(n) => String(n.id)}
        renderItem={({ item }) => (
          <NoteCard note={item} locale={locale} onPress={onOpenNote} onTagPress={onTagPress} />
        )}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderBody}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />
        }
      />
      <TouchableOpacity style={[styles.fab, shadow]} onPress={onCreateNote} activeOpacity={0.85}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: spacing.lg, paddingBottom: 100 },
  header: { marginBottom: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  greetingFlex: { flex: 1, marginBottom: 0 },
  backBtn: { fontSize: 28, color: colors.text, marginRight: spacing.md },
  headerBtns: { flexDirection: 'row', gap: spacing.sm },
  folderBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow },
  folderBtnText: { fontSize: 19 },
  greeting: { ...type.title, fontSize: 26 },
  countText: { ...type.faint(), marginTop: 2 },
  searchWrap: { marginBottom: spacing.md },
  searchInput: {
    backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, color: colors.text,
    ...shadow,
  },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    ...shadowSoft,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  center: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: spacing.xl },
  errorText: { fontSize: 17, fontWeight: '600', color: colors.danger },
  errorDetail: { ...type.muted, marginTop: spacing.sm, textAlign: 'center' },
  retryBtn: { marginTop: spacing.lg, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: '#fff', fontWeight: '600' },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptyText: { ...type.muted, marginTop: spacing.xs, textAlign: 'center' },
  fab: {
    position: 'absolute', right: spacing.xl, bottom: spacing.xl,
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  fabText: { color: '#fff', fontSize: 30, marginTop: -2 },
});

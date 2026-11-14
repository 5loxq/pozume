import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Modal, Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import { usePalette, spacing, radius, typeFor, shadow, shadowSoft, greetingForHour,
  Palette,
} from '../theme';
import { t, getLocale } from '../i18n';
import type { PoznoteClient, Note } from '../api';
import NoteCard from '../components/NoteCard';
import { readCachedNotes, cacheNotes } from '../api/cache';
import { readDrawingCache, writeDrawingCache } from '../api/drawCache';
import { isDrawingContent } from '../components/DrawingEditor';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onCreateNote: () => void;
  onCreateDrawing?: () => void;
  folderId?: number;
  title?: string;
  onBack?: () => void;
  onOpenFolders?: () => void;
  onOpenTrash?: () => void;
  onOpenSettings?: () => void;
  onOpenAi?: () => void;
  onOpenTasks?: () => void;
  onOpenTags?: () => void;
  onOpenReminders?: () => void;
  onOpenGraph?: () => void;
  tag?: string;
  onTagPress?: (tag: string) => void;
  /** Erhöht sich, wenn sich Daten geändert haben (z.B. nach dem Speichern im Editor) */
  refreshKey?: number;
}

export default function NotesListScreen({ client, onOpenNote, onCreateNote, onCreateDrawing, folderId, title, onBack, onOpenFolders, onOpenTrash, onOpenSettings, onOpenAi, onOpenTasks, onOpenTags, onOpenReminders, onOpenGraph, tag, onTagPress, refreshKey }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title'>('updated');
  const [menuNote, setMenuNote] = useState<Note | null>(null);
  // Zeichnungsinhalte für Karten-Vorschauen (noteId -> Inhalt), aus Cache + Hintergrund-Nachladen
  const [drawings, setDrawings] = useState<Record<number, string>>({});

  const showNoteMenu = (n: Note) => setMenuNote(n);

  const menuAction = async (action: 'pin' | 'duplicate' | 'share') => {
    const n = menuNote;
    setMenuNote(null);
    if (!n) return;
    try {
      if (action === 'pin') {
        await client.setPinned(n.id, !n.pinned);
        load({ silent: true });
      } else if (action === 'duplicate') {
        await client.duplicateNote(n.id);
        load({ silent: true });
      } else if (action === 'share') {
        const res = await client.shareNote(n.id);
        const url = (res as any).share_url ?? (res as any).url;
        if (url) {
          await Share.share({ title: n.heading, message: url });
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };
  const locale = getLocale();

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const res = await client.listNotes({ ...(folderId != null ? { folder_id: folderId } : {}), ...(tag ? { tags: tag } : {}) });
      let list = res.notes ?? [];
      // Der Server ignoriert den tags-Parameter je nach Version — deshalb zusätzlich lokal filtern
      if (tag) {
        const wanted = tag.toLowerCase();
        list = list.filter((n) =>
          (n.tags ?? '').split(',').map((s) => s.trim().toLowerCase()).includes(wanted));
      }
      setNotes(list);
      // Nur die ungefilterte Gesamtliste cachen — Teilmenge würden beim nächsten Boot
      // fälschlich als "alle Notizen" erscheinen.
      if (folderId == null && !tag) cacheNotes(list).catch(() => {});
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
  }, [client, folderId, tag]);

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

  // Server-Volltextsuche ab 3 Zeichen (findet auch Inhalte, die nicht geladen sind);
  // darunter lokales Filtern der geladenen Liste.
  const usedServerSearch = useRef(false);
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3) {
      // Suche verlassen: Basisliste wiederherstellen
      if (usedServerSearch.current) {
        usedServerSearch.current = false;
        load({ silent: true });
      }
      return;
    }
    if (folderId != null || tag) return;
    let cancelled = false;
    usedServerSearch.current = true;
    setLoading(true);
    client.searchNotes(q, { limit: 50 })
      .then((res) => { if (!cancelled) setNotes(res.notes ?? []); })
      .catch(() => { if (!cancelled) load({ silent: true }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [searchQuery, client, folderId, tag, load]);

  // Nach Änderungen (z.B. Speichern im Editor) still neu laden — außer eine
  // Server-Suche ist aktiv: deren Ergebnis würde sonst durch die volle Liste ersetzt.
  useEffect(() => {
    if (refreshKey == null || refreshKey === 0) return;
    if (searchQuery.trim().length >= 3) return;
    load({ silent: true });
  }, [refreshKey, load, searchQuery]);

  // Zeichnungsinhalte im Hintergrund synchronisieren: Cache zeigen, und nur Notizen
  // nachladen, deren Inhalt noch nicht (oder nicht mehr aktuell) gecacht ist.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cache = await readDrawingCache();
      const fresh: Record<number, string> = {};
      const stale: Note[] = [];
      for (const n of notes) {
        const entry = cache[n.id];
        if (entry && entry.u === (n.updated_at ?? '')) fresh[n.id] = entry.c;
        else stale.push(n);
      }
      if (!cancelled) setDrawings(fresh);
      if (stale.length === 0) return;
      const details = await Promise.all(
        stale.slice(0, 60).map((n) => client.getNote(n.id).catch(() => null)),
      );
      details.forEach((r, i) => {
        const n = stale[i];
        const content = r?.note?.content;
        if (content && isDrawingContent(content)) {
          cache[n.id] = { u: n.updated_at ?? '', c: content };
          fresh[n.id] = content;
        } else {
          delete cache[n.id];
        }
      });
      writeDrawingCache(cache);
      if (!cancelled) setDrawings({ ...fresh });
    })();
    return () => { cancelled = true; };
  }, [notes, client]);

  const visible = useMemo(() => {
    let out = notes;
    if (showFavorites) out = out.filter((n) => n.favorite);
    const q = searchQuery.trim().toLowerCase();
    if (q && q.length < 3) {
      out = out.filter((n) =>
        (n.heading ?? '').toLowerCase().includes(q) ||
        (n.content ?? '').toLowerCase().includes(q));
    }
    // Kopie sortieren — der State-Array selbst darf nicht mutiert werden
    const sorted = [...out];
    if (sortBy === 'title') {
      sorted.sort((a, b) => (a.heading ?? '').localeCompare(b.heading ?? '', locale));
    } else if (sortBy === 'created') {
      sorted.sort((a, b) => new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime());
    } else {
      sorted.sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime());
    }
    // Angepinnte Notizen immer nach oben (stabil, Sortierung bleibt innerhalb der Gruppen)
    return [...sorted.filter((n) => n.pinned), ...sorted.filter((n) => !n.pinned)];
  }, [notes, searchQuery, showFavorites, sortBy, locale]);

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
          {onOpenTasks ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenTasks}>
              <Text style={styles.folderBtnText}>☑️</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenTags ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenTags}>
              <Text style={styles.folderBtnText}>🏷</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenReminders ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenReminders}>
              <Text style={styles.folderBtnText}>🔔</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenGraph ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenGraph}>
              <Text style={styles.folderBtnText}>🕸</Text>
            </TouchableOpacity>
          ) : null}
          {onOpenAi ? (
            <TouchableOpacity style={styles.folderBtn} onPress={onOpenAi}>
              <Text style={styles.folderBtnText}>✨</Text>
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
        {search.length > 0 ? (
          <TouchableOpacity style={styles.searchClear} onPress={() => setSearch('')} hitSlop={{ left: 8, top: 8, bottom: 8, right: 8 }}>
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        ) : null}
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
          <NoteCard note={item} locale={locale} onPress={onOpenNote} onTagPress={onTagPress} onLongPress={showNoteMenu} drawingContent={drawings[item.id]} />
        )}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderBody}
        contentContainerStyle={styles.listContent}
        windowSize={11}
        maxToRenderPerBatch={10}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />
        }
      />
      {onCreateDrawing ? (
        <TouchableOpacity style={[styles.fabDraw, shadow]} onPress={onCreateDrawing} activeOpacity={0.85}>
          <Text style={styles.fabDrawText}>🎨</Text>
        </TouchableOpacity>
      ) : null}
      <Modal visible={menuNote != null} transparent animationType="fade" onRequestClose={() => setMenuNote(null)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuNote(null)}>
          <View style={[styles.menuSheet, shadow]}>
            <Text style={[styles.menuTitle, { color: colors.text }]} numberOfLines={1}>{menuNote?.heading}</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => menuAction('pin')}>
              <Text style={styles.menuItemText}>📌 {menuNote?.pinned ? t('menu.unpin') : t('menu.pin')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => menuAction('duplicate')}>
              <Text style={styles.menuItemText}>⧉ {t('menu.duplicate')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.menuItemLast]} onPress={() => menuAction('share')}>
              <Text style={styles.menuItemText}>🔗 {t('menu.shareLink')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      <TouchableOpacity style={[styles.fab, shadow]} onPress={onCreateNote} activeOpacity={0.85}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: spacing.xxl },
  menuTitle: { ...type.h2, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuItem: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemText: { ...type.body, fontSize: 16 },
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
  searchWrap: { marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center' },
  searchClear: { position: 'absolute', right: spacing.md, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  searchClearText: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginTop: -1 },
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
  fabDraw: {
    position: 'absolute', right: spacing.xl, bottom: spacing.xl + 72,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  fabDrawText: { fontSize: 20 },
  fabText: { color: '#fff', fontSize: 30, marginTop: -2 },
});

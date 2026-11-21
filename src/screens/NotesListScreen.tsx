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
import { pendingDeleteIds, enqueueWrite } from '../api/offlineQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readDrawingCache, writeDrawingCache } from '../api/drawCache';
import { isDrawingContent } from '../components/DrawingEditor';
import FolderPickerSheet from '../components/FolderPickerSheet';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onCreateNote: () => void;
  onCreateDrawing?: () => void;
  folderId?: number;
  workspace?: string;
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

export default function NotesListScreen({ client, onOpenNote, onCreateNote, onCreateDrawing, folderId, workspace, title, onBack, onOpenFolders, onOpenTrash, onOpenSettings, onOpenAi, onOpenTasks, onOpenTags, onOpenReminders, onOpenGraph, tag, onTagPress, refreshKey }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  // Seitenweises Laden (P1-14): erste Seite beim Start, weitere beim Scrollen
  const PAGE_SIZE = 100;
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const offsetRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavorites, setShowFavorites] = useState(false);
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title'>('updated');
  // Sortierung und Favoriten-Filter über Sitzungen hinweg merken
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('pozume.list.prefs');
        if (!raw) return;
        const prefs = JSON.parse(raw);
        if (prefs.sortBy === 'updated' || prefs.sortBy === 'created' || prefs.sortBy === 'title') setSortBy(prefs.sortBy);
        if (typeof prefs.showFavorites === 'boolean') setShowFavorites(prefs.showFavorites);
      } catch {}
    })();
  }, []);
  const savePrefs = (next: { sortBy?: typeof sortBy; showFavorites?: boolean }) => {
    AsyncStorage.setItem('pozume.list.prefs', JSON.stringify({ sortBy, showFavorites, ...next })).catch(() => {});
  };
  const [menuNote, setMenuNote] = useState<Note | null>(null);
  // Multi-Select: null = normaler Modus, sonst Menge der ausgewählten Notiz-IDs
  const [selection, setSelection] = useState<Set<number> | null>(null);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  // Zeichnungsinhalte für Karten-Vorschauen (noteId -> Inhalt), aus Cache + Hintergrund-Nachladen
  const [drawings, setDrawings] = useState<Record<number, string>>({});

  const showNoteMenu = useCallback((n: Note) => setMenuNote(n), []);

  const menuAction = async (action: 'pin' | 'duplicate' | 'share' | 'select') => {
    const n = menuNote;
    setMenuNote(null);
    if (!n) return;
    if (action === 'select') {
      setSelection(new Set([n.id]));
      return;
    }
    if (action === 'share') {
      // Vor der Freigabe erklären, was der öffentliche Link bedeutet
      // (anlehnen an den Bestätigungsdialog im Editor)
      Alert.alert(t('list.shareConfirmTitle'), t('list.shareConfirmText'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('list.shareCreate'),
          onPress: async () => {
            try {
              const res = await client.shareNote(n.id);
              const url = (res as any).share_url ?? (res as any).url;
              if (url) {
                await Share.share({ title: n.heading, message: url });
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e: any) {
              Alert.alert(t('common.error'), e?.message ?? String(e));
            }
          },
        },
      ]);
      return;
    }
    try {
      if (action === 'pin') {
        await client.setPinned(n.id, !n.pinned);
        load({ silent: true });
      } else if (action === 'duplicate') {
        await client.duplicateNote(n.id);
        load({ silent: true });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };
  const locale = getLocale();

  // Sequenz-Schutz für load(): überlappende Aufrufe können sonst eine alte
  // Antwort die neuere überschreiben lassen — nur die jüngste Anfrage gewinnt
  const loadSeqRef = useRef(0);
  // true, solange die Liste Server-Suchergebnisse zeigt (der Suche-Effekt hat
  // die Basisliste ersetzt) — dann darf loadMore keine Basisseite anhängen
  const usedServerSearch = useRef(false);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const seq = ++loadSeqRef.current;
    if (!opts.silent) setLoading(true);
    setError(null);
    // Offline gelöschte Notizen ausblenden, bis der Server die Löschung übernommen hat
    const hiddenDeletes = new Set(await pendingDeleteIds().catch(() => [] as number[]));
    try {
      const res = await client.listNotes({
        ...(folderId != null ? { folder_id: folderId } : {}),
        ...(workspace ? { workspace } : {}),
        ...(tag ? { tags: tag } : {}),
        limit: PAGE_SIZE, offset: 0,
      });
      if (seq !== loadSeqRef.current) return; // veraltete Antwort verwerfen
      const rawCount = (res.notes ?? []).length;
      let list = res.notes ?? [];
      // Der Server ignoriert den tags-Parameter je nach Version — deshalb zusätzlich lokal filtern
      if (tag) {
        const wanted = tag.toLowerCase();
        list = list.filter((n) =>
          (n.tags ?? '').split(',').map((s) => s.trim().toLowerCase()).includes(wanted));
      }
      if (hiddenDeletes.size > 0) list = list.filter((n) => !hiddenDeletes.has(n.id));
      setNotes(list);
      offsetRef.current = rawCount;
      setHasMore(res.total != null ? rawCount < res.total : rawCount >= PAGE_SIZE);
      // Nur die ungefilterte Gesamtliste cachen — Teilmenge würden beim nächsten Boot
      // fälschlich als "alle Notizen" erscheinen.
      if (folderId == null && !tag && !workspace) cacheNotes(list).catch(() => {});
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return; // veraltete Antwort verwerfen
      // Offline: Cache zeigen statt harter Fehler
      const cached = await readCachedNotes<Note[]>();
      if (cached && cached.length > 0) {
        setNotes(hiddenDeletes.size > 0 ? cached.filter((n) => !hiddenDeletes.has(n.id)) : cached);
      } else {
        setError(e?.message ?? String(e));
      }
    } finally {
      // Nur die jüngste Anfrage darf die Lade-States zurücksetzen
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [client, folderId, workspace, tag]);

  /** Naechste Seite nachladen (beim Scrollen ans Listenende) */
  const loadMore = useCallback(async () => {
    // Aktive Server-Suche: die Liste zeigt Suchergebnisse — eine angehängte
    // ungefilterte Basisseite würde sie verfälschen
    if (usedServerSearch.current) return;
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const res = await client.listNotes({
        ...(folderId != null ? { folder_id: folderId } : {}),
        ...(workspace ? { workspace } : {}),
        ...(tag ? { tags: tag } : {}),
        limit: PAGE_SIZE, offset: offsetRef.current,
      });
      const rawCount = (res.notes ?? []).length;
      let page = res.notes ?? [];
      if (tag) {
        const wanted = tag.toLowerCase();
        page = page.filter((n) =>
          (n.tags ?? '').split(',').map((s) => s.trim().toLowerCase()).includes(wanted));
      }
      const hidden = new Set(await pendingDeleteIds().catch(() => [] as number[]));
      if (hidden.size > 0) page = page.filter((n) => !hidden.has(n.id));
      setNotes((prev) => [...prev, ...page]);
      offsetRef.current += rawCount;
      setHasMore(res.total != null ? offsetRef.current < res.total : rawCount >= PAGE_SIZE);
    } catch {
      // Offline: einfach beim naechsten Versuch weitermachen
    } finally {
      setLoadingMore(false);
    }
  }, [client, folderId, workspace, tag, loadingMore, hasMore, loading]);

  // Boot: sofort Cache zeigen, dann live aktualisieren
  useEffect(() => {
    if (folderId == null) {
      (async () => {
        const cached = await readCachedNotes<Note[]>();
        if (!cached || cached.length === 0) return;
        const hidden = new Set(await pendingDeleteIds().catch(() => [] as number[]));
        setNotes(hidden.size > 0 ? cached.filter((n) => !hidden.has(n.id)) : cached);
      })();
    }
  }, [folderId]);

  // Such-Debounce: Input sofort, Filter mit 300ms Verzoegerung
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  // Server-Volltextsuche ab 3 Zeichen (findet auch Inhalte, die nicht geladen sind);
  // darunter lokales Filtern der geladenen Liste — ehrlich nur nach Titel und Tags,
  // da Listen-Notizen keinen Inhalt mitliefern (n.content ist in der Liste nie gefüllt).
  // Veraltete Anfragen werden abgebrochen, sobald eine neuere Suche startet.
  const searchAbort = useRef<AbortController | null>(null);
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
    if (folderId != null || tag || workspace != null) return;
    let cancelled = false;
    usedServerSearch.current = true;
    searchAbort.current?.abort();
    const ctrl = new AbortController();
    searchAbort.current = ctrl;
    setLoading(true);
    client.searchNotes(q, { limit: 50, signal: ctrl.signal })
      .then((res) => { if (!cancelled) setNotes(res.notes ?? []); })
      .catch(() => { if (!cancelled && !ctrl.signal.aborted) load({ silent: true }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [searchQuery, client, folderId, workspace, tag, load]);

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

  const toggleSelect = useCallback((id: number) => {
    setSelection((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Stabile Callbacks für NoteCard: inline-Pfeile im renderItem würden
  // React.memo der Karten bei jedem Listen-Render wirkungslos machen
  const handleCardPress = useCallback((n: Note) => {
    if (selection != null) toggleSelect(n.id);
    else onOpenNote(n);
  }, [selection, onOpenNote, toggleSelect]);

  const bulkPin = async () => {
    if (!selection) return;
    try {
      await Promise.all([...selection].map((id) => client.setPinned(id, true)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelection(null);
      load({ silent: true });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    }
  };

  const bulkMove = async (targetId: number | null) => {
    setShowMoveSheet(false);
    if (!selection) return;
    // Verschiebungen einzeln abarbeiten: Offline-Fehler betreffen nur die
    // betroffene Notiz — der Rest wird normal verschoben statt abzubrechen
    // (P1-9: Ordnerwechsel müssen auch offline zuverlässig funktionieren)
    let queuedMoves = 0;
    let firstError: any = null;
    for (const id of [...selection]) {
      try {
        await client.moveNote(id, targetId);
      } catch (e: any) {
        if (e?.status === 0) {
          // Offline: Verschiebung dauerhaft einreihen — der Server übernimmt
          // sie bei der nächsten Verbindung
          await enqueueWrite({
            key: `move-${id}`,
            kind: 'move',
            noteId: id,
            body: { heading: '', content: '', tags: '' },
            folderId: targetId,
          });
          queuedMoves++;
        } else if (!firstError) {
          firstError = e;
        }
      }
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelection(null);
    load({ silent: true });
    if (queuedMoves > 0) {
      Alert.alert('🪶', t('editor.moveQueued'));
    } else if (firstError) {
      Alert.alert(t('common.error'), firstError?.message ?? String(firstError));
    }
  };

  const bulkDelete = () => {
    if (!selection || selection.size === 0) return;
    Alert.alert(t('select.deleteTitle'), t('select.deleteText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          // Löschungen einzeln abarbeiten: Offline-Fehler betreffen nur die
          // betroffene Notiz — der Rest wird normal gelöscht statt komplett
          // abzubrechen (P1-7: auch Löschungen aus der Liste müssen offline
          // zuverlässig funktionieren, nicht nur aus dem Editor heraus)
          let queuedDeletes = 0;
          let firstError: any = null;
          for (const id of [...selection]) {
            try {
              await client.deleteNote(id);
            } catch (e: any) {
              if (e?.status === 0) {
                // Offline: Löschung dauerhaft einreihen und lokal ausblenden —
                // der Server übernimmt sie bei der nächsten Verbindung
                await enqueueWrite({
                  key: `delete-${id}`,
                  kind: 'delete',
                  noteId: id,
                  body: { heading: '', content: '', tags: '' },
                });
                queuedDeletes++;
              } else if (!firstError) {
                firstError = e;
              }
            }
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setSelection(null);
          load({ silent: true });
          if (queuedDeletes > 0) {
            Alert.alert('🪶', t('editor.deleteQueued'));
          } else if (firstError) {
            Alert.alert(t('common.error'), firstError?.message ?? String(firstError));
          }
        },
      },
    ]);
  };

  const visible = useMemo(() => {
    let out = notes;
    if (showFavorites) out = out.filter((n) => n.favorite);
    const q = searchQuery.trim().toLowerCase();
    if (q && q.length < 3) {
      // Lokale Suche: Listen-Notizen haben keinen Inhalt — ehrlich nur
      // Titel und Tags durchsuchen (Inhalte findet erst die Server-Suche)
      out = out.filter((n) =>
        (n.heading ?? '').toLowerCase().includes(q) ||
        (n.tags ?? '').toLowerCase().includes(q));
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
          onPress={() => { setShowFavorites(false); savePrefs({ showFavorites: false }); }}>
          <Text style={[styles.chipText, !showFavorites && styles.chipTextActive]}>{t('list.allNotes')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, showFavorites && styles.chipActive]}
          onPress={() => { setShowFavorites(true); savePrefs({ showFavorites: true }); }}>
          <Text style={[styles.chipText, showFavorites && styles.chipTextActive]}>★ {t('list.favorites')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, sortBy === 'title' && styles.chipActive]}
          onPress={() => setSortBy((v) => { const n = v === 'title' ? 'updated' : 'title'; savePrefs({ sortBy: n }); return n; })}>
          <Text style={[styles.chipText, sortBy === 'title' && styles.chipTextActive]}>A–Z</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, sortBy === 'created' && styles.chipActive]}
          onPress={() => setSortBy((v) => { const n = v === 'created' ? 'updated' : 'created'; savePrefs({ sortBy: n }); return n; })}>
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
          <NoteCard
            note={item}
            locale={locale}
            onPress={handleCardPress}
            onTagPress={onTagPress}
            onLongPress={showNoteMenu}
            drawingContent={drawings[item.id]}
            selectMode={selection != null}
            selected={selection?.has(item.id) ?? false}
          />
        )}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderBody}
        ListFooterComponent={loadingMore ? (
          <Text style={styles.loadingMore}>{t('list.loadingMore')}</Text>
        ) : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={styles.listContent}
        windowSize={11}
        maxToRenderPerBatch={10}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load({ silent: true }); }} />
        }
      />
      {selection != null && (
        <View style={[styles.selectBar, shadow]}>
          <Text style={styles.selectCount}>{t('select.count', { n: selection.size })}</Text>
          <TouchableOpacity style={styles.selectBtn} onPress={bulkPin}>
            <Text style={styles.selectBtnText}>📌 {t('select.pin')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setShowMoveSheet(true)}>
            <Text style={styles.selectBtnText}>📁 {t('select.move')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.selectBtn, styles.selectBtnDanger]} onPress={bulkDelete}>
            <Text style={[styles.selectBtnText, { color: colors.danger }]}>🗑</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.selectBtn} onPress={() => setSelection(null)}>
            <Text style={styles.selectBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      <FolderPickerSheet
        visible={showMoveSheet}
        client={client}
        currentFolderId={null}
        onSelect={bulkMove}
        onClose={() => setShowMoveSheet(false)}
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
            <TouchableOpacity style={styles.menuItem} onPress={() => menuAction('share')}>
              <Text style={styles.menuItemText}>🔗 {t('menu.shareLink')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, styles.menuItemLast]} onPress={() => menuAction('select')}>
              <Text style={styles.menuItemText}>☑️ {t('menu.select')}</Text>
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
  loadingMore: { ...type.faint(), textAlign: 'center', paddingVertical: spacing.md },
  selectBar: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  selectCount: { fontSize: 13, fontWeight: '700', color: colors.text, flex: 1 },
  selectBtn: { paddingVertical: 6, paddingHorizontal: spacing.sm },
  selectBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  selectBtnDanger: {},
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

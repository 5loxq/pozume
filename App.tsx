import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, useWindowDimensions, AppState, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './src/screens/LoginScreen';
import NotesListScreen from './src/screens/NotesListScreen';
import NoteEditorScreen from './src/screens/NoteEditorScreen';
import FoldersScreen from './src/screens/FoldersScreen';
import TrashScreen from './src/screens/TrashScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AiScreen from './src/screens/AiScreen';
import TasksScreen from './src/screens/TasksScreen';
import LockScreen from './src/screens/LockScreen';
import TagsScreen from './src/screens/TagsScreen';
import VersionsScreen from './src/screens/VersionsScreen';
import RemindersScreen from './src/screens/RemindersScreen';
import GraphScreen from './src/screens/GraphScreen';
import KanbanScreen from './src/screens/KanbanScreen';
import { PoznoteClient, type Note } from './src/api';
import { loadServer, getAppLock, saveServer } from './src/api/store';
import { flushQueue, queueSize } from './src/api/offlineQueue';
import { loadLocaleOverride, onLocaleChange, t } from './src/i18n';
import { usePalette, loadThemeOverride, onThemeChange } from './src/theme';

type Route =
  | { name: 'list' }
  | { name: 'editor'; note: Note | null; drawing?: boolean }
  | { name: 'folders' }
  | { name: 'folderNotes'; folderId: number; folderName: string }
  | { name: 'trash' }
  | { name: 'settings' }
  | { name: 'tagNotes'; tag: string }
  | { name: 'tags' }
  | { name: 'versions'; noteId: number }
  | { name: 'reminders' }
  | { name: 'graph' }
  | { name: 'kanban'; folderId: number; folderName: string }
  | { name: 'archive' }
  | { name: 'ai' }
  | { name: 'tasks' };

function AppInner() {
  const palette = usePalette();
  const [client, setClient] = useState<PoznoteClient | null>(null);
  const [booting, setBooting] = useState(true);
  const [locked, setLocked] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'list' });
  const [, forceRender] = useState(0);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  // Zähler für "Daten wurden geändert" — NotesListScreen lädt bei Erhöhung neu
  const [dataVersion, setDataVersion] = useState(0);
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  // Boot: Zugangsdaten + App-Lock + Sprach-Override laden
  useEffect(() => {
    (async () => {
      try {
        const stored = await loadServer();
        if (stored) {
          const c = new PoznoteClient(stored);
          setClient(c);
          setLocked(await getAppLock());
          c.listNotes().then((r) => setAllNotes(r.notes ?? [])).catch(() => {});
        }
        await loadLocaleOverride();
        await loadThemeOverride();
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Bei Sprachwechsel alles neu rendern
  useEffect(() => onLocaleChange(() => forceRender((n) => n + 1)), []);

  // Bei Theme-Wechsel alles neu rendern
  useEffect(() => onThemeChange(() => forceRender((n) => n + 1)), []);

  const onConnected = useCallback((c: PoznoteClient) => {
    setClient(c);
    saveServer(c.cfg).catch(() => {});
    c.listNotes().then((r) => setAllNotes(r.notes ?? [])).catch(() => {});
  }, []);

  const openNote = useCallback((note: Note) => setRoute({ name: 'editor', note }), []);
  const createNote = useCallback(() => setRoute({ name: 'editor', note: null }), []);
  const createDrawing = useCallback(() => setRoute({ name: 'editor', note: null, drawing: true }), []);
  const closeEditor = useCallback(() => setRoute({ name: 'list' }), []);
  // Nach jedem Speichern/Löschen: Listen und KI-Kontext aktualisieren
  const onSaved = useCallback(() => {
    setDataVersion((v) => v + 1);
    client?.listNotes().then((r) => setAllNotes(r.notes ?? [])).catch(() => {});
  }, [client]);
  const onDeleted = useCallback(() => {
    setDataVersion((v) => v + 1);
    setRoute({ name: 'list' });
  }, []);

  const onLockToggle = useCallback((enabled: boolean) => {
    // Aktivieren sperrt die App erst beim nächsten Start; Deaktivieren entsperrt sofort.
    if (!enabled) setLocked(false);
  }, []);

  // Offline-Queue: beim Start und bei Rückkehr in den Vordergrund abarbeiten
  const flushOffline = useCallback(async () => {
    if (!client) return;
    try {
      if ((await queueSize()) === 0) return;
      const res = await flushQueue(client);
      if (res.flushed > 0) {
        setDataVersion((v) => v + 1);
        client.listNotes().then((r) => setAllNotes(r.notes ?? [])).catch(() => {});
        Alert.alert('🪶', t('offline.flushed', { n: res.flushed }));
      }
    } catch {}
  }, [client]);

  useEffect(() => { flushOffline(); }, [flushOffline]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushOffline();
    });
    return () => sub.remove();
  }, [flushOffline]);

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg }}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  if (!client) {
    return (
      <>
        <StatusBar style="auto" />
        <LoginScreen onConnected={onConnected} />
      </>
    );
  }

  if (locked) {
    return (
      <>
        <StatusBar style="auto" />
        <LockScreen onUnlocked={() => setLocked(false)} />
      </>
    );
  }

  if (route.name === 'editor' && isWide) {
    return (
      <>
        <StatusBar style="auto" />
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.bg }}>
          <View style={{ width: '42%', borderRightWidth: 1, borderRightColor: palette.border }}>
            <NotesListScreen client={client} onOpenNote={openNote} onCreateNote={createNote}
              onCreateDrawing={createDrawing}
              onOpenFolders={() => setRoute({ name: 'folders' })}
              onOpenTrash={() => setRoute({ name: 'trash' })}
              onOpenSettings={() => setRoute({ name: 'settings' })}
              onOpenAi={() => setRoute({ name: 'ai' })}
              onOpenTasks={() => setRoute({ name: 'tasks' })}
              onOpenTags={() => setRoute({ name: 'tags' })}
              onOpenReminders={() => setRoute({ name: 'reminders' })}
              onOpenGraph={() => setRoute({ name: 'graph' })}
              onTagPress={(tag) => setRoute({ name: 'tagNotes', tag })}
              refreshKey={dataVersion} />
          </View>
          <View style={{ flex: 1 }}>
            <NoteEditorScreen key={route.note?.id ?? 'new'}
              client={client}
              note={route.note}
              drawing={route.drawing}
              onClose={closeEditor}
              onSaved={onSaved}
              onDeleted={onDeleted}
              onOpenNote={openNote}
              onOpenVersions={(id) => setRoute({ name: 'versions', noteId: id })}
            />
          </View>
        </View>
      </>
    );
  }

  if (route.name === 'editor') {
    return (
      <>
        <StatusBar style="auto" />
        <NoteEditorScreen key={route.note?.id ?? 'new'}
          client={client}
          note={route.note}
          drawing={route.drawing}
          onClose={closeEditor}
          onSaved={onSaved}
          onDeleted={onDeleted}
          onOpenNote={openNote}
          onOpenVersions={(id) => setRoute({ name: 'versions', noteId: id })}
        />
      </>
    );
  }

  if (route.name === 'versions') {
    return (
      <>
        <StatusBar style="auto" />
        <VersionsScreen client={client} noteId={route.noteId} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'reminders') {
    return (
      <>
        <StatusBar style="auto" />
        <RemindersScreen client={client} onOpenNote={openNote} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'graph') {
    return (
      <>
        <StatusBar style="auto" />
        <GraphScreen client={client} onOpenNote={openNote} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'kanban') {
    return (
      <>
        <StatusBar style="auto" />
        <KanbanScreen client={client} folderId={route.folderId} folderName={route.folderName}
          onOpenNote={openNote} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'archive') {
    return (
      <>
        <StatusBar style="auto" />
        <NotesListScreen
          client={client}
          workspace="Archives"
          title={t('archive.title')}
          onOpenNote={openNote}
          onCreateNote={createNote}
          onBack={() => setRoute({ name: 'list' })}
          refreshKey={dataVersion}
        />
      </>
    );
  }

  if (route.name === 'tags') {
    return (
      <>
        <StatusBar style="auto" />
        <TagsScreen client={client} onBack={() => setRoute({ name: 'list' })} onOpenTag={(tag) => setRoute({ name: 'tagNotes', tag })} />
      </>
    );
  }

  if (route.name === 'tasks') {
    return (
      <>
        <StatusBar style="auto" />
        <TasksScreen client={client} onOpenNote={openNote} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'ai') {
    return (
      <>
        <StatusBar style="auto" />
        <AiScreen client={client} notes={allNotes} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'settings') {
    return (
      <>
        <StatusBar style="auto" />
        <SettingsScreen
          client={client}
          onLockChange={onLockToggle}
          onLocaleChange={() => {}}
          onLoggedOut={() => { setClient(null); setRoute({ name: 'list' }); }}
          onOpenArchive={() => setRoute({ name: 'archive' })}
          onBack={() => setRoute({ name: 'list' })}
        />
      </>
    );
  }

  if (route.name === 'tagNotes') {
    return (
      <>
        <StatusBar style="auto" />
        <NotesListScreen
          client={client}
          tag={route.tag}
          title={`#${route.tag}`}
          onOpenNote={openNote}
          onCreateNote={createNote}
          onBack={() => setRoute({ name: 'list' })}
          refreshKey={dataVersion}
        />
      </>
    );
  }

  if (route.name === 'trash') {
    return (
      <>
        <StatusBar style="auto" />
        <TrashScreen client={client} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'folders') {
    return (
      <>
        <StatusBar style="auto" />
        <FoldersScreen
          client={client}
          onOpenFolder={(f) => setRoute({ name: 'folderNotes', folderId: f.id, folderName: f.name })}
          onOpenKanban={(f) => setRoute({ name: 'kanban', folderId: f.id, folderName: f.name })}
          onBack={() => setRoute({ name: 'list' })}
        />
      </>
    );
  }

  if (route.name === 'folderNotes') {
    return (
      <>
        <StatusBar style="auto" />
        <NotesListScreen
          client={client}
          folderId={route.folderId}
          title={route.folderName}
          onOpenNote={openNote}
          onCreateNote={createNote}
          onBack={() => setRoute({ name: 'folders' })}
          refreshKey={dataVersion}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <NotesListScreen client={client} onOpenNote={openNote} onCreateNote={createNote}
        onCreateDrawing={createDrawing}
        onOpenFolders={() => setRoute({ name: 'folders' })}
        onOpenTrash={() => setRoute({ name: 'trash' })}
        onOpenSettings={() => setRoute({ name: 'settings' })}
        onTagPress={(tag) => setRoute({ name: 'tagNotes', tag })}
        onOpenAi={() => setRoute({ name: 'ai' })}
        onOpenTasks={() => setRoute({ name: 'tasks' })}
        onOpenTags={() => setRoute({ name: 'tags' })}
        onOpenReminders={() => setRoute({ name: 'reminders' })}
        onOpenGraph={() => setRoute({ name: 'graph' })}
        refreshKey={dataVersion} />
    </>
  );
}

/** SafeAreaProvider ist Pflicht, damit die SafeAreaView-Instanzen der Screens Insets liefern */
export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

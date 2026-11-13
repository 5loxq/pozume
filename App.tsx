import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, useWindowDimensions } from 'react-native';
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
import { PoznoteClient, type Note } from './src/api';
import { loadServer, getAppLock } from './src/api/store';
import { loadLocaleOverride, onLocaleChange } from './src/i18n';
import { usePalette, loadThemeOverride, onThemeChange } from './src/theme';

type Route =
  | { name: 'list' }
  | { name: 'editor'; note: Note | null }
  | { name: 'folders' }
  | { name: 'folderNotes'; folderId: number; folderName: string }
  | { name: 'trash' }
  | { name: 'settings' }
  | { name: 'tagNotes'; tag: string }
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
    import('./src/api/store').then((m) => m.saveServer(c.cfg)).catch(() => {});
    c.listNotes().then((r) => setAllNotes(r.notes ?? [])).catch(() => {});
  }, []);

  const openNote = useCallback((note: Note) => setRoute({ name: 'editor', note }), []);
  const createNote = useCallback(() => setRoute({ name: 'editor', note: null }), []);
  const closeEditor = useCallback(() => setRoute({ name: 'list' }), []);
  const onDeleted = useCallback(() => setRoute({ name: 'list' }), []);

  const onLockToggle = useCallback((enabled: boolean) => {
    // App-Lock-Status in store persistiert die Settings selbst; hier nur Cache aktualisieren
    import('./src/api/store').then((m) => m.getAppLock()).then(setLocked).catch(() => {});
    if (!enabled) setLocked(false);
  }, []);

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
              onOpenFolders={() => setRoute({ name: 'folders' })}
              onOpenTrash={() => setRoute({ name: 'trash' })}
              onOpenSettings={() => setRoute({ name: 'settings' })}
              onOpenAi={() => setRoute({ name: 'ai' })}
              onOpenTasks={() => setRoute({ name: 'tasks' })}
              onTagPress={(tag) => setRoute({ name: 'tagNotes', tag })} />
          </View>
          <View style={{ flex: 1 }}>
            <NoteEditorScreen
              client={client}
              note={route.note}
              onClose={closeEditor}
              onSaved={() => {}}
              onDeleted={onDeleted}
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
        <NoteEditorScreen
          client={client}
          note={route.note}
          onClose={closeEditor}
          onSaved={() => {}}
          onDeleted={onDeleted}
        />
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
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <NotesListScreen client={client} onOpenNote={openNote} onCreateNote={createNote}
        onOpenFolders={() => setRoute({ name: 'folders' })}
        onOpenTrash={() => setRoute({ name: 'trash' })}
        onOpenSettings={() => setRoute({ name: 'settings' })}
        onTagPress={(tag) => setRoute({ name: 'tagNotes', tag })}
        onOpenAi={() => setRoute({ name: 'ai' })}
        onOpenTasks={() => setRoute({ name: 'tasks' })} />
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

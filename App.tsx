import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import NotesListScreen from './src/screens/NotesListScreen';
import NoteEditorScreen from './src/screens/NoteEditorScreen';
import FoldersScreen from './src/screens/FoldersScreen';
import TrashScreen from './src/screens/TrashScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AiScreen from './src/screens/AiScreen';
import LockScreen from './src/screens/LockScreen';
import { PoznoteClient, type Note } from './src/api';
import { loadServer, getAppLock } from './src/api/store';
import { loadLocaleOverride, onLocaleChange } from './src/i18n';
import { colors } from './src/theme';

type Route =
  | { name: 'list' }
  | { name: 'editor'; note: Note | null }
  | { name: 'folders' }
  | { name: 'folderNotes'; folderId: number; folderName: string }
  | { name: 'trash' }
  | { name: 'settings' }
  | { name: 'tagNotes'; tag: string }
  | { name: 'ai' };

export default function App() {
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
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Bei Sprachwechsel alles neu rendern
  useEffect(() => onLocaleChange(() => forceRender((n) => n + 1)), []);

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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!client) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen onConnected={onConnected} />
      </>
    );
  }

  if (locked) {
    return (
      <>
        <StatusBar style="dark" />
        <LockScreen onUnlocked={() => setLocked(false)} />
      </>
    );
  }

  if (route.name === 'editor' && isWide) {
    return (
      <>
        <StatusBar style="dark" />
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
          <View style={{ width: '42%', borderRightWidth: 1, borderRightColor: colors.border }}>
            <NotesListScreen client={client} onOpenNote={openNote} onCreateNote={createNote}
              onOpenFolders={() => setRoute({ name: 'folders' })}
              onOpenTrash={() => setRoute({ name: 'trash' })}
              onOpenSettings={() => setRoute({ name: 'settings' })}
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
        <StatusBar style="dark" />
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

  if (route.name === 'ai') {
    return (
      <>
        <StatusBar style="dark" />
        <AiScreen client={client} notes={allNotes} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'settings') {
    return (
      <>
        <StatusBar style="dark" />
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
        <StatusBar style="dark" />
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
        <StatusBar style="dark" />
        <TrashScreen client={client} onBack={() => setRoute({ name: 'list' })} />
      </>
    );
  }

  if (route.name === 'folders') {
    return (
      <>
        <StatusBar style="dark" />
        <FoldersScreen
          client={client}
          onOpenFolder={(f) => setRoute({ name: 'folderNotes', folderId: f.id, folderName: f.name })}
        />
      </>
    );
  }

  if (route.name === 'folderNotes') {
    return (
      <>
        <StatusBar style="dark" />
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
      <StatusBar style="dark" />
      <NotesListScreen client={client} onOpenNote={openNote} onCreateNote={createNote}
        onOpenFolders={() => setRoute({ name: 'folders' })}
        onOpenTrash={() => setRoute({ name: 'trash' })}
        onOpenSettings={() => setRoute({ name: 'settings' })}
        onTagPress={(tag) => setRoute({ name: 'tagNotes', tag })}
        onOpenAi={() => setRoute({ name: 'ai' })} />
    </>
  );
}

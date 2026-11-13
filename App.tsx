import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import NotesListScreen from './src/screens/NotesListScreen';
import NoteEditorScreen from './src/screens/NoteEditorScreen';
import FoldersScreen from './src/screens/FoldersScreen';
import TrashScreen from './src/screens/TrashScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import LockScreen from './src/screens/LockScreen';
import { PoznoteClient, type Note } from './src/api';
import { loadServer, getAppLock } from './src/api/store';
import { colors } from './src/theme';

type Route =
  | { name: 'list' }
  | { name: 'editor'; note: Note | null }
  | { name: 'folders' }
  | { name: 'folderNotes'; folderId: number; folderName: string }
  | { name: 'trash' }
  | { name: 'settings' }
  | { name: 'tagNotes'; tag: string };

export default function App() {
  const [client, setClient] = useState<PoznoteClient | null>(null);
  const [booting, setBooting] = useState(true);
  const [locked, setLocked] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'list' });

  // Boot: gespeicherte Zugangsdaten laden, App-Lock pruefen
  useEffect(() => {
    (async () => {
      try {
        const stored = await loadServer();
        if (stored) {
          setClient(new PoznoteClient(stored));
          setLocked(await getAppLock());
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const onConnected = useCallback((c: PoznoteClient) => {
    setClient(c);
    import('./src/api/store').then((m) => m.saveServer(c.cfg)).catch(() => {});
  }, []);

  const openNote = useCallback((note: Note) => setRoute({ name: 'editor', note }), []);
  const createNote = useCallback(() => setRoute({ name: 'editor', note: null }), []);
  const closeEditor = useCallback(() => setRoute({ name: 'list' }), []);
  const onDeleted = useCallback(() => setRoute({ name: 'list' }), []);

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

  if (route.name === 'settings') {
    return (
      <>
        <StatusBar style="dark" />
        <SettingsScreen
          client={client}
          onLockChange={() => {}}
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
        onTagPress={(tag) => setRoute({ name: 'tagNotes', tag })} />
    </>
  );
}

import React, { useCallback, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import NotesListScreen from './src/screens/NotesListScreen';
import NoteEditorScreen from './src/screens/NoteEditorScreen';
import type { PoznoteClient, Note } from './src/api';

type Route = { name: 'list' } | { name: 'editor'; note: Note | null };

export default function App() {
  const [client, setClient] = useState<PoznoteClient | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'list' });

  const openNote = useCallback((note: Note) => setRoute({ name: 'editor', note }), []);
  const createNote = useCallback(() => setRoute({ name: 'editor', note: null }), []);
  const closeEditor = useCallback(() => setRoute({ name: 'list' }), []);

  const onSaved = useCallback((_note: Note) => {}, []);

  const onDeleted = useCallback((_id: number) => {
    setRoute({ name: 'list' });
  }, []);

  if (!client) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen onConnected={setClient} />
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
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <NotesListScreen client={client} onOpenNote={openNote} onCreateNote={createNote} />
    </>
  );
}

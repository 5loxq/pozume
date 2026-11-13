import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { t } from '../i18n';
import { PoznoteClient } from '../api';

export default function LoginScreen({ onConnected }: { onConnected: (c: any) => void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      const base = serverUrl.replace(/\/+$/, '');
      const client = new PoznoteClient({ baseUrl: base, username, password });
      const res = await client.listNotes();
      onConnected(client);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('login.title')}</Text>
      <Text style={styles.subtitle}>{t('login.subtitle')}</Text>
      <TextInput style={styles.input} placeholder={t('login.serverUrl')}
        autoCapitalize="none" keyboardType="url" value={serverUrl} onChangeText={setServerUrl} />
      <TextInput style={styles.input} placeholder={t('login.username')}
        autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder={t('login.password')} secureTextEntry
        value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={connect} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('login.connect')}</Text>}
      </TouchableOpacity>
      <Text style={styles.hint}>{t('login.hint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#2563eb', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#dc2626', marginBottom: 8, fontSize: 14 },
  hint: { color: '#999', fontSize: 13, textAlign: 'center', marginTop: 16 },
});

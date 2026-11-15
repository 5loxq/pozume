import React, {useState, useMemo} from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette, spacing, radius, typeFor, shadowSoft, primaryButton,
  Palette,
} from '../theme';
import { t } from '../i18n';
import { PoznoteClient } from '../api';
import { saveServer } from '../api/store';

export default function LoginScreen({ onConnected }: { onConnected: (c: any) => void }) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true); setError(null);
    try {
      let base = serverUrl.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
      const client = new PoznoteClient({ baseUrl: base, username, password });
      await client.listNotes();
      await saveServer({ baseUrl: base, username, password }).catch(() => {});
      onConnected(client);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      setError(msg.includes('network') || msg.includes('Network request failed')
        ? 'Server nicht erreichbar — Adresse und Verbindung prüfen.'
        : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.hero}>
          <View style={styles.blobOne} />
          <View style={styles.blobTwo} />
          <Text style={styles.owl}>🪶</Text>
          <Text style={styles.title}>Pozume</Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>
        </View>
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={t('login.serverUrl')}
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" value={serverUrl} onChangeText={setServerUrl} />
          <TextInput style={styles.input} placeholder={t('login.username')}
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
          <TextInput style={styles.input} placeholder={t('login.password')} secureTextEntry
            placeholderTextColor={colors.textFaint}
            value={password} onChangeText={setPassword} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity style={[styles.button, busy && styles.buttonBusy]} onPress={connect} disabled={busy} activeOpacity={0.8}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t('login.connect')}</Text>}
          </TouchableOpacity>
          <Text style={styles.hint}>🪶 {t('login.hint')}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  hero: { alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  blobOne: {
    position: 'absolute', top: -60, left: -40,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: colors.primarySoft, opacity: 0.8,
  },
  blobTwo: {
    position: 'absolute', top: 30, right: -50,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: '#e0f2fe', opacity: 0.7,
  },
  owl: { fontSize: 64 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -1, color: colors.text, marginTop: spacing.md },
  subtitle: { ...type.muted, textAlign: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.xl },
  form: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'center' },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: 15, fontSize: 16,
    color: colors.text, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    ...shadowSoft,
  },
  button: { ...primaryButton, marginTop: spacing.md },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  hint: { ...type.faint(), textAlign: 'center', marginTop: spacing.xl, lineHeight: 18 },
});

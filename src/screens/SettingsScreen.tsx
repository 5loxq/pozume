import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { usePalette, spacing, radius, typeFor, shadow,
  Palette, saveThemeOverride, getThemeMode, type ThemeMode,
} from '../theme';
import { t, Locale, loadLocaleOverride, saveLocaleOverride, type LocaleMode } from '../i18n';
import type { PoznoteClient } from '../api';
import { setAppLock, clearServer, getAppLock } from '../api/store';

interface Props {
  client: PoznoteClient;
  onLockChange: (enabled: boolean) => void;
  onLocaleChange: (locale: Locale | 'auto') => void;
  onLoggedOut: () => void;
  onBack: () => void;
}

export default function SettingsScreen({ client, onLockChange, onLocaleChange, onLoggedOut, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [localeMode, setLocaleMode] = useState<LocaleMode>('auto');
  const [themeMode, setThemeMode] = useState<ThemeMode>('auto');
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => { loadLocaleOverride().then(setLocaleMode); }, []);
  useEffect(() => { setThemeMode(getThemeMode()); }, []);
  // Gespeicherten Lock-Zustand laden, sonst zeigt der Switch immer "aus"
  useEffect(() => { getAppLock().then(setLockEnabled); }, []);
  // Server-Version anzeigen (ohne X-User-ID nötig, aber der Client sendet es mit)
  useEffect(() => {
    client.getSystemVersion()
      .then((r) => setServerVersion(r.current_version ?? null))
      .catch(() => {});
  }, [client]);

  const setTheme = async (mode: ThemeMode) => {
    setThemeMode(mode);
    await saveThemeOverride(mode);
  };

  const setLang = async (mode: LocaleMode) => {
    setLocaleMode(mode);
    await saveLocaleOverride(mode);
    onLocaleChange(mode);
  };

  const toggleLock = async (v: boolean) => {
    setLockEnabled(v);
    await setAppLock(v);
    onLockChange(v);
  };

  const confirmLogout = () => {
    Alert.alert(t('settings.logout'), t('settings.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.logout'), style: 'destructive',
        onPress: async () => {
          await clearServer();
          onLoggedOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('settings.title')}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>{t('settings.security')}</Text>
        <View style={[styles.card, shadow]}>
          <View style={styles.row}>
            <Text style={styles.rowText}>🔒 {t('settings.appLock')}</Text>
            <Switch value={lockEnabled} onValueChange={toggleLock}
              trackColor={{ true: colors.primary, false: colors.border }} />
          </View>
        </View>

        <Text style={styles.section}>{t('settings.language')}</Text>
        <View style={[styles.card, shadow]}>
          <TouchableOpacity style={styles.row} onPress={() => setLang('auto')}>
            <Text style={[styles.rowText, localeMode === 'auto' && styles.active]}>🌐 {t('settings.languageAuto')}</Text>
            {localeMode === 'auto' ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => setLang('de')}>
            <Text style={[styles.rowText, localeMode === 'de' && styles.active]}>🇩🇪 {t('settings.languageDe')}</Text>
            {localeMode === 'de' ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => setLang('en')}>
            <Text style={[styles.rowText, localeMode === 'en' && styles.active]}>🇬🇧 {t('settings.languageEn')}</Text>
            {localeMode === 'en' ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>{t('settings.appearance')}</Text>
        <View style={[styles.card, shadow]}>
          <TouchableOpacity style={styles.row} onPress={() => setTheme('auto')}>
            <Text style={[styles.rowText, themeMode === 'auto' && styles.active]}>🌗 {t('settings.themeAuto')}</Text>
            {themeMode === 'auto' ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => setTheme('light')}>
            <Text style={[styles.rowText, themeMode === 'light' && styles.active]}>☀️ {t('settings.themeLight')}</Text>
            {themeMode === 'light' ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => setTheme('dark')}>
            <Text style={[styles.rowText, themeMode === 'dark' && styles.active]}>🌙 {t('settings.themeDark')}</Text>
            {themeMode === 'dark' ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>{t('settings.server')}</Text>
        <View style={[styles.card, shadow]}>
          <View style={[styles.row, serverVersion ? null : styles.rowLast]}>
            <Text style={[styles.rowText, styles.serverText]} numberOfLines={1}>{client.cfg.baseUrl}</Text>
          </View>
          {serverVersion ? (
            <View style={[styles.row, styles.rowLast]}>
              <Text style={styles.rowText}>🪶 {t('settings.serverVersion')}</Text>
              <Text style={styles.serverText}>v{serverVersion}</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={[styles.logoutBtn, shadow]} onPress={confirmLogout}>
          <Text style={styles.logoutText}>↩ {t('settings.logout')}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Pozume v{Constants.expoConfig?.version ?? '?'} · 🪶</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: 60 },
  section: { ...type.muted, marginTop: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { ...type.body, flex: 1 },
  active: { color: colors.primary, fontWeight: '700' },
  serverText: { color: colors.textMuted, fontSize: 14 },
  logoutBtn: {
    backgroundColor: colors.dangerSoft, borderRadius: radius.lg,
    padding: spacing.lg, alignItems: 'center', marginTop: spacing.xl,
  },
  logoutText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  version: { ...type.faint(), textAlign: 'center', marginTop: spacing.xl },
  check: { color: colors.primary, fontSize: 18, fontWeight: '700' },
});

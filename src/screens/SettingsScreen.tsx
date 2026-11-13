import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, radius, type, shadow } from '../theme';
import { t, Locale, getLocale } from '../i18n';
import type { PoznoteClient } from '../api';
import { setAppLock, clearServer } from '../api/store';

interface Props {
  client: PoznoteClient;
  onLockChange: (enabled: boolean) => void;
  onLocaleChange: (locale: Locale | 'auto') => void;
  onLoggedOut: () => void;
  onBack: () => void;
}

export default function SettingsScreen({ client, onLockChange, onLocaleChange, onLoggedOut, onBack }: Props) {
  const [lockEnabled, setLockEnabled] = useState(false);
  const locale = getLocale();

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
          <TouchableOpacity style={styles.row} onPress={() => onLocaleChange('auto')}>
            <Text style={[styles.rowText, locale === 'de' || locale === 'en' ? null : styles.active]}>
              🌐 {t('settings.languageAuto')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => onLocaleChange('de')}>
            <Text style={[styles.rowText, locale === 'de' && styles.active]}>🇩🇪 {t('settings.languageDe')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => onLocaleChange('en')}>
            <Text style={[styles.rowText, locale === 'en' && styles.active]}>🇬🇧 {t('settings.languageEn')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>{t('settings.server')}</Text>
        <View style={[styles.card, shadow]}>
          <View style={[styles.row, styles.rowLast]}>
            <Text style={[styles.rowText, styles.serverText]} numberOfLines={1}>{client.cfg.baseUrl}</Text>
          </View>
        </View>

        <TouchableOpacity style={[styles.logoutBtn, shadow]} onPress={confirmLogout}>
          <Text style={styles.logoutText}>↩ {t('settings.logout')}</Text>
        </TouchableOpacity>

        <Text style={styles.version}>{t('settings.version')} · 🪶</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
});

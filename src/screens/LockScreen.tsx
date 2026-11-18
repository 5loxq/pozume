import React, {useEffect, useState, useMemo} from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { usePalette, spacing, typeFor,
  Palette,
} from '../theme';
import { t } from '../i18n';

interface Props { onUnlocked: () => void }

export default function LockScreen({ onUnlocked }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const [busy, setBusy] = useState(false);
  // Level 0: Gerät hat gar keine Sicherheit (weder Code noch Biometrie) —
  // dann bleibt nur Tap-Unlock mit deutlichem Hinweis
  const [noSecurity, setNoSecurity] = useState(false);

  const authenticate = async () => {
    if (busy) return;
    if (noSecurity) { onUnlocked(); return; }
    setBusy(true);
    try {
      // disableDeviceFallback nicht setzen — der Passcode-Fallback bleibt nutzbar
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t('lock.promptMessage'),
        cancelLabel: t('common.cancel'),
      });
      if (res.success) onUnlocked();
    } finally {
      setBusy(false);
    }
  };

  // Beim Öffnen: Gerätesicherheit prüfen (Level 1 = Passcode, 2 = Biometrie).
  // Nur mit Biometrie/Code automatisch starten — ohne Gerätesperre den
  // Nutzer per Tipp entscheiden lassen statt still zu entsperren.
  useEffect(() => {
    (async () => {
      try {
        const level = await LocalAuthentication.getEnrolledLevelAsync();
        if (level > 0) {
          setBusy(true);
          const res = await LocalAuthentication.authenticateAsync({
            promptMessage: t('lock.promptMessage'),
            cancelLabel: t('common.cancel'),
          });
          if (res.success) onUnlocked();
        } else {
          setNoSecurity(true);
        }
      } catch {
        setNoSecurity(true);
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.owl}>🪶</Text>
      <Text style={styles.title}>{t('lock.title')}</Text>
      {noSecurity ? (
        <Text style={styles.hint}>{t('lock.noDeviceSecurity')}</Text>
      ) : null}
      <TouchableOpacity style={styles.button} onPress={authenticate} disabled={busy}>
        <Text style={styles.buttonText}>{noSecurity ? t('lock.tapUnlock') : t('lock.faceId')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  owl: { fontSize: 64, marginBottom: spacing.lg },
  title: { ...type.h2, marginBottom: spacing.xl },
  hint: { ...type.muted, textAlign: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.xl },
  button: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

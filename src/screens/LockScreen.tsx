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

  const authenticate = async () => {
    setBusy(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && enrolled) {
        const res = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Pozume',
          cancelLabel: 'Abbrechen',
        });
        if (res.success) { onUnlocked(); return; }
      } else {
        // Kein Biometrie-Setup: einfacher Tap-Unlock (Demo-Niveau)
        onUnlocked();
        return;
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { authenticate(); }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.owl}>🪶</Text>
      <Text style={styles.title}>{t('lock.title')}</Text>
      <TouchableOpacity style={styles.button} onPress={authenticate} disabled={busy}>
        <Text style={styles.buttonText}>{t('lock.faceId')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  owl: { fontSize: 64, marginBottom: spacing.lg },
  title: { ...type.h2, marginBottom: spacing.xl },
  button: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

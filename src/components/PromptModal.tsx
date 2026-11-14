import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { usePalette, spacing, radius, typeFor, shadow, primaryButton,
  Palette,
} from '../theme';
import { t } from '../i18n';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  secure?: boolean;
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
  onCancel: () => void;
  /** onSubmit erhält die Eingabe; null bei Abbruch */
  onSubmit: (value: string) => void;
}

/** Plattform-übergreifender Ersatz für Alert.prompt (nur iOS) */
export default function PromptModal({
  visible, title, message, placeholder, defaultValue = '', secure = false,
  keyboardType = 'default', maxLength, onCancel, onSubmit,
}: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [visible, defaultValue]);

  const submit = () => {
    onSubmit(value);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onCancel} />
        <View style={[styles.sheet, shadow]}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            secureTextEntry={secure}
            keyboardType={keyboardType}
            maxLength={maxLength}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submit}
          />
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.okBtn} onPress={submit}>
              <Text style={styles.okText}>{t('prompt.ok')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(21,26,35,0.5)', justifyContent: 'center', paddingHorizontal: spacing.xl },
  backdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl,
  },
  title: { ...type.h2, textAlign: 'center', marginBottom: spacing.sm },
  message: { ...type.muted, textAlign: 'center', marginBottom: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 16,
    color: colors.text, backgroundColor: colors.bg,
  },
  btnRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  cancelBtn: {
    flex: 1, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center',
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  cancelText: { color: colors.textMuted, fontWeight: '700' },
  okBtn: { ...primaryButton, flex: 1, paddingVertical: 13 },
  okText: { color: '#fff', fontWeight: '700' },
});

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePalette, spacing, radius, typeFor, shadow, primaryButton,
  Palette,
} from '../theme';
import { t } from '../i18n';
import { loadAiConfig, saveAiConfig, clearAiConfig, aiChat, type AiConfig } from '../api/ai';
import type { PoznoteClient, Note } from '../api';

interface Msg { role: 'user' | 'assistant'; content: string }

interface Props {
  client: PoznoteClient;
  notes: Note[];
  onBack: () => void;
}

export default function AiScreen({ notes, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList>(null);

  // Config-Felder
  const [fBaseUrl, setFBaseUrl] = useState('');
  const [fKey, setFKey] = useState('');
  const [fModel, setFModel] = useState('');

  useEffect(() => {
    loadAiConfig().then((c) => {
      setCfg(c);
      if (c) { setFBaseUrl(c.baseUrl); setFModel(c.model); }
      else setShowConfig(true);
    });
  }, []);

  const saveConfig = async () => {
    if (!fBaseUrl.trim() || !fKey.trim() || !fModel.trim()) {
      Alert.alert(t('common.error'), 'Bitte alle Felder ausfüllen.');
      return;
    }
    const c = { baseUrl: fBaseUrl.trim(), apiKey: fKey.trim(), model: fModel.trim() };
    await saveAiConfig(c);
    setCfg(c);
    setShowConfig(false);
    setFKey('');
  };

  const noteContext = (): string => {
    if (notes.length === 0) return '';
    const list = notes.slice(0, 40).map((n) => {
      const ex = (n.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return `- „${n.heading}" (#${n.id})${ex ? ': ' + ex : ''}`;
    }).join('\n');
    return `\n\n[Kontext: Die letzten Notizen des Nutzers auf Poznote:\n${list}\n]`;
  };

  const ask = async (text: string) => {
    if (!cfg || !text.trim() || busy) return;
    const userMsg: Msg = { role: 'user', content: text };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);
    try {
      const reply = await aiChat(cfg, [
        { role: 'system', content: 'Du bist der Pozume-KI-Assistent und hilfst beim Verwalten persönlicher Poznote-Notizen. Antworte präzise und auf Deutsch, es sei denn, die Frage ist auf Englisch.' },
        ...messages.slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
        { ...userMsg, content: userMsg.content + noteContext() },
      ]);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      Alert.alert(t('ai.error'), String(e?.message ?? e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  const quick = (label: string, text: string) => (
    <TouchableOpacity key={label} style={[styles.quickChip, shadow]} onPress={() => ask(text)}>
      <Text style={styles.quickText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>✨ {t('ai.title')}</Text>
        <TouchableOpacity onPress={() => setShowConfig(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.gear}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
            <Text style={item.role === 'user' ? styles.userText : styles.aiText}>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✨</Text>
            <Text style={styles.emptyText}>{cfg ? t('ai.placeholder') : t('ai.settings')}</Text>
          </View>
        }
      />

      <View style={styles.quickRow}>
        {quick('📝', t('ai.askSummary'))}
        {quick('✍️', t('ai.askImprove'))}
        {quick('☑️', t('ai.askTasks'))}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={t('ai.placeholder')}
            placeholderTextColor={colors.textFaint}
            value={input}
            onChangeText={setInput}
            multiline
          />
          <TouchableOpacity style={[styles.sendBtn, (busy || !input.trim() || !cfg) && styles.sendDisabled]}
            onPress={() => ask(input)} disabled={busy || !input.trim() || !cfg}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendText}>↑</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={showConfig} transparent animationType="slide" onRequestClose={() => setShowConfig(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTouch} onPress={() => setShowConfig(false)} />
          <View style={[styles.sheet, shadow]}>
            <Text style={styles.sheetTitle}>{t('ai.settings')}</Text>
            <TextInput style={styles.cfgInput} placeholder={t('ai.baseUrl')}
              placeholderTextColor={colors.textFaint} autoCapitalize="none" keyboardType="url"
              value={fBaseUrl} onChangeText={setFBaseUrl} />
            <TextInput style={styles.cfgInput} placeholder={t('ai.apiKey')}
              placeholderTextColor={colors.textFaint} autoCapitalize="none" secureTextEntry
              value={fKey} onChangeText={setFKey} />
            <TextInput style={styles.cfgInput} placeholder={t('ai.model')}
              placeholderTextColor={colors.textFaint} autoCapitalize="none"
              value={fModel} onChangeText={setFModel} />
            <Text style={styles.hint}>{t('ai.hint')}</Text>
            <View style={styles.cfgBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowConfig(false)}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveConfig}>
                <Text style={styles.saveText}>{t('ai.save')}</Text>
              </TouchableOpacity>
              {cfg ? (
                <TouchableOpacity style={styles.clearBtn} onPress={async () => { await clearAiConfig(); setCfg(null); }}>
                  <Text style={styles.clearText}>🗑</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 44 },
  title: { ...type.h2, flex: 1, textAlign: 'center' },
  gear: { fontSize: 20, width: 44, textAlign: 'right' },
  list: { flex: 1 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.md },
  bubble: {
    maxWidth: '85%', borderRadius: radius.lg, padding: spacing.md,
    marginBottom: spacing.sm,
  },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: radius.sm, ...shadow },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  aiText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  empty: { alignItems: 'center', paddingVertical: 80 },
  emptyIcon: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted, textAlign: 'center', paddingHorizontal: spacing.xl },
  quickRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  quickChip: {
    backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  quickText: { fontSize: 16 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    padding: spacing.lg, paddingTop: spacing.sm,
  },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md,
    fontSize: 15, maxHeight: 100, color: colors.text, borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(21,26,35,0.4)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.xl,
  },
  sheetTitle: { ...type.h2, marginBottom: spacing.lg, textAlign: 'center' },
  cfgInput: {
    backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 15,
    marginBottom: spacing.md, color: colors.text,
  },
  hint: { ...type.faint(), lineHeight: 17, marginBottom: spacing.lg },
  cfgBtns: { flexDirection: 'row', gap: spacing.md },
  cancelBtn: {
    flex: 1, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center',
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  cancelText: { color: colors.textMuted, fontWeight: '700' },
  saveBtn: { ...primaryButton as object, flex: 1, paddingVertical: 14 },
  saveText: { color: '#fff', fontWeight: '700' },
  clearBtn: { width: 50, borderRadius: radius.md, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 18 },
});

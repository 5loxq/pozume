import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, ActivityIndicator } from 'react-native';
import { colors, spacing, radius, type, shadow, primaryButton } from '../theme';
import { t } from '../i18n';
import type { PoznoteClient } from '../api';

interface Folder { id: number; name: string }

interface Props {
  visible: boolean;
  client: PoznoteClient;
  currentFolderId: number | null;
  onSelect: (folderId: number | null, folderName: string) => void;
  onClose: () => void;
}

export default function FolderPickerSheet({ visible, client, currentFolderId, onSelect, onClose }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    client.listFolders()
      .then((res) => setFolders((res.folders ?? []) as Folder[]))
      .catch(() => setFolders([]))
      .finally(() => setLoading(false));
  }, [visible, client]);

  const Row = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={[styles.rowText, active && styles.rowActive]}>{label}</Text>
      {active ? <Text style={styles.check}>✓</Text> : null}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.sheet, shadow]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('editor.moveFolder')}</Text>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <FlatList
              data={folders}
              keyExtractor={(f) => String(f.id)}
              style={styles.list}
              renderItem={({ item }) => (
                <Row label={`📁 ${item.name}`} active={currentFolderId === item.id}
                  onPress={() => onSelect(item.id, item.name)} />
              )}
              ListHeaderComponent={
                <Row label={t('editor.noFolder')} active={currentFolderId == null}
                  onPress={() => onSelect(null, '')} />
              }
            />
          )}
          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(21,26,35,0.4)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingBottom: spacing.xl, maxHeight: '70%',
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.md },
  title: { ...type.h2, textAlign: 'center', paddingVertical: spacing.md },
  list: { paddingHorizontal: spacing.lg },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowText: { ...type.body, flex: 1 },
  rowActive: { color: colors.primary, fontWeight: '700' },
  check: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  center: { paddingVertical: spacing.xl },
  doneBtn: { ...primaryButton, marginHorizontal: spacing.lg, marginTop: spacing.md, paddingVertical: 14 },
  doneText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, ActivityIndicator } from 'react-native';
import { usePalette, spacing, radius, typeFor, shadow, primaryButtonFor,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient } from '../api';

export interface PickerFolder {
  id: number;
  name: string;
  path?: string;
  workspace?: string | null;
  depth: number;
}

interface Props {
  visible: boolean;
  client: PoznoteClient;
  currentFolderId: number | null;
  onSelect: (folderId: number | null, folderName: string) => void;
  onClose: () => void;
  /** Eigener Titel (z.B. "Ordner verschieben"); Default: Notiz verschieben */
  title?: string;
  /** Gesperrte Ziele (der Ordner selbst + alle Unterordner) — für Ordner-Verschiebung */
  excludeIds?: number[];
}

/** Hierarchische Ordnerliste aller Workspaces zu einer flachen Liste mit Tiefe umbrechen */
function flatten(nodes: any[], depth = 0, out: PickerFolder[] = []): PickerFolder[] {
  for (const n of nodes ?? []) {
    out.push({ id: n.id, name: n.name, path: n.path, workspace: n.workspace ?? null, depth });
    if (n.children?.length) flatten(n.children, depth + 1, out);
  }
  return out;
}

/** Zeile der Ordnerliste — auf Modulebene, damit FlatList nicht bei jedem Render remountet */
function Row({ label, active, onPress, styles }: { label: string; active: boolean; onPress: () => void; styles: ReturnType<typeof getStyles> }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={[styles.rowText, active && styles.rowActive]} numberOfLines={1}>{label}</Text>
      {active ? <Text style={styles.check}>✓</Text> : null}
    </TouchableOpacity>
  );
}

export default function FolderPickerSheet({ visible, client, currentFolderId, onSelect, onClose, title, excludeIds }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [loading, setLoading] = useState(false);
  // Ausschluss als stabiler String für die Effekt-Abhängigkeit
  const excludeKey = (excludeIds ?? []).join(',');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Ordner je Workspace hierarchisch laden und zusammenführen
        const wsRes = await client.listWorkspaces().catch(() => null);
        const workspaces = (wsRes?.workspaces ?? []).map((w) => w.name);
        const lists = await Promise.all(
          (workspaces.length > 0 ? workspaces : [undefined]).map((ws) =>
            client.listFolders(ws, true)
              .then((res) => flatten((res.folders ?? []) as any[], 0).map((f) => ({ ...f, workspace: ws })))
              .catch(() => [] as PickerFolder[]),
          ),
        );
        if (cancelled) return;
        const blocked = new Set(excludeIds ?? []);
        setFolders(lists.flat().filter((f) => !blocked.has(f.id)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // excludeKey statt Array-Identität: verhindert wiederholtes Nachladen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, client, excludeKey]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} onPress={onClose} />
        <View style={[styles.sheet, shadow]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title ?? t('editor.moveFolder')}</Text>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <FlatList
              data={folders}
              keyExtractor={(f) => `${f.workspace ?? ''}-${f.id}`}
              style={styles.list}
              renderItem={({ item }) => (
                <Row
                  styles={styles}
                  label={`${'   '.repeat(item.depth)}📁 ${item.name}${item.workspace ? `  ·  ${item.workspace}` : ''}`}
                  active={currentFolderId === item.id}
                  onPress={() => onSelect(item.id, item.path || item.name)}
                />
              )}
              ListHeaderComponent={
                <Row styles={styles} label={t('editor.noFolder')} active={currentFolderId == null}
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

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
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
  doneBtn: { ...primaryButtonFor(colors), marginHorizontal: spacing.lg, marginTop: spacing.md, paddingVertical: 14 },
  doneText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

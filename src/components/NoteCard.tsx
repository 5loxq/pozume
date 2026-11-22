import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { usePalette, useIsDark, spacing, radius, typeFor, shadow, tagColors,
  Palette,
} from '../theme';
import { formatRelativeDate, excerpt, parseTags } from '../utils';
import { isDrawingContent } from './DrawingEditor';
import DrawingPreview from './DrawingPreview';
import { t } from '../i18n';
import * as Haptics from 'expo-haptics';
import type { Note } from '../api';

interface Props {
  note: Note;
  locale: string;
  onPress: (note: Note) => void;
  onTagPress?: (tag: string) => void;
  onLongPress?: (note: Note) => void;
  /** Zeichnungsinhalt (aus lokalem Cache), für die Vorschau auf der Karte */
  drawingContent?: string;
  /** Multi-Select: Karte tippt an/ab statt zu öffnen */
  selectMode?: boolean;
  selected?: boolean;
}

/** React.memo: Karte rendert nur, wenn sich die Notiz (oder ein Callback) ändert */
const NoteCard = React.memo(function NoteCard({ note, locale, onPress, onTagPress, onLongPress, drawingContent, selectMode, selected }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const isDark = useIsDark();
  const styles = useMemo(() => getStyles(colors, type, isDark), [colors, isDark]);
  const tags = parseTags(note.tags);
  const colorHex = note.color_hex ?? null;
  // isDrawingContent parst bei JSON-Notizen den kompletten Inhalt — pro Render cachen
  const drawing = useMemo(
    () => drawingContent ?? (isDrawingContent(note.content) ? note.content : null),
    [drawingContent, note.content],
  );
  return (
    <TouchableOpacity
      style={[styles.card, shadow, colorHex ? { borderLeftColor: colorHex, borderLeftWidth: 4 } : null]}
      activeOpacity={0.65}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(note); }}
      onLongPress={onLongPress ? () => onLongPress(note) : undefined}
    >
      <View style={styles.headerRow}>
        {selectMode ? (
          <Text style={[styles.selectBox, selected && styles.selectBoxActive]}>
            {selected ? '✓' : ''}
          </Text>
        ) : note.pinned ? <Text style={styles.pin}>📌</Text> : null}
        <Text style={styles.title} numberOfLines={2}>{note.heading || '…'}</Text>
        {note.favorite ? <Text style={styles.icons}>★</Text> : null}
      </View>
      {drawing ? (
        <DrawingPreview content={drawing} height={90} />
      ) : note.type === 'excalidraw' ? (
        <Text style={styles.excerpt} numberOfLines={1}>🎨 {t('list.excalidraw')}</Text>
      ) : excerpt(note.content) ? (
        <Text style={styles.excerpt} numberOfLines={2}>{excerpt(note.content)}</Text>
      ) : null}
      <View style={styles.footerRow}>
        {tags.slice(0, 3).map((tag) => {
          const c = tagColors(tag, isDark);
          return (
            <TouchableOpacity key={tag} activeOpacity={0.7}
              onPress={onTagPress ? () => onTagPress(tag) : undefined}>
              <View style={[styles.tag, { backgroundColor: c.bg }]}>
                <Text style={[styles.tagText, { color: c.fg }]}>{tag}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <Text style={styles.date}>{formatRelativeDate(note.updated_at, locale)}</Text>
      </View>
    </TouchableOpacity>
  );
});

export default NoteCard;

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>, isDark: boolean) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md + 2,
    // Light: schwebende Karte ganz ohne Rand (Schatten macht die Kante);
    // Dark: weicher feiner Rand, Schatten wären auf dunklem Grund unsichtbar
    borderWidth: isDark ? 1 : 0,
    borderColor: colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  pin: { fontSize: 13, marginRight: spacing.sm, marginTop: 2 },
  selectBox: {
    width: 22, height: 22, borderRadius: 11, marginRight: spacing.sm, marginTop: 2,
    borderWidth: 2, borderColor: '#c8ccd6', color: '#fff',
    textAlign: 'center', lineHeight: 19, fontSize: 13, fontWeight: '800', overflow: 'hidden',
  },
  selectBoxActive: { borderColor: '#4f46e5', backgroundColor: '#4f46e5' },
  title: { ...type.h2, flex: 1, fontSize: 16, lineHeight: 22, letterSpacing: -0.3 },
  icons: { fontSize: 15, marginLeft: spacing.sm, color: colors.star },
  excerpt: { ...type.muted, marginTop: spacing.xs, lineHeight: 20 },
  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: 6 },
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 2,
  },
  tagText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  date: { ...type.faint(), marginLeft: 'auto', fontSize: 12 },
});

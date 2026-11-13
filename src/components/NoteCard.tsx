import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { usePalette, spacing, radius, type, shadow, tagColors } from '../theme';
import { useColorScheme } from 'react-native';
import { formatRelativeDate, excerpt, parseTags } from '../utils';
import * as Haptics from 'expo-haptics';
import type { Note } from '../api';

interface Props {
  note: Note;
  locale: string;
  onPress: (note: Note) => void;
  onTagPress?: (tag: string) => void;
}

export default function NoteCard({ note, locale, onPress, onTagPress }: Props) {
  const colors = usePalette();
  const isDark = useColorScheme() === 'dark';
  const tags = parseTags(note.tags);
  return (
    <TouchableOpacity style={[styles.card, shadow]} activeOpacity={0.65} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(note); }}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>{note.heading || '…'}</Text>
        {note.favorite ? <Text style={styles.star}>★</Text> : null}
      </View>
      {excerpt(note.content) ? (
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
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(21,26,35,0.04)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { ...type.h2, flex: 1, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  star: { color: colors.star, fontSize: 18, marginLeft: spacing.sm },
  excerpt: { ...type.muted, marginTop: spacing.xs, lineHeight: 20 },
  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: 6 },
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 2,
  },
  tagText: { fontSize: 12, fontWeight: '600' },
  date: { ...type.faint(), marginLeft: 'auto', fontSize: 12 },
});

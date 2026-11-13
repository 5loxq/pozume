import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius, type, shadow } from '../theme';
import { formatRelativeDate, excerpt, parseTags } from '../utils';
import type { Note } from '../api';

interface Props {
  note: Note;
  locale: string;
  onPress: (note: Note) => void;
}

export default function NoteCard({ note, locale, onPress }: Props) {
  const tags = parseTags(note.tags);
  return (
    <TouchableOpacity style={[styles.card, shadow]} activeOpacity={0.7} onPress={() => onPress(note)}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>{note.heading || '…'}</Text>
        {note.favorite ? <Text style={styles.star}>★</Text> : null}
      </View>
      {excerpt(note.content) ? (
        <Text style={styles.excerpt} numberOfLines={2}>{excerpt(note.content)}</Text>
      ) : null}
      <View style={styles.footerRow}>
        {tags.slice(0, 3).map((tag) => (
          <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
        ))}
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
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  title: { ...type.h2, flex: 1 },
  star: { color: colors.star, fontSize: 18, marginLeft: spacing.sm },
  excerpt: { ...type.muted, marginTop: spacing.xs, lineHeight: 19 },
  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: spacing.xs },
  tag: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    marginRight: spacing.xs,
  },
  tagText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  date: { ...type.faint(), marginLeft: 'auto', fontSize: 12 },
});

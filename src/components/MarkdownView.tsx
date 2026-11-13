import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, type } from '../theme';

/** Leichter Markdown-Renderer: Überschriften, Listen, Fettdruck, Code, Quotes */
export default function MarkdownView({ content }: { content: string }) {
  const lines = content.split('\n');
  const out: React.ReactNode[] = [];

  const renderInline = (text: string, keyBase: string, style: object = {}) => {
    // **fett** und `code` in Segmente zerlegen
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <Text key={`${keyBase}-${i}`} style={[style, styles.bold]}>{part.slice(2, -2)}</Text>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <Text key={`${keyBase}-${i}`} style={[style, styles.code]}>{part.slice(1, -1)}</Text>;
      }
      return <Text key={`${keyBase}-${i}`} style={style}>{part}</Text>;
    });
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const key = `l${idx}`;
    if (!line.trim()) { out.push(<View key={key} style={styles.gap} />); return; }
    if (line.startsWith('### ')) {
      out.push(<Text key={key} style={styles.h3}>{renderInline(line.slice(4), key)}</Text>);
    } else if (line.startsWith('## ')) {
      out.push(<Text key={key} style={styles.h2}>{renderInline(line.slice(3), key)}</Text>);
    } else if (line.startsWith('# ')) {
      out.push(<Text key={key} style={styles.h1}>{renderInline(line.slice(2), key)}</Text>);
    } else if (line.startsWith('> ')) {
      out.push(
        <View key={key} style={styles.quote}>
          <Text style={styles.quoteText}>{renderInline(line.slice(2), key)}</Text>
        </View>,
      );
    } else if (/^[-*] /.test(line)) {
      out.push(
        <View key={key} style={styles.li}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.liText}>{renderInline(line.slice(2), key)}</Text>
        </View>,
      );
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)?.[1];
      out.push(
        <View key={key} style={styles.li}>
          <Text style={styles.bullet}>{num}.</Text>
          <Text style={styles.liText}>{renderInline(line.replace(/^\d+\. /, ''), key)}</Text>
        </View>,
      );
    } else {
      out.push(<Text key={key} style={styles.para}>{renderInline(line, key)}</Text>);
    }
  });

  return <View>{out}</View>;
}

const styles = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm, letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  para: { ...type.body, lineHeight: 26 },
  bold: { fontWeight: '700' },
  code: { fontFamily: 'Menlo', fontSize: 14, backgroundColor: colors.primarySoft, color: colors.primaryDark, borderRadius: 4 },
  li: { flexDirection: 'row', marginBottom: 4, paddingRight: spacing.md },
  bullet: { width: 22, color: colors.primary, fontWeight: '700', fontSize: 15 },
  liText: { ...type.body, flex: 1, lineHeight: 24 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, marginVertical: spacing.sm },
  quoteText: { ...type.body, color: colors.textMuted, fontStyle: 'italic' },
  gap: { height: spacing.sm },
});

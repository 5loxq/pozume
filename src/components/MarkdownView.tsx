import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { usePalette, spacing, typeFor,
  Palette,
} from '../theme';

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case',
  'class', 'import', 'from', 'export', 'default', 'new', 'async', 'await', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'extends', 'implements', 'interface', 'type',
  'enum', 'public', 'private', 'protected', 'static', 'void', 'def', 'lambda', 'elif',
  'print', 'with', 'as', 'in', 'of', 'this', 'super', 'yield', 'do', 'struct', 'fn', 'match',
]);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'NaN']);

interface Token { text: string; kind: 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'literal' }

/** Eine Code-Zeile in farbige Segmente zerlegen (Strings, Kommentare, Zahlen, Schlüsselwörter) */
function tokenizeLine(line: string): Token[] {
  const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), kind: 'plain' });
    if (m[1]) out.push({ text: m[1], kind: 'comment' });
    else if (m[2]) out.push({ text: m[2], kind: 'string' });
    else if (m[3]) out.push({ text: m[3], kind: 'number' });
    else {
      const word = m[4];
      out.push({ text: word, kind: KEYWORDS.has(word) ? 'keyword' : LITERALS.has(word) ? 'literal' : 'plain' });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), kind: 'plain' });
  return out;
}

/** Leichter Markdown-Renderer: Überschriften, Listen, Fettdruck, Code, Quotes, Code-Blöcke.
 *  Interne Notizlinks ([[Notiztitel]] und pozume://note/ID) werden tappbar. */
export default function MarkdownView({
  content,
  onOpenNoteId,
  onOpenNoteTitle,
}: { content: string; onOpenNoteId?: (id: number) => void; onOpenNoteTitle?: (title: string) => void }) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const lines = content.split('\n');
  const out: React.ReactNode[] = [];

  const renderInline = (text: string, keyBase: string, style: object = {}) => {
    // **fett**, `code`, [[Notizlink]] und pozume://note/ID in Segmente zerlegen
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]\n]+\]\]|pozume:\/\/note\/\d+)/g).filter(Boolean);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <Text key={`${keyBase}-${i}`} style={[style, styles.bold]}>{part.slice(2, -2)}</Text>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <Text key={`${keyBase}-${i}`} style={[style, styles.code]}>{part.slice(1, -1)}</Text>;
      }
      // Wiki-Link [[Notiztitel]] — öffnet die verlinkte Notiz
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const title = part.slice(2, -2);
        return (
          <Text
            key={`${keyBase}-${i}`}
            style={[style, styles.noteLink]}
            onPress={onOpenNoteTitle ? () => onOpenNoteTitle(title) : undefined}
          >
            {title}
          </Text>
        );
      }
      // Deep-Link pozume://note/123
      const deep = part.match(/^pozume:\/\/note\/(\d+)$/);
      if (deep) {
        return (
          <Text
            key={`${keyBase}-${i}`}
            style={[style, styles.noteLink]}
            onPress={onOpenNoteId ? () => onOpenNoteId(Number(deep[1])) : undefined}
          >
            🪶
          </Text>
        );
      }
      return <Text key={`${keyBase}-${i}`} style={style}>{part}</Text>;
    });
  };

  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `l${key++}`;
    // Eingezäunter Code-Block: ```lang ... ```
    const fence = line.trim().match(/^```(\w*)$/);
    if (fence) {
      const lang = fence[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // schließenden Zaun überspringen
      out.push(
        <View key={k} style={styles.codeBlock}>
          {lang ? <Text style={styles.codeLang}>{lang}</Text> : null}
          {codeLines.map((cl, ci) => (
            <Text key={ci} style={styles.codeLine}>
              {tokenizeLine(cl).map((tok, ti) => (
                <Text key={ti} style={styles[`${tok.kind}Token` as const]}>{tok.text}</Text>
              ))}
              {'\n'}
            </Text>
          ))}
        </View>,
      );
      continue;
    }
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) { out.push(<View key={k} style={styles.gap} />); i++; continue; }
    if (trimmed.startsWith('### ')) {
      out.push(<Text key={k} style={styles.h3}>{renderInline(trimmed.slice(4), k)}</Text>);
    } else if (trimmed.startsWith('## ')) {
      out.push(<Text key={k} style={styles.h2}>{renderInline(trimmed.slice(3), k)}</Text>);
    } else if (trimmed.startsWith('# ')) {
      out.push(<Text key={k} style={styles.h1}>{renderInline(trimmed.slice(2), k)}</Text>);
    } else if (trimmed.startsWith('> ')) {
      out.push(
        <View key={k} style={styles.quote}>
          <Text style={styles.quoteText}>{renderInline(trimmed.slice(2), k)}</Text>
        </View>,
      );
    } else if (/^[-*] /.test(trimmed)) {
      out.push(
        <View key={k} style={styles.li}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.liText}>{renderInline(trimmed.slice(2), k)}</Text>
        </View>,
      );
    } else if (/^\d+\. /.test(trimmed)) {
      const num = trimmed.match(/^(\d+)\. /)?.[1];
      out.push(
        <View key={k} style={styles.li}>
          <Text style={styles.bullet}>{num}.</Text>
          <Text style={styles.liText}>{renderInline(trimmed.replace(/^\d+\. /, ''), k)}</Text>
        </View>,
      );
    } else {
      out.push(<Text key={k} style={styles.para}>{renderInline(trimmed, k)}</Text>);
    }
    i++;
  }

  return <View>{out}</View>;
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  h1: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm, letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  h3: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  para: { ...type.body, lineHeight: 26 },
  bold: { fontWeight: '700' },
  code: { fontFamily: 'Menlo', fontSize: 14, backgroundColor: colors.primarySoft, color: colors.primaryDark, borderRadius: 4 },
  noteLink: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  li: { flexDirection: 'row', marginBottom: 4, paddingRight: spacing.md },
  bullet: { width: 22, color: colors.primary, fontWeight: '700', fontSize: 15 },
  liText: { ...type.body, flex: 1, lineHeight: 24 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, marginVertical: spacing.sm },
  quoteText: { ...type.body, color: colors.textMuted, fontStyle: 'italic' },
  gap: { height: spacing.sm },
  codeBlock: {
    backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginVertical: spacing.sm,
  },
  codeLang: { fontSize: 10, color: colors.textFaint, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  codeLine: { fontFamily: 'Menlo', fontSize: 13, lineHeight: 20, color: colors.text },
  plainToken: {},
  commentToken: { color: colors.textFaint, fontStyle: 'italic' },
  stringToken: { color: colors.success },
  numberToken: { color: colors.star },
  keywordToken: { color: colors.primary, fontWeight: '700' },
  literalToken: { color: colors.danger },
});

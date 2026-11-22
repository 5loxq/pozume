import React, { useMemo, useState } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { usePalette, type Palette } from '../theme';

/**
 * Live-Markdown-Eingabe: Formatiert Markdown-Syntax, WÄHREND getippt wird —
 * `**fett**` erscheint sofort fett, `_kursiv_` kursiv, `code` als Chip.
 * Die Syntax-Zeichen bleiben sichtbar (leicht gedimmt), damit der Quelltext
 * weiterhin direkt editierbar ist.
 *
 * Technik: ein transparentes TextInput über einer stylenden Text-Schicht.
 * Beide nutzen Menlo (monospaced) mit identischen Metriken — fette/kursive
 * Glyphen haben in Menlo exakt dieselbe Vorschubbreite wie normaler Text,
 * dadurch bleibt der Cursor trotz Live-Formatierung pixelgenau über dem
 * Zeichen. React-Native-TextInput kann Teilstrings nicht stylen, und die
 * gepflegte Live-Markdown-Bibliothek verlangt die New Architecture, die diese
 * App bewusst nicht nutzt — das Overlay ist der alte-Architektur-Weg.
 */

const FONT = 'Menlo';
const FONT_SIZE = 15;
const LINE_HEIGHT = 24;

/** Zeilen-Präfixe (Überschriften, Listen, Zitate) farblich abheben */
function linePrefix(line: string): { prefix: string; rest: string } | null {
  const m = line.match(/^(#{1,3} |- |\* |\d+\. |> )/);
  if (!m) return null;
  return { prefix: m[1], rest: line.slice(m[1].length) };
}

/** Inline-Tokens (Syntax-Zeichen gedimmt, Inhalt formatiert) */
function inlineTokens(text: string, styles: ReturnType<typeof getStyles>): Array<{ text: string; style: object }> {
  const out: Array<{ text: string; style: object }> = [];
  const re = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, s: object) => { if (t) out.push({ text: t, style: s }); };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index), {});
    const token = m[0];
    if (m[1]) {
      push('**', styles.marker);
      push(token.slice(2, -2), styles.bold);
      push('**', styles.marker);
    } else if (m[2]) {
      push('`', styles.marker);
      push(token.slice(1, -1), styles.codeText);
      push('`', styles.marker);
    } else {
      // Kursiv mit Wortgrenzen (snake_case-Variablen bleiben normal) —
      // dieselbe Regel wie in der MarkdownView, damit Vorschau und Editor
      // identisch interpretieren
      const prev = m.index > 0 ? text[m.index - 1] : '';
      const next = m.index + token.length < text.length ? text[m.index + token.length] : '';
      if (!/[A-Za-z0-9_]/.test(prev) && !/[A-Za-z0-9_]/.test(next)) {
        push('_', styles.marker);
        push(token.slice(1, -1), styles.italic);
        push('_', styles.marker);
      } else {
        push(token, {});
      }
    }
    last = m.index + token.length;
  }
  push(text.slice(last), {});
  return out;
}

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  selection?: { start: number; end: number };
  onSelectionChange?: (e: { nativeEvent: { selection: { start: number; end: number } } }) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  editable?: boolean;
}

export default function LiveMarkdownInput({
  value, onChangeText, selection, onSelectionChange, placeholder, placeholderTextColor, editable,
}: Props) {
  const colors = usePalette();
  const styles = useMemo(() => getStyles(colors), [colors]);
  // Höhe des Inhalts nachführen — sonst scrollt das TextInput INTERN und die
  // Overlay-Schicht würde auseinanderlaufen; so wächst das Feld mit dem Text
  const [contentH, setContentH] = useState(0);
  const height = Math.max(280, contentH + 6);

  const overlay = useMemo(() => {
    const lines = value.split('\n');
    return lines.map((line, li) => {
      const nodes: React.ReactNode[] = [];
      if (line.startsWith('```')) {
        // Zaun-Zeilen (inkl. mermaid) als Code hervorheben
        nodes.push(<Text key="f" style={styles.fenceLine}>{line}</Text>);
      } else {
        const lp = linePrefix(line);
        if (lp) {
          nodes.push(<Text key={`p${li}`} style={styles.lineMarker}>{lp.prefix}</Text>);
          inlineTokens(lp.rest, styles).forEach((tok, ti) => (
            nodes.push(<Text key={`t${ti}`} style={tok.style}>{tok.text}</Text>)
          ));
        } else {
          inlineTokens(line, styles).forEach((tok, ti) => (
            nodes.push(<Text key={`t${ti}`} style={tok.style}>{tok.text}</Text>)
          ));
        }
      }
      return (
        <Text key={`l${li}`} style={styles.overlayLine}>
          {nodes}
          {'\n'}
        </Text>
      );
    });
  }, [value, styles]);


  return (
    <View style={{ height }}>
      {/* Overlay: formatierte Darstellung, für Berührungen durchlässig */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <Text style={styles.overlay}>{overlay}</Text>
      </View>
      {/* Transparente Eingabeschicht: Cursor und Auswahl bleiben sichtbar */}
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        selection={selection}
        onSelectionChange={onSelectionChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        editable={editable}
        multiline
        textAlignVertical="top"
        onContentSizeChange={(e) => setContentH(e.nativeEvent.contentSize.height)}
        selectionColor={colors.primary}
        scrollEnabled={false}
      />
    </View>
  );
}

const getStyles = (colors: Palette) => StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    fontFamily: FONT, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT,
    color: colors.text,
  },
  overlayLine: {},
  input: {
    flex: 1,
    fontFamily: FONT, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT,
    color: 'transparent', letterSpacing: 0,
  },
  marker: { color: colors.textFaint },
  lineMarker: { color: colors.primary, fontWeight: '700' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  codeText: { color: colors.primaryDark, backgroundColor: colors.primarySoft },
  fenceLine: { color: colors.primary, fontWeight: '600' },
});

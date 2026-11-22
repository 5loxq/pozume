import React, { useMemo } from 'react';
import {
  MarkdownTextInput,
  type MarkdownRange,
} from '@expensify/react-native-live-markdown';
import { usePalette, type Palette } from '../theme';

/**
 * Live-Markdown-Eingabe (New Architecture): Formatiert Markdown-Syntax,
 * WÄHREND getippt wird — `**fett**` erscheint sofort fett, `_kursiv_`
 * kursiv, `code` als Code. Native Engine (Expensify react-native-live-
 * markdown), kein Overlay-Hack mehr.
 *
 * Der eingebaute ExpensiMark-Parser kennt `*fett*` (ein Stern) — Pozume
 * (und die eigene MarkdownView) nutzen aber `**fett**` und `_kursiv_`.
 * Deshalb eigener Worklet-Parser mit derselben Syntax und derselben
 * Kursiv-Wortgrenzen-Regel (snake_case bleibt normal), damit Editor und
 * Vorschau identisch interpretieren.
 */

/** Pozume-Markdown ⇒ Formatierungs-Bereiche (läuft als Worklet im UI-Thread) */
function parsePozumeMark(input: string): MarkdownRange[] {
  'worklet';
  const ranges: MarkdownRange[] = [];
  // Zaun-Bereiche (``` … ```) zuerst erfassen: Inline-Formatierung therein nicht anwenden
  const fences: Array<[number, number]> = [];
  const fenceRe = /^```.*$/gm;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(input)) !== null) fences.push([fm.index, fm.index + fm[0].length]);
  const inFence = (start: number, end: number) =>
    fences.some(([a, b]) => start < b && end > a);

  // Zeilenpräfixe: Überschriften, Listen, Zitate, Zaun-Zeilen
  const lineRe = /^```.*$|^(#{1,3} )|^(> )|^([-*] )|^(\d+\. )/gm;
  let lm: RegExpExecArray | null;
  while ((lm = lineRe.exec(input)) !== null) {
    const tok = lm[0];
    if (tok.startsWith('```')) {
      ranges.push({ type: 'syntax', start: lm.index, length: tok.length });
    } else {
      // Präfix als Syntax hervorheben; Überschrift/Blockquote-Inhalt formatieren
      const prefix = lm[1] ?? lm[2] ?? lm[3] ?? lm[4] ?? tok;
      ranges.push({ type: 'syntax', start: lm.index, length: prefix.length });
      if (lm[1]) {
        ranges.push({ type: 'h1', start: lm.index + prefix.length, length: tok.length - prefix.length });
      } else if (lm[2]) {
        ranges.push({ type: 'blockquote', start: lm.index + prefix.length, length: tok.length - prefix.length });
      }
    }
  }

  // Inline-Formatierung: **fett**, `code`, _kursiv_ (Wortgrenzen), [[Wiki-Link]]
  const re = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(_[^_\n]+_)|(\[\[[^\]\n]+\]\])/g;
  let m: RegExpExecArray | null;
  const push = (type: MarkdownRange['type'], start: number, length: number) =>
    ranges.push({ type, start, length });
  while ((m = re.exec(input)) !== null) {
    const tok = m[0];
    if (inFence(m.index, m.index + tok.length)) continue;
    if (m[1]) {
      push('syntax', m.index, 2);
      push('bold', m.index + 2, tok.length - 4);
      push('syntax', m.index + tok.length - 2, 2);
    } else if (m[2]) {
      push('syntax', m.index, 1);
      push('code', m.index + 1, tok.length - 2);
      push('syntax', m.index + tok.length - 1, 1);
    } else if (m[3]) {
      // Kursiv-Wortgrenzen wie in der MarkdownView: Nachbarzeichen dürfen
      // keine Buchstaben/Ziffern/Unterstriche sein (snake_case bleibt normal)
      const prev = m.index > 0 ? input[m.index - 1] : '';
      const next = m.index + tok.length < input.length ? input[m.index + tok.length] : '';
      const boundaryOk = prev !== '' ? !/[A-Za-z0-9_]/.test(prev) : true;
      const boundaryNext = next !== '' ? !/[A-Za-z0-9_]/.test(next) : true;
      if (boundaryOk && boundaryNext) {
        push('syntax', m.index, 1);
        push('italic', m.index + 1, tok.length - 2);
        push('syntax', m.index + tok.length - 1, 1);
      }
    } else if (m[4]) {
      push('link', m.index + 2, tok.length - 4);
      push('syntax', m.index, 2);
      push('syntax', m.index + tok.length - 2, 2);
    }
  }
  return ranges;
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
  // Parser außerhalb des Komponenten-Bodds (Empfehlung der Bibliothek),
  // Styles nur bei Palette-Wechsel neu erzeugen
  const markdownStyle = useMemo(() => getMarkdownStyle(colors), [colors]);
  const inputStyle = useMemo(() => ({
    fontSize: 16, lineHeight: 24, color: colors.text, minHeight: 280,
  }), [colors]);
  return (
    <MarkdownTextInput
      value={value}
      onChangeText={onChangeText}
      parser={parsePozumeMark}
      markdownStyle={markdownStyle}
      selection={selection}
      onSelectionChange={onSelectionChange}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      editable={editable}
      multiline
      textAlignVertical="top"
      style={inputStyle}
      selectionColor={colors.primary}
      scrollEnabled={false}
    />
  );
}

const getMarkdownStyle = (colors: Palette) => ({
  // Syntax-Zeichen gedimmt — der Quelltext bleibt sichtbar und editierbar.
  // Fett/Kursiv rendert die Engine nativ; hier ist nur die Farbe/etc. konfigurierbar
  syntax: { color: colors.textFaint },
  link: { color: colors.primary },
  h1: { fontSize: 18 },
  code: { color: colors.primaryDark, backgroundColor: colors.primarySoft },
});

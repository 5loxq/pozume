import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { usePalette } from '../../theme';
import { editorHtml, initCall, cmdCall, setMarkdownCall, type EditorInitPayload } from './richHtml';

/**
 * WYSIWYG-Editor (RichText) in einer sandboxed WebView: Der Nutzer sieht und
 * tippt formatierten Text — Fett/Kursiv sind echte <strong>/<em>, KEINE
 * sichtbaren Markdown-Zeichen. Die Seite konvertiert live in beide Richtungen
 * (siehe richHtml.ts); RN hält zu jedem Zeitpunkt den MARKDOWN-Stand
 * (lastMdRef), sodass Content-State, Autosave und Server unverändert
 * Markdown sehen. Toolbar-Befehle laufen über injectJavaScript (cmd).
 */

export type RichEditorHandle = {
  /** Editor-Befehl ausführen: bold|italic|code|codeblock|h2|quote|ul|ol|mermaid|undo|redo */
  cmd: (name: string) => void;
};

interface Props {
  /** Markdown-Quelltext (Server- und Preview-Format) */
  value: string;
  onChange: (md: string) => void;
  editable: boolean;
  placeholder: string;
  /** Caret-Format-Zustand für die Toolbar (b/i/c/h2/q/ul/ol) */
  onState?: (fmt: Record<string, boolean>) => void;
}

const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor({
  value, onChange, editable, placeholder, onState,
}, ref) {
  const colors = usePalette();
  // Statische Seite einmal bauen — Farben kommen per __pzInit
  const html = useMemo(() => editorHtml(), []);
  const wvRef = useRef<{ injectJavaScript: (script: string) => void } | null>(null);
  const [height, setHeight] = useState(320);
  const lastMdRef = useRef(value);
  const initializedRef = useRef(false);

  // Externe Wertänderung (nicht aus dem Editor selbst, z.B. Konflikt-Restore
  // oder Formatwechsel): Nur dann in die Seite laden, sonst Ping-Pong-Loop.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (value !== lastMdRef.current) {
      lastMdRef.current = value;
      wvRef.current?.injectJavaScript(setMarkdownCall(value));
    }
  }, [value]);

  // Editierbarkeit nach dem Initialisieren nachziehen
  useEffect(() => {
    if (!initializedRef.current) return;
    wvRef.current?.injectJavaScript(cmdCall('editable', editable ? 'yes' : 'no'));
  }, [editable]);

  const onLoadEnd = () => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const payload: EditorInitPayload = {
      md: value,
      editable,
      theme: {
        text: colors.text,
        bg: 'transparent',
        surface: colors.surface,
        placeholder: colors.textFaint,
        primary: colors.primary,
        primarySoft: colors.primarySoft,
        primaryDark: colors.primaryDark,
        border: colors.border,
      },
      placeholderText: placeholder,
    };
    lastMdRef.current = value;
    wvRef.current?.injectJavaScript(initCall(payload));
  };

  const onMessage = (ev: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(ev.nativeEvent.data);
      if (msg?.type === 'change' && typeof msg.md === 'string') {
        lastMdRef.current = msg.md;
        if (typeof msg.height === 'number') setHeight(Math.max(120, Math.min(5000, msg.height)));
        onChange(msg.md);
      } else if (msg?.type === 'state' && msg.fmt && onState) {
        onState(msg.fmt);
      }
    } catch { /* Fremde Nachrichten ignorieren */ }
  };

  useImperativeHandle(ref, () => ({
    cmd: (name: string) => { wvRef.current?.injectJavaScript(cmdCall(name)); },
  }));

  return (
    <WebView
      ref={(w) => { wvRef.current = w; }}
      source={{ html }}
      originWhitelist={['about:blank']}
      onShouldStartLoadWithRequest={(req) => req.url === 'about:blank'}
      onMessage={onMessage}
      onLoadEnd={onLoadEnd}
      setSupportMultipleWindows={false}
      javaScriptEnabled
      sharedCookiesEnabled={false}
      domStorageEnabled={false}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      style={{ height, backgroundColor: 'transparent' }}
    />
  );
});

export default RichEditor;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { usePalette, useIsDark, spacing, radius, shadow, typeFor,
  type Palette,
} from '../../theme';
import { t } from '../../i18n';
import { diagramHtml, jsSafeJson } from './mermaidHtml';
import { ensureRenderer } from './mermaidRuntime';

/**
 * Mermaid-Diagramm (2.1-2.6): rendert einen Mermaid-Quelltextblock in einer
 * sandboxed WebView mit lokal gebündelter mermaid.js (keine Netzwerkzugriffe,
 * CSP default-src 'none'). Das Ergebnis-SVG wird pro Diagramm+Theme gecacht
 * (2.5), Theme-Wechsel rendert neu (2.4), Syntaxfehler werden angezeigt und
 * der Quelltext bleibt einklappbar sichtbar (2.2/2.6). Tap öffnet das
 * Diagramm im Vollbild mit Pinch-Zoom und Verschieben (2.3).
 */

interface Rendered { svg: string; height: number }

/** SVG-Cache pro Diagramm+Theme — LRU, hält Notizen mit vielen Diagrammen flüssig (2.5) */
const renderCache = new Map<string, Rendered>();
const CACHE_MAX = 20;

function cacheGet(key: string): Rendered | undefined {
  const hit = renderCache.get(key);
  if (hit) {
    renderCache.delete(key);
    renderCache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, value: Rendered): void {
  if (renderCache.has(key)) renderCache.delete(key);
  else if (renderCache.size >= CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
  renderCache.set(key, value);
}

/** Kompakter Hash (FNV-1a) für Cache-Schlüssel von Quelltext+Theme */
function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${s.length.toString(36)}`;
}

export default function MermaidDiagram({ code }: { code: string }) {
  const dark = useIsDark();
  const key = useMemo(() => (dark ? 'd' : 'l') + hashOf(code), [code, dark]);
  return <MermaidDiagramInner key={key} code={code} cacheKey={key} dark={dark} />;
}

function MermaidDiagramInner({ code, cacheKey, dark }: { code: string; cacheKey: string; dark: boolean }) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  // Anzeige-HTML (Cache/Vollbild) ist statisch — einmal bauen, nicht je Render
  const shellHtml = useMemo(() => diagramHtml(false), []);

  const cached = cacheGet(cacheKey);
  const [svg, setSvg] = useState<string | null>(cached?.svg ?? null);
  const [height, setHeight] = useState<number>(cached?.height ?? 240);
  const [error, setError] = useState<string | null>(null);
  const [rendererUrl, setRendererUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  // Von der WebView wird nur injectJavaScript gebraucht — die Klassen-Generics
  // von react-native-webview sind für Ref-Typen unhandlich, daher strukturell
  type Injector = { injectJavaScript: (script: string) => void };
  const wvRef = useRef<Injector | null>(null);
  const fullWvRef = useRef<Injector | null>(null);
  const injectedRef = useRef(false);

  // Mermaid-Konfiguration aus der App-Palette (2.4): gleiche Farben wie der Rest der UI
  const mermaidConfig = useMemo(() => ({
    startOnLoad: false,
    securityLevel: 'strict' as const,
    theme: 'base' as const,
    themeVariables: {
      background: colors.surface,
      primaryColor: colors.primarySoft,
      primaryTextColor: colors.text,
      primaryBorderColor: colors.primary,
      secondaryColor: colors.primarySoft,
      tertiaryColor: colors.primarySoft,
      lineColor: dark ? '#7d8798' : '#5b6472',
      textColor: colors.text,
      mainBkg: colors.primarySoft,
      nodeBorder: colors.primary,
      clusterBkg: colors.primarySoft,
      clusterBorder: colors.border,
      edgeLabelBackground: colors.surface,
      fontSize: '15px',
    },
  }), [colors, dark]);

  // Renderer nur anfordern, wenn tatsächlich frisch gerendert werden muss
  useEffect(() => {
    let alive = true;
    if (!svg) {
      ensureRenderer()
        .then((url) => { if (alive) setRendererUrl(url); })
        .catch((e: unknown) => { if (alive) setError(String((e as { message?: string })?.message ?? e)); });
    }
    return () => { alive = false; };
  }, [svg]);

  const onMessage = (ev: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(ev.nativeEvent.data);
      if (msg?.type === 'rendered' && typeof msg.svg === 'string') {
        // Vollbild rendert bei anderer Breite — Messung nicht in den
        // Inline-Cache/Höhenzustand übernehmen, nur Inline zählt
        if (fullscreen) return;
        // Inline-Anzeige im Notizfluss: Höhe deckeln, sehr hohe Diagramme stauchen nicht um
        const h = Math.max(60, Math.min(560, Number(msg.height) || 240));
        const entry = { svg: msg.svg, height: h };
        cachePut(cacheKey, entry);
        injectedRef.current = true;
        setSvg(msg.svg);
        setHeight(h);
        setError(null);
      } else if (msg?.type === 'error') {
        setError(typeof msg.message === 'string' ? msg.message : 'unbekannter Fehler');
      }
    } catch { /* Nachrichten fremder Quellen ignorieren */ }
  };

  /** Fertiges SVG in die WebView setzen (Zoom je nach Kontext freischalten) */
  const injectSvg = (zoomable: boolean) => {
    if (!svg) return;
    wvRef.current?.injectJavaScript(
      `window.__pzSetupZoom(${zoomable ? 'true' : 'false'}); window.__pzInject(${jsSafeJson(svg)}); true;`,
    );
  };

  const onLoadEndRenderer = () => {
    if (injectedRef.current) return;
    injectedRef.current = true;
    wvRef.current?.injectJavaScript(
      `window.__pozumeRender(${jsSafeJson({ code, config: mermaidConfig, zoomable: false })}); true;`,
    );
  };

  const loadGuard = (req: { url: string }) => req.url === 'about:blank' || req.url === rendererUrl;

  // --- Fehler-/Fallback-Anzeige (2.6, 2.2): Fehler sichtbar, Quelltext einklappbar ---
  if (error) {
    return (
      <View style={styles.errorBlock}>
        <Text style={styles.errorTitle}>{t('mermaid.errorTitle')}</Text>
        <Text style={styles.errorText} numberOfLines={4}>{error}</Text>
        <TouchableOpacity style={styles.sourceToggle} onPress={() => setShowSource((v) => !v)}>
          <Text style={styles.sourceToggleText}>
            {showSource ? t('mermaid.hideSource') : t('mermaid.showSource')}
          </Text>
        </TouchableOpacity>
        {showSource ? (
          <View style={styles.sourceBox}>
            {code.split('\n').map((line, i) => (
              <Text key={i} style={styles.sourceLine}>{line}</Text>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  const inlineHeight = svg ? height : 220;
  return (
    <View style={[styles.block, { height: inlineHeight }]}>
      {!svg ? (
        <View style={styles.loading}>
          {rendererUrl ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      ) : null}
      {/* Diagramm inline: WebView ohne Touch (Scroll der Notiz bleibt erhalten),
          Tap-Overlay öffnet Vollbild. Erst wenn rendererUrl bereit ist, mounten —
          sonst feuert onLoadEnd ins Leere und die Injektion ginge verloren. */}
      {svg ? (
        <WebView
          key="shell"
          ref={(w) => { wvRef.current = w; }}
          source={{ html: shellHtml }}
          originWhitelist={['about:blank']}
          onShouldStartLoadWithRequest={loadGuard}
          onMessage={onMessage}
          onLoadEnd={() => injectSvg(false)}
          setSupportMultipleWindows={false}
          sharedCookiesEnabled={false}
          domStorageEnabled={false}
          javaScriptEnabled
          pointerEvents="none"
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          style={[styles.webview, { backgroundColor: 'transparent' }]}
          onError={() => setError('WebView konnte nicht geladen werden')}
        />
      ) : rendererUrl ? (
        <WebView
          key="render"
          ref={(w) => { wvRef.current = w; }}
          source={{ uri: rendererUrl }}
          originWhitelist={['file://']}
          onShouldStartLoadWithRequest={loadGuard}
          onMessage={onMessage}
          onLoadEnd={onLoadEndRenderer}
          setSupportMultipleWindows={false}
          allowFileAccess
          allowFileAccessFromFileURLs
          sharedCookiesEnabled={false}
          domStorageEnabled={false}
          javaScriptEnabled
          pointerEvents="none"
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          style={[styles.webview, { backgroundColor: 'transparent' }]}
          onError={() => setError('Renderer konnte nicht geladen werden')}
        />
      ) : null}
      {svg ? (
        <Pressable
          style={styles.tapOverlay}
          onPress={() => setFullscreen(true)}
          accessibilityLabel={t('mermaid.fullscreen')}
        />
      ) : null}

      <Modal visible={fullscreen} animationType="fade" onRequestClose={() => setFullscreen(false)}>
        <View style={styles.fullWrap}>
          <View style={[styles.fullHeader, { borderBottomColor: colors.border }]}>
            <Text style={styles.fullTitle} numberOfLines={1}>{t('mermaid.fullscreenTitle')}</Text>
            <TouchableOpacity style={styles.fullClose} onPress={() => setFullscreen(false)}
              accessibilityLabel={t('common.close')}>
              <Text style={styles.fullCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.fullBody}>
            <WebView
              ref={(w) => { fullWvRef.current = w; }}
              source={{ html: shellHtml }}
              originWhitelist={['about:blank']}
              onShouldStartLoadWithRequest={loadGuard}
              onMessage={onMessage}
              onLoadEnd={() => {
                fullWvRef.current?.injectJavaScript(
                  `window.__pzSetupZoom(true); window.__pzInject(${jsSafeJson(svg)}); true;`,
                );
              }}
              setSupportMultipleWindows={false}
              sharedCookiesEnabled={false}
              domStorageEnabled={false}
              javaScriptEnabled
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              style={[styles.webview, styles.fullWebview, { backgroundColor: colors.bg }]}
            />
          </View>
          <Text style={styles.fullHint}>{t('mermaid.zoomHint')}</Text>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  block: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, marginVertical: spacing.sm, overflow: 'hidden',
  },
  webview: { flex: 1 },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  tapOverlay: { ...StyleSheet.absoluteFillObject },
  errorBlock: {
    backgroundColor: colors.dangerSoft, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.danger, padding: spacing.md, marginVertical: spacing.sm,
  },
  errorTitle: { ...type.h2, color: colors.danger, marginBottom: spacing.xs },
  errorText: { fontFamily: 'Menlo', fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  sourceToggle: { marginTop: spacing.sm },
  sourceToggleText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  sourceBox: {
    backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginTop: spacing.sm,
  },
  sourceLine: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 18, color: colors.text },
  fullWrap: { flex: 1, backgroundColor: colors.bg },
  fullHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  fullTitle: { ...type.h2, flex: 1, marginRight: spacing.md },
  fullClose: {
    backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.lg,
    paddingVertical: 8, borderWidth: 1, borderColor: colors.border, ...shadow,
  },
  fullCloseText: { color: colors.primary, fontWeight: '700' },
  fullBody: { flex: 1 },
  fullWebview: { flex: 1 },
  fullHint: { ...type.faint(), textAlign: 'center', paddingBottom: spacing.lg },
});

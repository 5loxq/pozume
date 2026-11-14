import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, useWindowDimensions, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Text as SvgText, G } from 'react-native-svg';
import { usePalette, spacing, typeFor,
  Palette,
} from '../theme';
import { t } from '../i18n';
import type { PoznoteClient, Note, GraphNode, GraphData } from '../api';

interface Props {
  client: PoznoteClient;
  onOpenNote: (note: Note) => void;
  onBack: () => void;
}

/** Notiz-Graph: Knoten im Kreis-Layout, Kanten als Linien, Tap öffnet die Notiz */
export default function GraphScreen({ client, onOpenNote, onBack }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const { width: winW } = useWindowDimensions();
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.getGraph();
      setGraph({ nodes: res.nodes ?? [], edges: res.edges ?? [], folders: res.folders ?? [], total: res.total });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  // Kreis-Layout: Knoten gleichmäßig auf einem Ring, Ordner-Knoten als Zentren
  const layout = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const n = nodes.length;
    if (n === 0) return null;
    const W = Math.max(winW, 360);
    const R = Math.max(90, Math.min(260, 40 * Math.sqrt(n)));
    const cx = W / 2;
    const cy = R + 70;
    const H = (R + 90) * 2;
    const pos = new Map<number, { x: number; y: number }>();
    nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      pos.set(node.id, { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) });
    });
    return { W, H, pos };
  }, [graph, winW]);

  const nodeColor = (node: GraphNode): string => {
    if (node.favorite) return colors.star;
    if (node.type === 'tasklist') return colors.success;
    if (node.type === 'markdown') return colors.primary;
    return colors.accent;
  };

  const nodeRadius = (node: GraphNode): number => {
    // Grad = Anzahl Kanten am Knoten → wichtigere Notizen größer
    const deg = (graph?.edges ?? []).filter((e) => e.source === node.id || e.target === node.id).length;
    return 12 + Math.min(10, deg * 2);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🕸 {t('graph.title')}</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !layout || (graph?.nodes.length ?? 0) === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🕸</Text>
          <Text style={styles.emptyText}>{t('graph.empty')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Svg width={layout.W} height={layout.H}>
            {/* Kanten zuerst zeichnen, damit Knoten darüber liegen */}
            {(graph?.edges ?? []).map((e, i) => {
              const a = layout.pos.get(e.source);
              const b = layout.pos.get(e.target);
              if (!a || !b) return null;
              return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.border} strokeWidth={1.5} />;
            })}
            {(graph?.nodes ?? []).map((node) => {
              const p = layout.pos.get(node.id);
              if (!p) return null;
              const r = nodeRadius(node);
              const label = (node.title ?? '').slice(0, 18);
              return (
                <G key={node.id} onPress={() => onOpenNote({ id: node.id, heading: node.title })}>
                  <Circle cx={p.x} cy={p.y} r={r} fill={nodeColor(node)} opacity={0.9} />
                  <Circle cx={p.x} cy={p.y} r={r + 6} fill="transparent" stroke={colors.primary} strokeWidth={0} />
                  <SvgText
                    x={p.x} y={p.y + r + 14}
                    fontSize={11}
                    fill={colors.text}
                    textAnchor="middle"
                  >
                    {label}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
          <Text style={styles.hint}>{t('graph.hint')}</Text>
          <View style={styles.legend}>
            <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.primary }]} /><Text style={styles.legendText}>Markdown</Text></View>
            <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.accent }]} /><Text style={styles.legendText}>Rich-Text</Text></View>
            <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.success }]} /><Text style={styles.legendText}>Taskliste</Text></View>
            <View style={styles.legendRow}><View style={[styles.dot, { backgroundColor: colors.star }]} /><Text style={styles.legendText}>Favorit</Text></View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  back: { fontSize: 28, color: colors.text, width: 40 },
  title: { ...type.title, fontSize: 24, flex: 1, textAlign: 'center' },
  scroll: { alignItems: 'center', paddingBottom: spacing.xl },
  center: { alignItems: 'center', paddingVertical: 80 },
  emptyEmoji: { fontSize: 44, marginBottom: spacing.md },
  emptyText: { ...type.muted },
  hint: { ...type.faint(), marginTop: spacing.md },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.lg, justifyContent: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: colors.textMuted },
});

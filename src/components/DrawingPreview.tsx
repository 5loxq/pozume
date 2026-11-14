import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { usePalette, radius } from '../theme';
import { parseDrawing, renderDrawEl } from './DrawingEditor';

interface Props {
  content: string;
  height?: number;
}

/** Mini-Vorschau einer Zeichnung (Excalidraw-Szene oder SVG) — für Notizkarten */
export default function DrawingPreview({ content, height = 90 }: Props) {
  const colors = usePalette();
  const parsed = parseDrawing(content);
  if (!parsed || parsed.els.length === 0) return null;
  const { els, box } = parsed;
  return (
    <View style={[styles.wrap, { height, backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Svg width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet">
        <Rect x={box.x} y={box.y} width={box.w} height={box.h} fill={colors.surface} />
        {els.map((el) => renderDrawEl(el))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md, borderWidth: 1, overflow: 'hidden',
    marginTop: 6, marginBottom: 2,
  },
});

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Alert, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect, Ellipse, Line, Polygon } from 'react-native-svg';
import { usePalette, spacing, radius, typeFor, shadow,
  Palette,
} from '../theme';
import { t } from '../i18n';

/** Zeichenelement im Editor-Modell */
interface PathEl { id: string; type: 'path'; d: string; stroke: string; strokeWidth: number; fill: string }
interface RectEl { id: string; type: 'rect'; x: number; y: number; w: number; h: number; stroke: string; strokeWidth: number; fill: string }
interface EllipseEl { id: string; type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; stroke: string; strokeWidth: number; fill: string }
interface LineEl { id: string; type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; arrow: boolean }
type DrawEl = PathEl | RectEl | EllipseEl | LineEl;

type Tool = 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'erase';

const COLORS = ['#1a1a1a', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed'];
const WIDTHS = [2, 4, 8];

let elSeq = 0;
const nextId = () => `e${++elSeq}`;

/** SVG-Quelltext in Elemente + ViewBox zerlegen; unbekannte Teile roh erhalten */
function parseSvg(content: string): { elements: DrawEl[]; raw: string[]; viewBox: [number, number] } {
  const elements: DrawEl[] = [];
  const raw: string[] = [];
  let viewBox: [number, number] = [800, 1000];
  const vbMatch = content.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (vbMatch) viewBox = [parseFloat(vbMatch[1]), parseFloat(vbMatch[2])];

  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : null;
  };

  const tagRe = /<(path|rect|ellipse|line)\b[^>]*\/?>(?:<\/\1>)?/g;
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  while ((m = tagRe.exec(content)) !== null) {
    const before = content.slice(lastIdx, m.index);
    if (before.replace(/[\s<>/]|svg|g|defs|background/g, '').trim()) raw.push(before.trim());
    lastIdx = m.index + m[0].length;
    const tag = m[0];
    const stroke = attr(tag, 'stroke') ?? '#1a1a1a';
    const strokeWidth = parseFloat(attr(tag, 'stroke-width') ?? '4') || 4;
    const fill = attr(tag, 'fill') ?? 'none';
    const id = nextId();
    if (m[1] === 'path') {
      const d = attr(tag, 'd');
      if (d) elements.push({ id, type: 'path', d, stroke, strokeWidth, fill });
    } else if (m[1] === 'rect') {
      const x = parseFloat(attr(tag, 'x') ?? '0'), y = parseFloat(attr(tag, 'y') ?? '0');
      const w = parseFloat(attr(tag, 'width') ?? '0'), h = parseFloat(attr(tag, 'height') ?? '0');
      if (w > 0 && h > 0) elements.push({ id, type: 'rect', x, y, w, h, stroke, strokeWidth, fill });
    } else if (m[1] === 'ellipse') {
      const cx = parseFloat(attr(tag, 'cx') ?? '0'), cy = parseFloat(attr(tag, 'cy') ?? '0');
      const rx = parseFloat(attr(tag, 'rx') ?? '0'), ry = parseFloat(attr(tag, 'ry') ?? '0');
      if (rx > 0 && ry > 0) elements.push({ id, type: 'ellipse', cx, cy, rx, ry, stroke, strokeWidth, fill });
    } else if (m[1] === 'line') {
      elements.push({
        id, type: 'line',
        x1: parseFloat(attr(tag, 'x1') ?? '0'), y1: parseFloat(attr(tag, 'y1') ?? '0'),
        x2: parseFloat(attr(tag, 'x2') ?? '0'), y2: parseFloat(attr(tag, 'y2') ?? '0'),
        stroke, strokeWidth, arrow: false,
      });
    }
  }
  return { elements, raw, viewBox };
}

function serializeSvg(elements: DrawEl[], viewBox: [number, number]): string {
  const body = elements.map((el) => {
    switch (el.type) {
      case 'path': return `<path d="${el.d}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" fill="${el.fill}"/>`;
      case 'rect': return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" fill="${el.fill}"/>`;
      case 'ellipse': return `<ellipse cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" fill="${el.fill}"/>`;
      case 'line': {
        const line = `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}"/>`;
        if (!el.arrow) return line;
        const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
        const len = Math.max(10, el.strokeWidth * 4);
        const p1 = `${el.x2 - len * Math.cos(a - 0.5)} ${el.y2 - len * Math.sin(a - 0.5)}`;
        const p2 = `${el.x2} ${el.y2}`;
        const p3 = `${el.x2 - len * Math.cos(a + 0.5)} ${el.y2 - len * Math.sin(a + 0.5)}`;
        return `${line}<polygon points="${p1} ${p2} ${p3}" fill="${el.stroke}"/>`;
      }
    }
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox[0]} ${viewBox[1]}">${body}</svg>`;
}

interface Props {
  content: string;
  onChange: (svg: string) => void;
}

export default function DrawingEditor({ content, onChange }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const { height: winH } = useWindowDimensions();
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);

  const parsed = useMemo(() => parseSvg(content), [content]);
  const elementsRef = useRef<DrawEl[]>(parsed.elements.map((e) => ({ ...e })));
  const viewBoxRef = useRef<[number, number]>(parsed.viewBox);
  const [render, setRender] = useState(0);
  const bump = () => setRender((n) => n + 1);

  const canvasH = Math.max(320, Math.min(560, winH * 0.52));
  const scale = canvasH / viewBoxRef.current[1];
  const canvasW = viewBoxRef.current[0] * scale;

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const penPointsRef = useRef<string[]>([]);
  const dirtyRef = useRef(false);

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    onChange(serializeSvg(elementsRef.current, viewBoxRef.current));
  };

  const toCanvas = (x: number, y: number) => ({ x: x / scale, y: y / scale });

  const eraseAt = (cx: number, cy: number) => {
    const before = elementsRef.current.length;
    elementsRef.current = elementsRef.current.filter((el) => {
      const b = bounds(el);
      return !(cx >= b.x0 - 6 && cx <= b.x1 + 6 && cy >= b.y0 - 6 && cy <= b.y1 + 6);
    });
    if (elementsRef.current.length !== before) { dirtyRef.current = true; bump(); }
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { x, y } = toCanvas(e.nativeEvent.locationX, e.nativeEvent.locationY);
      startRef.current = { x, y };
      if (tool === 'pen') penPointsRef.current = [`M ${x.toFixed(1)} ${y.toFixed(1)}`];
      if (tool === 'erase') eraseAt(x, y);
    },
    onPanResponderMove: (e) => {
      const { x, y } = toCanvas(e.nativeEvent.locationX, e.nativeEvent.locationY);
      const s = startRef.current;
      if (!s) return;
      if (tool === 'pen') {
        penPointsRef.current.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
        const preview: DrawEl = { id: 'preview', type: 'path', d: penPointsRef.current.join(' '), stroke: color, strokeWidth: width, fill: 'none' };
        elementsRef.current = [...elementsRef.current.filter((el) => el.id !== 'preview'), preview];
        dirtyRef.current = true;
        bump();
      } else if (tool === 'erase') {
        eraseAt(x, y);
      } else {
        const preview = makeShape(tool, s, { x, y }, color, width);
        elementsRef.current = [...elementsRef.current.filter((el) => el.id !== 'preview'), preview];
        dirtyRef.current = true;
        bump();
      }
    },
    onPanResponderRelease: () => {
      const preview = elementsRef.current.find((el) => el.id === 'preview');
      if (preview) {
        elementsRef.current = elementsRef.current.filter((el) => el.id !== 'preview');
        if (tool === 'pen' && penPointsRef.current.length > 1) {
          elementsRef.current.push({ ...(preview as PathEl), id: nextId() });
        } else if (tool !== 'pen' && startRef.current) {
          elementsRef.current.push({ ...preview, id: nextId() } as DrawEl);
        }
        dirtyRef.current = true;
        bump();
      }
      startRef.current = null;
      commit();
    },
  })).current;

  const undo = () => {
    elementsRef.current = elementsRef.current.slice(0, -1);
    dirtyRef.current = true;
    bump();
    commit();
  };

  const clearAll = () => {
    Alert.alert(t('draw.clearTitle'), t('draw.clearText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => { elementsRef.current = []; dirtyRef.current = true; bump(); commit(); } },
    ]);
  };

  const tools: Array<[Tool, string]> = [['pen', '✏️'], ['rect', '▭'], ['ellipse', '◯'], ['line', '／'], ['arrow', '↗'], ['erase', '🧽']];

  return (
    <View style={styles.wrap}>
      <View style={[styles.toolbar, shadow]}>
        {tools.map(([tl, icon]) => (
          <TouchableOpacity key={tl} style={[styles.toolBtn, tool === tl && styles.toolBtnActive]} onPress={() => setTool(tl)}>
            <Text style={styles.toolIcon}>{icon}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.sep} />
        {COLORS.map((c) => (
          <TouchableOpacity key={c} style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]} onPress={() => setColor(c)} />
        ))}
        <View style={styles.sep} />
        {WIDTHS.map((w) => (
          <TouchableOpacity key={w} style={[styles.widthBtn, width === w && styles.widthBtnActive]} onPress={() => setWidth(w)}>
            <View style={[styles.widthDot, { width: w + 2, height: w + 2 }]} />
          </TouchableOpacity>
        ))}
        <View style={styles.sep} />
        <TouchableOpacity style={styles.toolBtn} onPress={undo}>
          <Text style={styles.toolIcon}>↩︎</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={clearAll}>
          <Text style={styles.toolIcon}>🗑</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.canvas, { width: canvasW, height: canvasH }]} {...pan.panHandlers}>
        <Svg width={canvasW} height={canvasH} viewBox={`0 0 ${viewBoxRef.current[0]} ${viewBoxRef.current[1]}`}>
          <Rect x={0} y={0} width={viewBoxRef.current[0]} height={viewBoxRef.current[1]} fill={colors.surface} />
          {elementsRef.current.map((el) => renderEl(el))}
        </Svg>
      </View>
    </View>
  );
}

function makeShape(tool: Tool, s: { x: number; y: number }, e2: { x: number; y: number }, color: string, width: number): DrawEl {
  const id = 'preview';
  if (tool === 'rect') {
    return { id, type: 'rect', x: Math.min(s.x, e2.x), y: Math.min(s.y, e2.y), w: Math.abs(e2.x - s.x), h: Math.abs(e2.y - s.y), stroke: color, strokeWidth: width, fill: 'none' };
  }
  if (tool === 'ellipse') {
    return { id, type: 'ellipse', cx: (s.x + e2.x) / 2, cy: (s.y + e2.y) / 2, rx: Math.abs(e2.x - s.x) / 2, ry: Math.abs(e2.y - s.y) / 2, stroke: color, strokeWidth: width, fill: 'none' };
  }
  return { id, type: 'line', x1: s.x, y1: s.y, x2: e2.x, y2: e2.y, stroke: color, strokeWidth: width, arrow: tool === 'arrow' };
}

function bounds(el: DrawEl): { x0: number; y0: number; x1: number; y1: number } {
  switch (el.type) {
    case 'path': {
      const nums = el.d.match(/-?[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case 'rect': return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
    case 'ellipse': return { x0: el.cx - el.rx, y0: el.cy - el.ry, x1: el.cx + el.rx, y1: el.cy + el.ry };
    case 'line': return { x0: Math.min(el.x1, el.x2), y0: Math.min(el.y1, el.y2), x1: Math.max(el.x1, el.x2), y1: Math.max(el.y1, el.y2) };
  }
}

function renderEl(el: DrawEl) {
  switch (el.type) {
    case 'path': return <Path key={el.id} d={el.d} stroke={el.stroke} strokeWidth={el.strokeWidth} fill={el.fill} />;
    case 'rect': return <Rect key={el.id} x={el.x} y={el.y} width={el.w} height={el.h} stroke={el.stroke} strokeWidth={el.strokeWidth} fill={el.fill} />;
    case 'ellipse': return <Ellipse key={el.id} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} stroke={el.stroke} strokeWidth={el.strokeWidth} fill={el.fill} />;
    case 'line': {
      const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      const len = Math.max(10, el.strokeWidth * 4);
      const p1 = `${el.x2 - len * Math.cos(a - 0.5)} ${el.y2 - len * Math.sin(a - 0.5)}`;
      const p2 = `${el.x2} ${el.y2}`;
      const p3 = `${el.x2 - len * Math.cos(a + 0.5)} ${el.y2 - len * Math.sin(a + 0.5)}`;
      return (
        <React.Fragment key={el.id}>
          <Line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.stroke} strokeWidth={el.strokeWidth} />
          {el.arrow ? <Polygon points={`${p1} ${p2} ${p3}`} fill={el.stroke} /> : null}
        </React.Fragment>
      );
    }
  }
}

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  wrap: { alignItems: 'center' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  toolBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  toolBtnActive: { backgroundColor: colors.primary },
  toolIcon: { fontSize: 16 },
  sep: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 2 },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: colors.primary },
  widthBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  widthBtnActive: { backgroundColor: colors.primarySoft },
  widthDot: { borderRadius: 8, backgroundColor: colors.text },
  canvas: {
    borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});

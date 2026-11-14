import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, PanResponder, Alert, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect, Ellipse, Line, Polygon } from 'react-native-svg';
import { usePalette, spacing, radius, typeFor, shadow,
  Palette,
} from '../theme';
import { t } from '../i18n';

/** Zeichenelement im Editor-Modell (Koordinaten absolut, SVG-artig) */
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
const randSeed = () => Math.floor(Math.random() * 2000000000);

/** Excalidraw-Szenen-JSON erkennen */
export function isExcalidrawContent(content?: string): boolean {
  if (!content) return false;
  const c = content.trimStart();
  if (!c.startsWith('{')) return false;
  try {
    const p = JSON.parse(c);
    return Array.isArray(p?.elements);
  } catch { return false; }
}

/** Excalidraw-Szene aus dem HTML einer Poznote-Excalidraw-Notiz ziehen (verstecktes div) */
export function extractExcalidrawScene(content?: string): string | null {
  if (!content) return null;
  const m = content.match(/<div class="excalidraw-data"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return null;
  return m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#039;');
}

/** HTML-Struktur einer neuen Poznote-Excalidraw-Notiz (leere Szene) */
export function emptyDrawingHtml(): string {
  const scene = JSON.stringify({ type: 'excalidraw', version: 2, source: 'pozume', elements: [], appState: {}, files: {} });
  return `<div class="excalidraw-container" contenteditable="false"><p style="text-align:center; padding: 40px; color: #999;">Excalidraw diagram</p><div class="excalidraw-data" style="display: none;">${escapeHtml(scene)}</div></div>`;
}

/** Handelt es sich um zeichenbaren Inhalt (Excalidraw-HTML, -JSON oder SVG)? */
export function isDrawingContent(content?: string): boolean {
  if (!content) return false;
  const c = content.trimStart();
  return c.includes('excalidraw-data') || c.includes('data-is-excalidraw') || isExcalidrawContent(c) || c.startsWith('<svg');
}

interface ExcElement { [k: string]: unknown }

/** Excalidraw-Elemente in das Editor-Modell überführen; nicht editierbare bleiben roh erhalten */
function fromExcalidraw(elements: ExcElement[]): { els: DrawEl[]; raw: ExcElement[] } {
  const els: DrawEl[] = [];
  const raw: ExcElement[] = [];
  for (const e of elements) {
    const type = e.type as string;
    const stroke = (e.strokeColor as string) || '#1a1a1a';
    const sw = typeof e.strokeWidth === 'number' ? e.strokeWidth * 1.6 : 4;
    const bg = (e.backgroundColor as string) || 'transparent';
    const fill = bg === 'transparent' ? 'none' : bg;
    const x = (e.x as number) ?? 0;
    const y = (e.y as number) ?? 0;
    const w = (e.width as number) ?? 0;
    const h = (e.height as number) ?? 0;
    const id = nextId();
    if (type === 'rectangle' && w > 0 && h > 0) {
      els.push({ id, type: 'rect', x, y, w, h, stroke, strokeWidth: sw, fill });
    } else if (type === 'ellipse' && w > 0 && h > 0) {
      els.push({ id, type: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, stroke, strokeWidth: sw, fill });
    } else if (type === 'diamond' && w > 0 && h > 0) {
      const cx = x + w / 2, cy = y + h / 2;
      els.push({ id, type: 'path', d: `M ${cx} ${y} L ${x + w} ${cy} L ${cx} ${y + h} L ${x} ${cy} Z`, stroke, strokeWidth: sw, fill });
    } else if ((type === 'line' || type === 'arrow') && Array.isArray(e.points)) {
      const pts = e.points as Array<[number, number]>;
      if (pts.length >= 2) {
        const first = pts[0], last = pts[pts.length - 1];
        els.push({ id, type: 'line', x1: x + first[0], y1: y + first[1], x2: x + last[0], y2: y + last[1], stroke, strokeWidth: sw, arrow: type === 'arrow' });
      }
    } else if (type === 'freedraw' && Array.isArray(e.points)) {
      const pts = e.points as Array<[number, number]>;
      if (pts.length >= 2) {
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(x + p[0]).toFixed(1)} ${(y + p[1]).toFixed(1)}`).join(' ');
        els.push({ id, type: 'path', d, stroke, strokeWidth: sw, fill: 'none' });
      }
    } else {
      raw.push(e);
    }
  }
  return { els, raw };
}

/** Editor-Modell zurück in Excalidraw-Elemente */
function toExcalidraw(els: DrawEl[], raw: ExcElement[]): ExcElement[] {
  const now = Date.now();
  const base = (id: string) => ({
    id, angle: 0, fillStyle: 'solid', strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], seed: randSeed(), version: 1, versionNonce: randSeed(),
    isDeleted: false, boundElements: null, updated: now, link: null, locked: false,
  });
  const out: ExcElement[] = raw.map((e) => e);
  for (const el of els) {
    const fill = el.type === 'line' ? 'none' : el.fill;
    const common = { ...base(el.id), strokeColor: el.stroke, strokeWidth: Math.max(1, Math.round(el.strokeWidth / 1.6)), backgroundColor: fill === 'none' ? 'transparent' : fill };
    switch (el.type) {
      case 'rect':
        out.push({ ...common, type: 'rectangle', x: el.x, y: el.y, width: el.w, height: el.h });
        break;
      case 'ellipse':
        out.push({ ...common, type: 'ellipse', x: el.cx - el.rx, y: el.cy - el.ry, width: el.rx * 2, height: el.ry * 2 });
        break;
      case 'line':
        out.push({
          ...common, type: el.arrow ? 'arrow' : 'line',
          x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2),
          width: Math.abs(el.x2 - el.x1), height: Math.abs(el.y2 - el.y1),
          points: [[el.x1 - Math.min(el.x1, el.x2), el.y1 - Math.min(el.y1, el.y2)], [el.x2 - Math.min(el.x1, el.x2), el.y2 - Math.min(el.y1, el.y2)]],
          lastPointArrows: el.arrow ? ['end'] : null,
        });
        break;
      case 'path': {
        const nums = el.d.match(/-?[\d.]+/g)?.map(Number) ?? [];
        const xs = nums.filter((_, i) => i % 2 === 0);
        const ys = nums.filter((_, i) => i % 2 === 1);
        if (xs.length < 2) break;
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const pts: Array<[number, number]> = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i] - minX, nums[i + 1] - minY]);
        out.push({
          ...common, type: 'freedraw',
          x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY,
          points: pts, pressures: pts.map(() => 0.5), simulatePressure: false,
        });
        break;
      }
    }
  }
  return out;
}

/** SVG-Quelltext in Elemente zerlegen */
function parseSvg(content: string): { els: DrawEl[]; viewBox: [number, number] } {
  const els: DrawEl[] = [];
  let viewBox: [number, number] = [800, 1000];
  const vbMatch = content.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (vbMatch) viewBox = [parseFloat(vbMatch[1]), parseFloat(vbMatch[2])];
  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : null;
  };
  const tagRe = /<(path|rect|ellipse|line)\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    const tag = m[0];
    const stroke = attr(tag, 'stroke') ?? '#1a1a1a';
    const strokeWidth = parseFloat(attr(tag, 'stroke-width') ?? '4') || 4;
    const fill = attr(tag, 'fill') ?? 'none';
    const id = nextId();
    if (m[1] === 'path') {
      const d = attr(tag, 'd');
      if (d) els.push({ id, type: 'path', d, stroke, strokeWidth, fill });
    } else if (m[1] === 'rect') {
      const x = parseFloat(attr(tag, 'x') ?? '0'), y = parseFloat(attr(tag, 'y') ?? '0');
      const w = parseFloat(attr(tag, 'width') ?? '0'), h = parseFloat(attr(tag, 'height') ?? '0');
      if (w > 0 && h > 0) els.push({ id, type: 'rect', x, y, w, h, stroke, strokeWidth, fill });
    } else if (m[1] === 'ellipse') {
      const cx = parseFloat(attr(tag, 'cx') ?? '0'), cy = parseFloat(attr(tag, 'cy') ?? '0');
      const rx = parseFloat(attr(tag, 'rx') ?? '0'), ry = parseFloat(attr(tag, 'ry') ?? '0');
      if (rx > 0 && ry > 0) els.push({ id, type: 'ellipse', cx, cy, rx, ry, stroke, strokeWidth, fill });
    } else if (m[1] === 'line') {
      els.push({
        id, type: 'line',
        x1: parseFloat(attr(tag, 'x1') ?? '0'), y1: parseFloat(attr(tag, 'y1') ?? '0'),
        x2: parseFloat(attr(tag, 'x2') ?? '0'), y2: parseFloat(attr(tag, 'y2') ?? '0'),
        stroke, strokeWidth, arrow: false,
      });
    }
  }
  return { els, viewBox };
}

function serializeSvg(els: DrawEl[], viewBox: [number, number]): string {
  const body = els.map((el) => {
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
  /** true = beim Speichern in die Poznote-Excalidraw-HTML-Struktur wandeln (SVG-Anhang-Fallback) */
  saveAsExcalidrawHtml?: boolean;
  onChange: (next: string) => void;
}

export default function DrawingEditor({ content, saveAsExcalidrawHtml, onChange }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  const styles = getStyles(colors, type);
  const { height: winH } = useWindowDimensions();
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);

  // Einmalige Initialisierung aus dem Inhalt (Excalidraw-HTML, -JSON oder SVG)
  const init = useMemo(() => {
    const sceneJson = extractExcalidrawScene(content) ?? (isExcalidrawContent(content) ? content.trimStart() : null);
    if (sceneJson) {
      const scene = JSON.parse(sceneJson);
      const { els, raw } = fromExcalidraw(scene.elements ?? []);
      let maxX = 100, maxY = 100;
      for (const e of scene.elements ?? []) {
        maxX = Math.max(maxX, ((e.x as number) ?? 0) + ((e.width as number) ?? 0));
        maxY = Math.max(maxY, ((e.y as number) ?? 0) + ((e.height as number) ?? 0));
      }
      return {
        els, raw,
        viewBox: [Math.min(4000, Math.ceil(maxX / 100) * 100 + 100), Math.min(4000, Math.ceil(maxY / 100) * 100 + 100)] as [number, number],
        excalidraw: true,
        html: content.includes('excalidraw-data'),
        originalHtml: content,
        appState: scene.appState ?? {},
        files: scene.files ?? {},
      };
    }
    const { els, viewBox } = parseSvg(content);
    return { els, raw: [] as ExcElement[], viewBox, excalidraw: false, html: false, originalHtml: '', appState: {}, files: {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elementsRef = useRef<DrawEl[]>(init.els.map((e) => ({ ...e })));
  const rawRef = useRef<ExcElement[]>(init.raw);
  const viewBoxRef = useRef<[number, number]>(init.viewBox);
  const [render, setRender] = useState(0);
  const bump = () => setRender((n) => n + 1);

  const canvasH = Math.max(320, Math.min(560, winH * 0.52));
  const scale = canvasH / viewBoxRef.current[1];
  const canvasW = Math.min(viewBoxRef.current[0] * scale, 3400);

  const canvasRef = useRef<View>(null);
  const canvasOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const measuredOnce = useRef(false);
  const measureCanvas = () => {
    canvasRef.current?.measureInWindow((wx, wy) => {
      canvasOrigin.current = { x: wx, y: wy };
      measuredOnce.current = true;
    });
  };
  const toLocal = (pageX: number, pageY: number) => {
    if (!measuredOnce.current) measureCanvas();
    return toCanvas(pageX - canvasOrigin.current.x, pageY - canvasOrigin.current.y);
  };

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const penPointsRef = useRef<string[]>([]);
  const dirtyRef = useRef(false);

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    if (init.excalidraw) {
      const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'pozume', elements: toExcalidraw(elementsRef.current, rawRef.current), appState: init.appState, files: init.files });
      if (init.html) {
        // Poznote-HTML: nur das versteckte Szenen-Div austauschen, <img> (Vorschau) bleibt stehen
        const next = init.originalHtml.replace(
          /(<div class="excalidraw-data"[^>]*>)[\s\S]*?(<\/div>)/,
          `$1${escapeHtml(json)}$2`,
        );
        onChange(next);
      } else {
        onChange(json);
      }
    } else if (saveAsExcalidrawHtml) {
      // SVG-Anhang-Fallback: Elemente ins Excalidraw-Format wandeln, damit die Web-UI editieren kann
      const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'pozume', elements: toExcalidraw(elementsRef.current, []), appState: {}, files: {} });
      onChange(`<div class="excalidraw-container" contenteditable="false"><p style="text-align:center; padding: 40px; color: #999;">Excalidraw diagram</p><div class="excalidraw-data" style="display: none;">${escapeHtml(json)}</div></div>`);
    } else {
      onChange(serializeSvg(elementsRef.current, viewBoxRef.current));
    }
  };

  const toCanvas = (x: number, y: number) => ({ x: x / scale, y: y / scale });

  const eraseAt = (cx: number, cy: number) => {
    const before = elementsRef.current.length;
    elementsRef.current = elementsRef.current.filter((el) => {
      const b = bounds(el);
      return !(cx >= b.x0 - 8 && cx <= b.x1 + 8 && cy >= b.y0 - 8 && cy <= b.y1 + 8);
    });
    if (elementsRef.current.length !== before) { dirtyRef.current = true; bump(); }
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      measureCanvas();
      const { x, y } = toLocal(e.nativeEvent.pageX, e.nativeEvent.pageY);
      startRef.current = { x, y };
      if (tool === 'pen') penPointsRef.current = [`M ${x.toFixed(1)} ${y.toFixed(1)}`];
      if (tool === 'erase') eraseAt(x, y);
    },
    onPanResponderMove: (e) => {
      const { x, y } = toLocal(e.nativeEvent.pageX, e.nativeEvent.pageY);
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
    if (elementsRef.current.length === 0) return;
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
      <View ref={canvasRef} style={[styles.canvas, { width: canvasW, height: canvasH }]} {...pan.panHandlers}>
        <Svg width={canvasW} height={canvasH} pointerEvents="none" viewBox={`0 0 ${viewBoxRef.current[0]} ${viewBoxRef.current[1]}`}>
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

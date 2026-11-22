import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, PanResponder, Alert, Modal, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect, Ellipse, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { usePalette, spacing, radius, typeFor, shadow,
  Palette,
} from '../theme';
import { t } from '../i18n';

/** Zeichenelement im Editor-Modell (Koordinaten absolut, SVG-artig) */
export interface PathEl { id: string; type: 'path'; d: string; stroke: string; strokeWidth: number; fill: string }
export interface RectEl { id: string; type: 'rect'; x: number; y: number; w: number; h: number; stroke: string; strokeWidth: number; fill: string }
export interface EllipseEl { id: string; type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; stroke: string; strokeWidth: number; fill: string }
export interface LineEl { id: string; type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; arrow: boolean }
export interface TextEl { id: string; type: 'text'; x: number; y: number; w: number; h: number; text: string; fontSize: number; color: string }
export type DrawEl = PathEl | RectEl | EllipseEl | LineEl | TextEl;

type Tool = 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'erase';

/** Sichtfenster der Canvas (Zoom + Pan): Szene-Ausschnitt, der gerendert wird */
interface ViewPort { z: number; x: number; y: number }
/** Zustands-Snapshot für die Undo/Redo-Historie (1.7) */
interface EditorSnap { els: DrawEl[]; viewBox: [number, number] }

const COLORS = ['#1a1a1a', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed'];
const WIDTHS = [2, 4, 8];
const TEXT_FONT_SIZE = 20;
/** Grobe Breitenschätzung für Text (Excalidraw nutzt die echten Maße, wir approximieren) */
const textWidth = (s: string, fontSize: number) => Math.max(10, s.length * fontSize * 0.6);

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
    } else if (type === 'text' && typeof e.text === 'string') {
      const fontSize = (e.fontSize as number) ?? TEXT_FONT_SIZE;
      els.push({
        id, type: 'text', x, y,
        w: w > 0 ? w : textWidth(e.text as string, fontSize),
        h: h > 0 ? h : fontSize * 1.25,
        text: e.text as string, fontSize, color: stroke,
      });
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
    if (el.type === 'text') {
      out.push({
        ...base(el.id), type: 'text', strokeColor: el.color, strokeWidth: 1, backgroundColor: 'transparent',
        x: el.x, y: el.y, width: el.w, height: el.h,
        text: el.text, fontSize: el.fontSize, baseline: el.fontSize * 0.8,
        textAlign: 'left', verticalAlign: 'top', containerId: null, originalText: el.text,
      });
      continue;
    }
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
        if (nums.length < 4) break;
        // Bounds per Schleife — Spread über 10.000+ Punkte wirft RangeError
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          if (nums[i] < minX) minX = nums[i];
          if (nums[i + 1] < minY) minY = nums[i + 1];
          if (nums[i] > maxX) maxX = nums[i];
          if (nums[i + 1] > maxY) maxY = nums[i + 1];
        }
        const pts: Array<[number, number]> = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i] - minX, nums[i + 1] - minY]);
        out.push({
          ...common, type: 'freedraw',
          x: minX, y: minY, width: maxX - minX, height: maxY - minY,
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
  const vbMatch = content.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
  if (vbMatch) viewBox = [parseFloat(vbMatch[3]), parseFloat(vbMatch[4])];
  const attr = (tag: string, name: string): string | null => {
    // Attributname durch Nicht-Wordzeichen abgrenzen — sonst matcht z.B. 'd="…"'
    // fälschlich das 'd' am Ende von 'stroke-width="…"'
    const m = tag.match(new RegExp(`(?:^|[\\s])${name}="([^"]*)"`));
    return m ? m[1] : null;
  };
  const tagRe = /<(path|rect|ellipse|line|text)\b[^>]*\/?>(?:([\s\S]*?)<\/\1>)?/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    const tag = m[0];
    const inner = m[2] ?? '';
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
    } else if (m[1] === 'text') {
      const x = parseFloat(attr(tag, 'x') ?? '0'), y = parseFloat(attr(tag, 'y') ?? '0');
      const fontSize = parseFloat(attr(tag, 'font-size') ?? String(TEXT_FONT_SIZE)) || TEXT_FONT_SIZE;
      const text = inner
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim();
      if (text) {
        // SVG-y ist die Baseline — im Modell speichern wir die Box-Oberkante
        const top = y - fontSize * 0.8;
        els.push({ id, type: 'text', x, y: top, w: textWidth(text, fontSize), h: fontSize * 1.25, text, fontSize, color: fill !== 'none' ? fill : stroke });
      }
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
      case 'text': return `<text x="${el.x}" y="${el.y + el.fontSize * 0.8}" font-size="${el.fontSize}" fill="${el.color}">${escapeHtml(el.text)}</text>`;
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

/** Bounding-Box eines Elements (für Radierer und Vorschau) */
export function drawElBounds(el: DrawEl): { x0: number; y0: number; x1: number; y1: number } {
  switch (el.type) {
    case 'path': {
      const nums = el.d.match(/-?[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      // Reduktion per Schleife — Math.min(...xs) wirft bei langen Freihandstrichen
      // (10.000+ Punkte) einen RangeError (Maximum call stack size exceeded)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        if (nums[i] < x0) x0 = nums[i];
        if (nums[i + 1] < y0) y0 = nums[i + 1];
        if (nums[i] > x1) x1 = nums[i];
        if (nums[i + 1] > y1) y1 = nums[i + 1];
      }
      return { x0, y0, x1, y1 };
    }
    case 'rect': return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
    case 'ellipse': return { x0: el.cx - el.rx, y0: el.cy - el.ry, x1: el.cx + el.rx, y1: el.cy + el.ry };
    case 'line': return { x0: Math.min(el.x1, el.x2), y0: Math.min(el.y1, el.y2), x1: Math.max(el.x1, el.x2), y1: Math.max(el.y1, el.y2) };
    case 'text': return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + el.h };
  }
}

/** Zeichnungsinhalt parsen (Excalidraw-HTML, -JSON oder SVG) — für Editor und Vorschau */
export function parseDrawing(content: string): { els: DrawEl[]; box: { x: number; y: number; w: number; h: number } } | null {
  const sceneJson = extractExcalidrawScene(content) ?? (isExcalidrawContent(content) ? content.trimStart() : null);
  let els: DrawEl[];
  if (sceneJson) {
    try {
      const scene = JSON.parse(sceneJson);
      els = fromExcalidraw(scene.elements ?? []).els;
    } catch { return null; }
  } else if (content.trimStart().startsWith('<svg')) {
    els = parseSvg(content).els;
  } else {
    return null;
  }
  if (els.length === 0) return { els, box: { x: 0, y: 0, w: 100, h: 60 } };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of els) {
    const b = drawElBounds(el);
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  const pad = 12;
  return { els, box: { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 } };
}

/** Ein Modellelement als SVG-React-Node zeichnen (Editor-Canvas und Vorschau) */
export function renderDrawEl(el: DrawEl): React.ReactNode {
  switch (el.type) {
    case 'path': return <Path key={el.id} d={el.d} stroke={el.stroke} strokeWidth={el.strokeWidth} fill={el.fill} />;
    case 'rect': return <Rect key={el.id} x={el.x} y={el.y} width={el.w} height={el.h} stroke={el.stroke} strokeWidth={el.strokeWidth} fill={el.fill} />;
    case 'ellipse': return <Ellipse key={el.id} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} stroke={el.stroke} strokeWidth={el.strokeWidth} fill={el.fill} />;
    case 'text': return (
      <SvgText key={el.id} x={el.x} y={el.y + el.fontSize * 0.8} fontSize={el.fontSize} fill={el.color}>
        {el.text}
      </SvgText>
    );
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

interface Props {
  content: string;
  /** true = beim Speichern in die Poznote-Excalidraw-HTML-Struktur wandeln (SVG-Anhang-Fallback) */
  saveAsExcalidrawHtml?: boolean;
  onChange: (next: string) => void;
}

export default function DrawingEditor({ content, saveAsExcalidrawHtml, onChange }: Props) {
  const colors = usePalette();
  const type = typeFor(colors);
  // StyleSheet.create ist teuer — nur bei Palette-Wechsel neu erzeugen
  const styles = useMemo(() => getStyles(colors, type), [colors]);
  const { height: winH } = useWindowDimensions();
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  // Text-Werkzeug: Position des Taps merken, Eingabe im Modal
  const [textPrompt, setTextPrompt] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState('');

  // Einmalige Initialisierung aus dem Inhalt (Excalidraw-HTML, -JSON oder SVG)
  const init = useMemo(() => {
    const sceneJson = extractExcalidrawScene(content) ?? (isExcalidrawContent(content) ? content.trimStart() : null);
    if (sceneJson) {
      // Kaputte Szenen (ungültiges JSON) dürfen den Editor nicht crashen — leere Szene als Fallback
      let scene: { elements?: ExcElement[]; appState?: unknown; files?: unknown } | null = null;
      try {
        scene = JSON.parse(sceneJson);
      } catch {
        scene = null;
      }
      if (scene) {
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
          appState: (scene.appState as object) ?? {},
          files: (scene.files as object) ?? {},
        };
      }
    }
    const { els, viewBox } = parseSvg(content);
    return { els, raw: [] as ExcElement[], viewBox, excalidraw: false, html: false, originalHtml: '', appState: {}, files: {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elementsRef = useRef<DrawEl[]>(init.els.map((e) => ({ ...e })));
  const rawRef = useRef<ExcElement[]>(init.raw);
  const viewBoxRef = useRef<[number, number]>(init.viewBox);
  const [, setRender] = useState(0);
  const bump = () => setRender((n) => n + 1);

  // Zoom + Pan (1.8): sichtbarer Szenen-Ausschnitt; z=1 zeigt die ganze Fläche
  const [view, setView] = useState<ViewPort>({ z: 1, x: 0, y: 0 });
  const viewRef = useRef<ViewPort>(view);
  const setViewSync = (next: ViewPort) => {
    viewRef.current = clampView(next);
    setView(viewRef.current);
  };
  const clampView = (v: ViewPort): ViewPort => {
    const [vw, vh] = viewBoxRef.current;
    const visW = vw / v.z, visH = vh / v.z;
    const m = 60; // etwas Überziehen erlauben, damit Ränder erreichbar bleiben
    return {
      z: v.z,
      x: Math.max(-m, Math.min(v.x, Math.max(-m, vw - visW + m))),
      y: Math.max(-m, Math.min(v.y, Math.max(-m, vh - visH + m))),
    };
  };

  // Zwei-Finger-Pinch: Ausgangszustand beim Geste-Beginn
  const pinchRef = useRef<{ d0: number; z0: number; x0: number; y0: number; m0x: number; m0y: number } | null>(null);

  // Undo/Redo-Historie (1.7): Snapshots des Zustands VOR jeder Änderung
  const historyRef = useRef<EditorSnap[]>([]);
  const redoRef = useRef<EditorSnap[]>([]);
  const gestureSnapRef = useRef<EditorSnap | null>(null);
  const HISTORY_MAX = 60;
  const snapCurrent = (): EditorSnap => ({
    els: elementsRef.current.filter((e) => e.id !== 'preview').map((e) => ({ ...e })),
    viewBox: [viewBoxRef.current[0], viewBoxRef.current[1]],
  });
  const sameSnap = (a: EditorSnap, b: EditorSnap): boolean =>
    a.viewBox[0] === b.viewBox[0] && a.viewBox[1] === b.viewBox[1]
    && JSON.stringify(a.els) === JSON.stringify(b.els);
  const pushHistory = (s: EditorSnap) => {
    historyRef.current.push(s);
    if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift();
    redoRef.current = [];
  };
  const applySnap = (s: EditorSnap) => {
    elementsRef.current = s.els.map((e) => ({ ...e }));
    viewBoxRef.current = [s.viewBox[0], s.viewBox[1]];
    viewRef.current = clampView(viewRef.current);
    setView(viewRef.current);
    dirtyRef.current = true;
    bump();
    commit();
  };
  const undo = () => {
    const h = historyRef.current;
    if (h.length === 0) return;
    const before = h.pop()!;
    redoRef.current.push(snapCurrent());
    applySnap(before);
  };
  const redo = () => {
    const r = redoRef.current;
    if (r.length === 0) return;
    const next = r.pop()!;
    historyRef.current.push(snapCurrent());
    applySnap(next);
  };
  const zoomBy = (factor: number) => {
    const [vw, vh] = viewBoxRef.current;
    const v = viewRef.current;
    const z1 = Math.max(1, Math.min(12, v.z * factor));
    // um die Mitte des aktuellen Ausschnitts zoomen
    const cx = v.x + vw / v.z / 2, cy = v.y + vh / v.z / 2;
    setViewSync({ z: z1, x: cx - vw / z1 / 2, y: cy - vh / z1 / 2 });
  };
  const zoomReset = () => setViewSync({ z: 1, x: 0, y: 0 });

  const canvasH = Math.max(320, Math.min(560, winH * 0.52));
  const scale = canvasH / viewBoxRef.current[1];
  const canvasW = Math.min(viewBoxRef.current[0] * scale, 3400);
  // Zeichen-Hintergrund: Excalidraw-Szenen tragen ihre eigene Hintergrundfarbe
  // (in der Regel Weiß). Der Farbstift-Default (#1a1a1a) und importierte
  // Striche sind für DIESEN Grund definiert — ein themenabhängiger (dunkler)
  // Canvas-Hintergrund macht Schwarztinte unsichtbar (#Dark-Mode-Bug).
  const canvasBg = (init.appState as { viewBackgroundColor?: string } | null)?.viewBackgroundColor || '#ffffff';

  // Neueste Werte für die Pan-Handler und commit(): useRef(PanResponder.create(...))
  // behält die erste Instanz — ohne diesen Ref würden Tool/Farbe/Breite dauerhaft
  // die Werte des ersten Renders verwenden und onChange wäre veraltet.
  const latest = useRef({ tool, color, width, scale, onChange, saveAsExcalidrawHtml });
  latest.current = { tool, color, width, scale, onChange, saveAsExcalidrawHtml };

  /** viewBox mitwachsen lassen, damit neue Elemente nicht abgeschnitten werden */
  const growViewBox = (el: DrawEl) => {
    const b = drawElBounds(el);
    const [vw, vh] = viewBoxRef.current;
    let nextW = vw, nextH = vh;
    if (b.x1 > vw) nextW = Math.min(4000, Math.ceil(b.x1 / 100) * 100 + 100);
    if (b.y1 > vh) nextH = Math.min(4000, Math.ceil(b.y1 / 100) * 100 + 100);
    viewBoxRef.current = [nextW, nextH];
  };

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const penPointsRef = useRef<string[]>([]);
  const dirtyRef = useRef(false);

  const commit = () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    // onChange über latest — commit läuft auch aus den (stale) Pan-Handlern
    const change = latest.current.onChange;
    if (init.excalidraw) {
      const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'pozume', elements: toExcalidraw(elementsRef.current, rawRef.current), appState: init.appState, files: init.files });
      if (init.html) {
        // Poznote-HTML: nur das versteckte Szenen-Div austauschen, <img> (Vorschau) bleibt stehen.
        // Replacer-Funktion statt String — im Ersatztext wären $&, $`, $' … sonst Sonderbedeutung.
        const next = init.originalHtml.replace(
          /(<div class="excalidraw-data"[^>]*>)[\s\S]*?(<\/div>)/,
          (_m, p1, p2) => p1 + escapeHtml(json) + p2,
        );
        change(next);
      } else {
        change(json);
      }
    } else if (latest.current.saveAsExcalidrawHtml) {
      // SVG-Anhang-Fallback: Elemente ins Excalidraw-Format wandeln, damit die Web-UI editieren kann
      const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'pozume', elements: toExcalidraw(elementsRef.current, []), appState: {}, files: {} });
      change(`<div class="excalidraw-container" contenteditable="false"><p style="text-align:center; padding: 40px; color: #999;">Excalidraw diagram</p><div class="excalidraw-data" style="display: none;">${escapeHtml(json)}</div></div>`);
    } else {
      change(serializeSvg(elementsRef.current, viewBoxRef.current));
    }
  };

  const eraseAt = (cx: number, cy: number) => {
    const before = elementsRef.current.length;
    elementsRef.current = elementsRef.current.filter((el) => {
      const b = drawElBounds(el);
      return !(cx >= b.x0 - 8 && cx <= b.x1 + 8 && cy >= b.y0 - 8 && cy <= b.y1 + 8);
    });
    if (elementsRef.current.length !== before) { dirtyRef.current = true; bump(); }
  };

  const addText = () => {
    const pos = textPrompt;
    setTextPrompt(null);
    const text = textDraft.trim();
    setTextDraft('');
    if (!pos || !text) return;
    pushHistory(snapCurrent());
    elementsRef.current.push({
      id: nextId(), type: 'text',
      x: pos.x, y: pos.y,
      w: textWidth(text, TEXT_FONT_SIZE), h: TEXT_FONT_SIZE * 1.25,
      text, fontSize: TEXT_FONT_SIZE, color,
    });
    growViewBox(elementsRef.current[elementsRef.current.length - 1]);
    dirtyRef.current = true;
    bump();
    commit();
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const L = latest.current;
      // Zwei-Finger-Geste ab Start: Zoom + Pan statt Zeichnen (1.8)
      const ts = e.nativeEvent.touches;
      if (ts.length >= 2) {
        const dx = ts[1].pageX - ts[0].pageX, dy = ts[1].pageY - ts[0].pageY;
        const v = viewRef.current;
        pinchRef.current = {
          d0: Math.sqrt(dx * dx + dy * dy) || 1, z0: v.z, x0: v.x, y0: v.y,
          m0x: (ts[0].pageX + ts[1].pageX) / 2, m0y: (ts[0].pageY + ts[1].pageY) / 2,
        };
        gestureSnapRef.current = null;
        startRef.current = null;
        return;
      }
      // locationX/Y sind bereits relativ zum Canvas-View — kein measureInWindow nötig
      // (das ist async und lieferte in einer ScrollView je nach Scrollstand falsche Werte)
      const eff = L.scale * viewRef.current.z;
      const x = viewRef.current.x + e.nativeEvent.locationX / eff;
      const y = viewRef.current.y + e.nativeEvent.locationY / eff;
      // Zustand VOR der (möglichen) Änderung für die Undo-Historie merken (1.7)
      gestureSnapRef.current = snapCurrent();
      startRef.current = { x, y };
      if (L.tool === 'pen') penPointsRef.current = [`M ${x.toFixed(1)} ${y.toFixed(1)}`];
      if (L.tool === 'erase') eraseAt(x, y);
      if (L.tool === 'text') {
        // Text an der Tap-Position platzieren — Eingabe im Modal (plattformübergreifend)
        setTextDraft('');
        setTextPrompt({ x, y });
      }
    },
    onPanResponderMove: (e) => {
      const L = latest.current;
      const ts = e.nativeEvent.touches;
      // Zweiter Finger kommt mitten in einer laufenden Geste dazu: Zeichnen
      // abbrechen (Preview entfernen) und in den Zoom/Pan-Modus wechseln.
      // PanResponder feuert onPanResponderGrant nur zur ersten Berührung.
      if (!pinchRef.current && ts.length >= 2) {
        if (elementsRef.current.some((el) => el.id === 'preview')) {
          elementsRef.current = elementsRef.current.filter((el) => el.id !== 'preview');
          dirtyRef.current = true;
          bump();
          commit();
        }
        const v = viewRef.current;
        const ddx = ts[1].pageX - ts[0].pageX, ddy = ts[1].pageY - ts[0].pageY;
        pinchRef.current = {
          d0: Math.sqrt(ddx * ddx + ddy * ddy) || 1, z0: v.z, x0: v.x, y0: v.y,
          m0x: (ts[0].pageX + ts[1].pageX) / 2, m0y: (ts[0].pageY + ts[1].pageY) / 2,
        };
        startRef.current = null;
        gestureSnapRef.current = null;
        penPointsRef.current = [];
        return;
      }
      // laufende Zwei-Finger-Geste: Zoom um Fingerspitzen-Abstand, Fenster
      // mit dem Mittelpunkt verschieben — Szenenkoordinaten bleiben fix
      if (pinchRef.current) {
        if (ts.length >= 2) {
          const p = pinchRef.current;
          const dx = ts[1].pageX - ts[0].pageX, dy = ts[1].pageY - ts[0].pageY;
          const z1 = Math.max(1, Math.min(12, p.z0 * ((Math.sqrt(dx * dx + dy * dy) || 1) / p.d0)));
          const eff = L.scale * z1;
          const mx = (ts[0].pageX + ts[1].pageX) / 2, my = (ts[0].pageY + ts[1].pageY) / 2;
          setViewSync({ z: z1, x: p.x0 - (mx - p.m0x) / eff, y: p.y0 - (my - p.m0y) / eff });
        }
        return;
      }
      if (L.tool === 'text') return;
      const eff = L.scale * viewRef.current.z;
      const x = viewRef.current.x + e.nativeEvent.locationX / eff;
      const y = viewRef.current.y + e.nativeEvent.locationY / eff;
      const s = startRef.current;
      if (!s) return;
      if (L.tool === 'pen') {
        penPointsRef.current.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
        const preview: DrawEl = { id: 'preview', type: 'path', d: penPointsRef.current.join(' '), stroke: L.color, strokeWidth: L.width, fill: 'none' };
        elementsRef.current = [...elementsRef.current.filter((el) => el.id !== 'preview'), preview];
        dirtyRef.current = true;
        bump();
      } else if (L.tool === 'erase') {
        eraseAt(x, y);
      } else {
        const preview = makeShape(L.tool, s, { x, y }, L.color, L.width);
        elementsRef.current = [...elementsRef.current.filter((el) => el.id !== 'preview'), preview];
        dirtyRef.current = true;
        bump();
      }
    },
    onPanResponderRelease: () => {
      const L = latest.current;
      if (pinchRef.current) {
        pinchRef.current = null;
        gestureSnapRef.current = null;
        startRef.current = null;
        return;
      }
      if (L.tool === 'text') { startRef.current = null; gestureSnapRef.current = null; return; }
      const preview = elementsRef.current.find((el) => el.id === 'preview');
      let added: DrawEl | null = null;
      if (preview) {
        elementsRef.current = elementsRef.current.filter((el) => el.id !== 'preview');
        if (L.tool === 'pen' && penPointsRef.current.length > 1) {
          added = { ...(preview as PathEl), id: nextId() };
        } else if (L.tool !== 'pen' && startRef.current) {
          // Degenerierte Form (Tap ohne Zug, < 2px) verwerfen
          const b = drawElBounds(preview);
          if (b.x1 - b.x0 >= 2 || b.y1 - b.y0 >= 2) {
            added = { ...preview, id: nextId() } as DrawEl;
          }
        }
      } else if (L.tool === 'pen' && startRef.current) {
        // Einzelner Stift-Tap ohne Bewegung: einen Punkt als kleinen Kreis zeichnen
        const s = startRef.current;
        const r = Math.max(2, L.width / 2);
        added = { id: nextId(), type: 'ellipse', cx: s.x, cy: s.y, rx: r, ry: r, stroke: L.color, strokeWidth: 0, fill: L.color };
      }
      if (added) {
        elementsRef.current.push(added);
        growViewBox(added);
        dirtyRef.current = true;
        bump();
      }
      // Geste hat etwas geändert? Dann den Vorher-Zustand in die Historie (1.7)
      const before = gestureSnapRef.current;
      gestureSnapRef.current = null;
      if (before && !sameSnap(before, snapCurrent())) pushHistory(before);
      startRef.current = null;
      commit();
    },
    onPanResponderTerminate: () => {
      pinchRef.current = null;
      gestureSnapRef.current = null;
      // Geste extern beendet (z.B. ScrollView übernimmt den Responder): Preview-Element
      // entfernen, damit es nicht dauerhaft mit id "preview" in die Szene serialisiert wird
      if (elementsRef.current.some((el) => el.id === 'preview')) {
        elementsRef.current = elementsRef.current.filter((el) => el.id !== 'preview');
        dirtyRef.current = true;
        bump();
        commit();
      }
      startRef.current = null;
    },
  })).current;

  const clearAll = () => {
    Alert.alert(t('draw.clearTitle'), t('draw.clearText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => { pushHistory(snapCurrent()); elementsRef.current = []; dirtyRef.current = true; bump(); commit(); } },
    ]);
  };

  const tools: Array<[Tool, string]> = [['pen', '✏️'], ['rect', '▭'], ['ellipse', '◯'], ['line', '／'], ['arrow', '↗'], ['text', '🅣'], ['erase', '🧽']];

  return (
    <View style={styles.wrap}>
      <View style={[styles.toolbar, shadow]}>
        {tools.map(([tl, icon]) => (
          <TouchableOpacity key={tl} style={[styles.toolBtn, tool === tl && styles.toolBtnActive]} onPress={() => setTool(tl)}>
            <Text style={[styles.toolIcon, tool === tl && styles.toolIconOnPrimary]}>{icon}</Text>
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
        <TouchableOpacity style={styles.toolBtn} onPress={undo} accessibilityLabel={t('draw.undo')} disabled={historyRef.current.length === 0}>
          <Text style={styles.toolIcon}>↩︎</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={redo} accessibilityLabel={t('draw.redo')} disabled={redoRef.current.length === 0}>
          <Text style={styles.toolIcon}>↪︎</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={() => zoomBy(1 / 1.4)} accessibilityLabel={t('draw.zoomOut')} disabled={view.z <= 1.001}>
          <Text style={styles.toolIcon}>－</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={() => zoomBy(1.4)} accessibilityLabel={t('draw.zoomIn')}>
          <Text style={styles.toolIcon}>＋</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={zoomReset} accessibilityLabel={t('draw.zoomReset')} disabled={view.z <= 1.001 && view.x === 0 && view.y === 0}>
          <Text style={styles.toolIcon}>⤢</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={clearAll}>
          <Text style={styles.toolIcon}>🗑</Text>
        </TouchableOpacity>
      </View>
      {/* PanResponder liefert locationX/Y relativ zu diesem View — kein Messen nötig */}
      <View
        style={[styles.canvas, { width: canvasW, height: canvasH }]}
        {...pan.panHandlers}
      >
        <Svg width={canvasW} height={canvasH} pointerEvents="none" viewBox={`${view.x} ${view.y} ${viewBoxRef.current[0] / view.z} ${viewBoxRef.current[1] / view.z}`}>
          <Rect x={0} y={0} width={viewBoxRef.current[0]} height={viewBoxRef.current[1]} fill={canvasBg} />
          {elementsRef.current.map((el) => renderDrawEl(el))}
        </Svg>
      </View>
      <Modal visible={textPrompt != null} transparent animationType="fade" onRequestClose={() => setTextPrompt(null)}>
        <TouchableOpacity style={styles.textBackdrop} activeOpacity={1} onPress={() => setTextPrompt(null)}>
          <View style={[styles.textSheet, shadow]}>
            <Text style={styles.textSheetTitle}>{t('draw.textTitle')}</Text>
            <TextInput
              style={styles.textInput}
              value={textDraft}
              onChangeText={setTextDraft}
              placeholder={t('draw.textPlaceholder')}
              placeholderTextColor={colors.textFaint}
              autoFocus
              onSubmitEditing={addText}
            />
            <View style={styles.textBtnRow}>
              <TouchableOpacity style={styles.textCancel} onPress={() => setTextPrompt(null)}>
                <Text style={styles.textCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.textOk} onPress={addText}>
                <Text style={styles.textOkText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
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

const getStyles = (colors: Palette, type: ReturnType<typeof typeFor>) => StyleSheet.create({
  wrap: { alignItems: 'center' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.xl,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadow,
  },
  toolBtn: {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  toolBtnActive: { backgroundColor: colors.primary },
  toolIcon: { fontSize: 16, color: colors.text },
  toolIconOnPrimary: { color: '#fff' },
  sep: { width: 1, height: 24, backgroundColor: colors.border, marginHorizontal: 2 },
  colorDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: colors.primary },
  widthBtn: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  widthBtnActive: { backgroundColor: colors.primarySoft },
  widthDot: { borderRadius: 8, backgroundColor: colors.text },
  canvas: {
    borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
    backgroundColor: '#ffffff', ...shadow,
  },
  textBackdrop: { flex: 1, backgroundColor: 'rgba(21,26,35,0.5)', justifyContent: 'center', paddingHorizontal: spacing.xl },
  textSheet: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, ...shadow },
  textSheetTitle: { ...type.h2, marginBottom: spacing.md },
  textInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 16, color: colors.text,
    backgroundColor: colors.bg,
  },
  textBtnRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  textCancel: {
    flex: 1, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center',
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
  },
  textCancelText: { color: colors.textMuted, fontWeight: '700' },
  textOk: { backgroundColor: colors.primary, flex: 1, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  textOkText: { color: '#fff', fontWeight: '700' },
});

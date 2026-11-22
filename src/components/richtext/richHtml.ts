/**
 * WYSIWYG-Editor-Seite (Rich Text) für die WebView — gleiches Sandbox-Modell
 * wie der Mermaid-Renderer: CSP default-src 'none' (keine Netzwerkzugriffe),
 * alles inline, Kommunikation nur über injectJavaScript + postMessage.
 *
 * Speicherformat bleibt MARKDOWN (Poznote-kompatibel): Die Seite wandelt beim
 * Initialisieren Markdown → HTML und nach jeder Eingabe (debounced) HTML →
 * Markdown zurück. Fett/Kursiv sind im Editor ohne sichtbare Markdown-Zeichen
 * (echte <strong>/<em>-Elemente), während am Server unverändert `**fett**`
 * ankommt — Pozume-Markdown in beiden Richtungen:
 * **fett**, _kursiv_ (Wortgrenzen), `code`, #/##/### Überschriften,
 * -/*\d+. Listen, > Zitate, ``` Zaun-Blöcke (inkl. mermaid), [[Wiki-Links]],
 * pozume://note/N, --- Trennlinien.
 */
import { jsSafeJson } from '../mermaid/mermaidHtml';

export type EditorInitPayload = {
  md: string;
  editable: boolean;
  theme: {
    text: string;
    bg: string;
    surface: string;
    placeholder: string;
    primary: string;
    primarySoft: string;
    primaryDark: string;
    border: string;
  };
  placeholderText: string;
};

/** Baut den injectJavaScript-Aufruf für die Initialisierung */
export function initCall(payload: EditorInitPayload): string {
  return `(function(){ window.__pzInit(${jsSafeJson(payload)}); })(); true;`;
}

/** Baut den injectJavaScript-Aufruf für Editor-Befehle (Toolbar) */
export function cmdCall(name: string, arg?: string): string {
  return `(function(){ window.__pzCmd(${jsSafeJson(name)}${arg != null ? ',' + jsSafeJson(arg) : ''}); })(); true;`;
}

/** Externe Markdown-Änderung (z.B. Konflikt-Restore) in den Editor laden */
export function setMarkdownCall(md: string): string {
  return `(function(){ window.__pzSetMd(${jsSafeJson(md)}); })(); true;`;
}

/** Die komplette Editor-Seite (statisch — Farben kommen per __pzInit) */
export function editorHtml(): string {
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
 + '<style>html,body{margin:0;padding:0;overflow:hidden;}'
 + '#ed{min-height:56px;outline:none;height:-webkit-fit-content;padding:2px}'
 + '#ed:empty:before{content:attr(data-ph);color:var(--ph);pointer-events:none}'
 + '#ed h1{font-size:1.45em;font-weight:800;margin:0.6em 0 0.3em}'
 + '#ed h2{font-size:1.25em;font-weight:800;margin:0.6em 0 0.3em}'
 + '#ed h3{font-size:1.1em;font-weight:800;margin:0.6em 0 0.3em}'
 + '#ed p{margin:0 0 0.45em}'
 + '#ed blockquote{border-left:3px solid var(--pri);margin:0.4em 0;padding-left:10px;color:var(--mut)}'
 + '#ed ul,#ed ol{margin:0.2em 0 0.5em;padding-left:1.3em}'
 + '#ed code{font-family:Menlo,monospace;font-size:0.9em;background:var(--soft);color:var(--pridark);border-radius:3px;padding:0 3px}'
 + '#ed pre{font-family:Menlo,monospace;font-size:0.88em;background:var(--soft);border-radius:8px;padding:8px;margin:0.5em 0;white-space:pre-wrap;color:var(--pridark)}'
 + '#ed hr{border:none;border-top:1px solid var(--bd);margin:0.8em 0}'
 + '#ed .pzw{color:var(--pri);font-weight:600}</style>'
    + '</head><body>'
    + '<div id="ed" contenteditable="true" spellcheck="false"></div>'
    + '<scr' + 'ipt>' + PAGE_JS + '</scr' + 'ipt>'
    + '</body></html>';
}

/** Seiten-JavaScript: Konverter (beide Richtungen), Editor-Glue, Befehle */
const PAGE_JS = `
var pzSend = function (m) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {}
};
function pzEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Inline-Markdown → HTML (Eingabe bereits HTML-escaped) */
function pzInline(s) {
  s = s.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
  s = s.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
  s = s.replace(/(^|[^A-Za-z0-9_])_([^_\\n]+)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>');
  s = s.replace(/\\[\\[([^\\]\\n]+)\\]\\]/g, '<span class="pzw" data-wiki="$1">$1</span>');
  s = s.replace(/pozume:\\/\\/note\\/(\\d+)/g, '<span class="pzw" data-notelink="$1">\\uD83E\\uDEB6</span>');
  return s;
}
/** Markdown → HTML-Fragment (fuer innerHTML des contenteditable) */
function pzMdToHtml(md) {
  var lines = String(md).split('\\n');
  var out = [];
  var fence = null;
  var para = [];
  var list = null;
  var quote = false;
  var flushPara = function () {
    if (para.length) { out.push('<p>' + para.map(pzInline).join('<br>') + '</p>'); para = []; }
  };
  var flushList = function () {
    if (list) { out.push('</' + list + '>'); list = null; }
  };
  var flushQuote = function () {
    if (quote) { out.push('</blockquote>'); quote = false; }
  };
  var flushAll = function () { flushPara(); flushList(); flushQuote(); };
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m;
    if (fence != null) {
      if (/^\\s*\`\`\`\\s*$/.test(line)) { out.push('</pre>'); fence = null; }
      else out.push(pzEsc(line) + '\\n');
      continue;
    }
    if ((m = line.match(/^\\s*\`\`\`\\s*(\\S*)\\s*$/))) {
      flushAll();
      out.push('<pre data-lang="' + pzEsc(m[1]) + '">');
      fence = m[1] || '';
      continue;
    }
    if (/^\\s*(-{3,}|\\*{3,})\\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    if ((m = line.match(/^(#{1,3})\\s+(.*)$/))) {
      flushAll();
      var lvl = m[1].length;
      out.push('<h' + lvl + '>' + pzInline(pzEsc(m[2])) + '</h' + lvl + '>');
      continue;
    }
    if ((m = line.match(/^>\\s?(.*)$/))) {
      flushPara(); flushList();
      if (!quote) { out.push('<blockquote>'); quote = true; }
      if (m[1].trim() !== '') out.push('<p>' + pzInline(pzEsc(m[1])) + '</p>');
      continue;
    }
    if ((m = line.match(/^\\s*[-*]\\s+(.*)$/))) {
      flushPara(); flushQuote();
      if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + pzInline(pzEsc(m[1])) + '</li>');
      continue;
    }
    if ((m = line.match(/^\\s*\\d+\\.\\s+(.*)$/))) {
      flushPara(); flushQuote();
      if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + pzInline(pzEsc(m[1])) + '</li>');
      continue;
    }
    if (line.trim() === '') { flushAll(); continue; }
    flushList(); flushQuote();
    para.push(pzEsc(line));
  }
  if (fence != null) out.push('</pre>');
  flushAll();
  return out.join('');
}
/** DOM-Knoten → Inline-Markdown (rekursiv) */
function pzSerInline(node) {
  if (node.nodeType === 3) return node.nodeValue.replace(/\\u00a0/g, ' ');
  if (node.nodeType !== 1) return '';
  var tag = node.tagName;
  var inner = '';
  for (var i = 0; i < node.childNodes.length; i++) inner += pzSerInline(node.childNodes[i]);
  if (tag === 'STRONG' || tag === 'B') return '**' + inner + '**';
  if (tag === 'EM' || tag === 'I') return '_' + inner + '_';
  if (tag === 'CODE') return '\`' + (node.textContent || '') + '\`';
  if (tag === 'SPAN' && node.hasAttribute('data-wiki')) return '[[' + node.getAttribute('data-wiki') + ']]';
  if (tag === 'SPAN' && node.hasAttribute('data-notelink')) return 'pozume://note/' + node.getAttribute('data-notelink');
  if (tag === 'BR') return '';
  return inner;
}
function pzRepeat(s, n) { var r = ''; for (var i = 0; i < n; i++) r += s; return r; }
/** HTML-Element → Markdown (Bloecke) */
function pzHtmlToMd(root) {
  var out = [];
  function blocks(n, ind, inList) {
    for (var i = 0; i < n.childNodes.length; i++) {
      var c = n.childNodes[i];
      if (c.nodeType === 3) {
        var txt = c.nodeValue.replace(/\\u00a0/g, ' ').replace(/^\\s+|\\s+$/g, '');
        if (txt !== '') out.push(ind + txt);
        continue;
      }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName;
      if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
        out.push(ind + pzRepeat('#', parseInt(tag.slice(1), 10)) + ' ' + pzSerInline(c).replace(/\\s+$/g, ''));
      } else if (tag === 'BLOCKQUOTE') {
        var sub = [];
        (function collect(q) {
          for (var k = 0; k < q.childNodes.length; k++) {
            var cc = q.childNodes[k];
            if (cc.nodeType === 1 && cc.tagName === 'P') sub.push(pzSerInline(cc).replace(/\\n/g, ' '));
            else if (cc.nodeType === 1) collect(cc);
          }
        })(c);
        for (var q = 0; q < sub.length; q++) out.push(ind + '> ' + sub[q]);
        if (sub.length === 0) out.push(ind + '>');
      } else if (tag === 'P' || tag === 'DIV') {
        var joined = '';
        for (var k = 0; k < c.childNodes.length; k++) {
          var cc = c.childNodes[k];
          if (cc.nodeType === 1 && cc.tagName === 'BR') joined += '\\n';
          else joined += pzSerInline(cc);
        }
        var parts = joined.split('\\n');
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j].replace(/^\\s+|\\s+$/g, '');
          if (p !== '') out.push(ind + p);
        }
      } else if (tag === 'UL' || tag === 'OL') {
        var idx = 0;
        for (var li = 0; li < c.childNodes.length; li++) {
          var lNode = c.childNodes[li];
          if (lNode.nodeType !== 1 || lNode.tagName !== 'LI') continue;
          idx++;
          var mark = tag === 'UL' ? '- ' : idx + '. ';
          blocks(lNode, ind + (inList ? '  ' : '') + mark, true);
        }
      } else if (tag === 'PRE') {
        var lang = c.getAttribute('data-lang') || '';
        out.push(ind + '\`\`\`' + lang);
        out.push(ind + (c.textContent || '').replace(/\\n+$/, ''));
        out.push(ind + '\`\`\`');
      } else if (tag === 'HR') {
        out.push(ind + '---');
      } else if (tag === 'BR') {
        out.push('');
      } else {
        var s = pzSerInline(c).replace(/^\\s+|\\s+$/g, '');
        if (s !== '') out.push(ind + s);
      }
    }
  }
  blocks(root, '', false);
  return out.join('\\n').replace(/\\n{3,}/g, '\\n\\n').replace(/\\s+$/, '');
}
var pzEd = document.getElementById('ed');
var pzTimer = null;
var pzLastMd = null;
var pzStateTimer = null;
/** Aktueller Format-Zustand an der Caret-Position (für die Toolbar) */
function pzState() {
  function st(name) { try { return document.queryCommandState(name); } catch (e) { return false; } }
  var sel = window.getSelection();
  var n = sel && sel.focusNode;
  var block = n ? (n.nodeType === 1 ? n : n.parentNode) : null;
  var tags = [];
  var t = block;
  while (t && t !== pzEd && t.tagName) { tags.push(t.tagName); t = t.parentNode; }
  return {
    b: st('bold'),
    i: st('italic'),
    c: tags.indexOf('CODE') >= 0,
    h2: tags.indexOf('H1') >= 0 || tags.indexOf('H2') >= 0 || tags.indexOf('H3') >= 0,
    q: tags.indexOf('BLOCKQUOTE') >= 0,
    ul: tags.indexOf('UL') >= 0,
    ol: tags.indexOf('OL') >= 0,
  };
}
function pzPostState() {
  pzSend({ type: 'state', fmt: pzState() });
}
document.addEventListener('selectionchange', function () {
  clearTimeout(pzStateTimer);
  pzStateTimer = setTimeout(pzPostState, 120);
});
function pzPostMd() {
  var md = pzHtmlToMd(pzEd);
  pzLastMd = md;
  var h = Math.max(56, Math.ceil(pzEd.getBoundingClientRect().height) + 6);
  pzSend({ type: 'change', md: md, height: h });
}
function pzSchedule() {
  clearTimeout(pzTimer);
  pzTimer = setTimeout(pzPostMd, 250);
}
pzEd.addEventListener('input', pzSchedule);
/** Auswahl in <code> packen (execCommand kennt kein Inline-Code) */
function pzWrapCode() {
  var sel = window.getSelection();
  if (sel == null || sel.rangeCount === 0 || sel.isCollapsed) return;
  var range = sel.getRangeAt(0);
  var frag = range.extractContents();
  var code = document.createElement('code');
  code.appendChild(frag);
  range.insertNode(code);
  pzSchedule();
}
/** Mermaid-Skelett am Caret einfuegen */
function pzInsertMermaid() {
  pzEd.focus();
  var tpl = '<pre data-lang="mermaid">flowchart TD\\n  A --> B</pre><p><br></p>';
  document.execCommand('insertHTML', false, tpl);
  pzSchedule();
}
window.__pzInit = function (payload) {
  var t = payload.theme;
  var st = document.documentElement.style;
  st.setProperty('--ph', t.placeholder);
  st.setProperty('--pri', t.primary);
  st.setProperty('--soft', t.primarySoft);
  st.setProperty('--pridark', t.primaryDark);
  st.setProperty('--mut', '#8b93a2');
  st.setProperty('--bd', t.border);
  document.body.style.color = t.text;
  document.documentElement.style.background = 'transparent';
  pzEd.setAttribute('data-ph', payload.placeholderText || '');
  pzEd.contentEditable = payload.editable ? 'true' : 'false';
  pzEd.innerHTML = pzMdToHtml(payload.md);
  pzLastMd = payload.md;
  setTimeout(pzPostMd, 30);
};
window.__pzSetMd = function (md) {
  if (md === pzLastMd) return;
  pzEd.innerHTML = pzMdToHtml(md);
  pzLastMd = md;
};
window.__pzCmd = function (name, arg) {
  pzEd.focus();
  var ok;
  switch (name) {
    case 'bold': ok = document.execCommand('bold'); break;
    case 'italic': ok = document.execCommand('italic'); break;
    case 'code': pzWrapCode(); pzPostState(); return;
    case 'h2': ok = document.execCommand('formatBlock', false, 'H2'); break;
    case 'quote': ok = document.execCommand('formatBlock', false, 'BLOCKQUOTE'); break;
    case 'ul': ok = document.execCommand('insertUnorderedList'); break;
    case 'ol': ok = document.execCommand('insertOrderedList'); break;
    case 'codeblock': ok = document.execCommand('insertHTML', false, '<pre>&nbsp;</pre><p><br></p>'); break;
    case 'mermaid': pzInsertMermaid(); pzPostState(); return;
    case 'editable': pzEd.contentEditable = (arg === 'yes') ? 'true' : 'false'; pzPostState(); return;
    case 'undo': ok = document.execCommand('undo'); break;
    case 'redo': ok = document.execCommand('redo'); break;
    default: return;
  }
  pzSchedule();
  pzPostState();
};
`;

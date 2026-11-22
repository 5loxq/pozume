/**
 * HTML-Gerüst für die Mermaid-Darstellung in einer WebView (2.1/3.1).
 *
 * Sicherheitsmodell:
 *  - CSP default-src 'none' blockiert sämtliche Netzwerkzugriffe; Diagramm-
 *    Inhalt kann keine externen Ressourcen nachladen (kein CDN, kein Tracking).
 *  - Mermaid läuft lokal aus dem App-Paket (brokerschützt über den WebView),
 *    mit securityLevel 'strict' in Mermaid selbst sanitisiert.
 *  - Diagramm-SVG und -Quellcode werden nie inline ins HTML gesetzt, sondern
 *    per injectJavaScript übergeben und via innerHTML eingesetzt —
 *    <script>-Tags im SVG werden dadurch nicht ausgeführt.
 *
 * Zwei Varianten aus einem Gerüst:
 *  - withMermaid: lädt ./mermaid.min.js und stellt __pozumeRender bereit
 *  - ohne: reine Anzeige eines fertigen SVG (Cache/Vollbild), __pzInject
 */

/** Escapes für injectJavaScript: U+2028/U+2029 sind in JS-Strings ungültig. */
export function jsSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const ZOOM_JS = `
var __pzSetupZoom = window.__pzSetupZoom = function (enabled) {
  window.__pzExpand = enabled; // Vollbild: Diagramm über die volle Breite ziehen
  var stage = document.getElementById('stage');
  stage.__pzEnabled = enabled;
  if (stage.__pzBound) return;
  stage.__pzBound = true;
  stage.style.transformOrigin = '0 0';
  var s = 1, tx = 0, ty = 0, st = null;
  var dist = function (t) {
    var dx = t[0].pageX - t[1].pageX, dy = t[0].pageY - t[1].pageY;
    return Math.sqrt(dx * dx + dy * dy) || 1;
  };
  var mid = function (t) {
    return { x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 };
  };
  var apply = function () {
    if (s <= 1.001) { s = 1; tx = 0; ty = 0; }
    stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
  };
  stage.addEventListener('touchstart', function (ev) {
    if (!stage.__pzEnabled) return;
    if (ev.touches.length === 2) {
      ev.preventDefault();
      st = { mode: 'pinch', d0: dist(ev.touches), s0: s, mid0: mid(ev.touches), tx0: tx, ty0: ty };
    } else if (ev.touches.length === 1) {
      st = { mode: 'pan', lx: ev.touches[0].pageX, ly: ev.touches[0].pageY };
    }
  }, { passive: false });
  stage.addEventListener('touchmove', function (ev) {
    if (!st || !stage.__pzEnabled) return;
    ev.preventDefault();
    if (st.mode === 'pinch' && ev.touches.length === 2) {
      var m1 = mid(ev.touches);
      var f = dist(ev.touches) / st.d0;
      s = Math.max(1, Math.min(12, st.s0 * f));
      tx = st.tx0 + (m1.x - st.mid0.x);
      ty = st.ty0 + (m1.y - st.mid0.y);
      apply();
    } else if (st.mode === 'pan' && ev.touches.length === 1) {
      tx += ev.touches[0].pageX - st.lx;
      ty += ev.touches[0].pageY - st.ly;
      st.lx = ev.touches[0].pageX;
      st.ly = ev.touches[0].pageY;
      apply();
    }
  }, { passive: false });
  stage.addEventListener('touchend', function () { st = null; });
};
`;

const SHOW_JS = `
var __send = function (m) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {}
};
/** Mermaid deckelt die Breite über internes CSS (max-width). Das dürfen wir
 *  nicht überschreiben, sonst wird jedes Diagramm auf Containerbreite
 *  hochskaliert. Nur fehlende Begrenzung ergänzen wir mit 100%. */
var __fit = function () {
  var el = document.querySelector('#stage > svg');
  if (!el) return null;
  el.removeAttribute('height');
  el.style.height = 'auto';
  el.style.display = 'block';
  el.style.margin = '0 auto';
  try {
    if (window.__pzExpand || getComputedStyle(el).maxWidth === 'none') el.style.maxWidth = '100%';
  } catch (e) { el.style.maxWidth = '100%'; }
  return el;
};
/** Fertiges SVG einsetzen (fremde Skripte werden per innerHTML nicht ausgeführt) */
window.__pzInject = function (svg) {
  document.getElementById('stage').innerHTML = svg;
  var el = __fit();
  if (el) __send({ type: 'rendered', svg: el.outerHTML, height: Math.ceil(el.getBoundingClientRect().height) + 16 });
};
`;

const MERMAID_JS = `
/** Fehler-Reste von mermaid.render (leere Container-Divs) aufräumen */
var __pzCleanup = function () {
  var nodes = document.querySelectorAll('[id^="pz"]');
  for (var i = 0; i < nodes.length; i++) nodes[i].parentNode && nodes[i].parentNode.removeChild(nodes[i]);
};
/** Quellcode + Mermaid-Konfiguration rendern — Ergebnis an die App posten */
window.__pozumeRender = function (payload) {
  __pzCleanup();
  try {
    window.mermaid.initialize(payload.config);
    window.mermaid.render('pz' + Date.now(), payload.code).then(function (out) {
      __pzSetupZoom(payload.zoomable);
      window.__pzInject(out.svg);
    }, function (err) {
      __pzCleanup();
      __send({ type: 'error', message: String((err && (err.message || err.str)) || err) });
    });
  } catch (e) {
    __pzCleanup();
    __send({ type: 'error', message: String((e && e.message) || e) });
  }
};
`;

/** HTML-Gerüst bauen. bg transparent: Hintergrundfarbe kommt von der App. */
export function diagramHtml(withMermaid: boolean): string {
  const csp = "default-src 'none'; script-src 'unsafe-inline'" + (withMermaid ? " 'self'" : '') + "; style-src 'unsafe-inline'; img-src data:; font-src data:";
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'
    + '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden;}'
    + '#stage{padding:8px;transform-origin:0 0;}'
    + '#stage svg{max-width:100%;height:auto;display:block;}</style>'
    + '</head><body><div id="stage"></div>'
    + '<script>' + SHOW_JS + ZOOM_JS + '</script>'
    + (withMermaid
      ? '<script src="./mermaid.min.js"></script><script>' + MERMAID_JS + '</script>'
      : '')
    + '</body></html>';
}

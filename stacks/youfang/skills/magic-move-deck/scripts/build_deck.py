"""Freeze the deck's diagrams into per-element data for the Magic Move deck.

Each diagram's own main() runs unchanged in Chromium. Before it runs, every rough.js call
(rc.line / rc.rectangle / ...) is mirrored into an SVG group, and every HTML label is tagged
with its draw order. Afterwards shapes and text lines are exported with their canvas-space
geometry, so the deck can move the elements two slides share instead of cross-fading images.
Pictures a diagram places on its label layer (<img>, e.g. product shots and the download QR on the
cover / closing card) are exported too, inlined as data URIs so the bundled deck stays offline.
Each diagram also exports its style's theme (paper colour, font stacks, card palette, glow), so
keynote.html follows whichever style template the diagrams were drawn with.

usage: python3 build_deck.py            -> assets/deck_data.js + <DECK_NAME>.html
       python3 build_deck.py --bundle   -> only re-pack <DECK_NAME>.html (after editing keynote.html)

Copy this file next to keynote.html (e.g. <project>/presentation/) and edit the CONFIG block only.
"""
import base64
import json
import os
import re
import sys
import tempfile

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ---------- CONFIG ----------
# Single-file deck written next to this script.
DECK_NAME = 'deck'
# (key, diagram path relative to ROOT). Fixed keys: 'ov' = overview (required); 'cv' / 'end' = opening /
# closing card (optional). Detail diagrams use any other key (d1, d2, ...) and are referenced by SECTIONS
# in keynote.html. Each diagram is a copy of the chosen styles/<style>/diagram.html with only main() edited.
SOURCES = [
    ('cv', 'details/00_cover.html'),
    ('ov', 'overview.html'),
    ('d1', 'details/01_topic.html'),
    ('end', 'details/99_end.html'),
]
# ---------- /CONFIG ----------

MIME = {'.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'}
MARK = 'main();\nwindow.__renderDone = true;'
DATA = os.path.join(HERE, 'assets', 'deck_data.js')
TAG = '<script src="assets/deck_data.js"></script>'

# Runs in the diagram's own script scope, right before main().
PRE = r"""
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const host = document.createElementNS(NS, 'svg');
  host.setAttribute('width', canvas.width); host.setAttribute('height', canvas.height);
  host.setAttribute('style', 'position:absolute;left:0;top:0;opacity:0;pointer-events:none');
  document.querySelector('.stage').appendChild(host);
  const rs = rough.svg(host);
  let seq = 0, gid = 0, grp = null, depth = 0;
  const ops = window.__deckOps = [];
  // A style template may normalise rough.js options (e.g. roughness 0) in restyle(args, method); the SVG
  // mirror must draw with the same options as the canvas. A path ending in Z is a closed shape like a rectangle.
  const norm = (a, m) => typeof restyle === 'function' ? restyle(a, m) : a;
  for (const m of ['line', 'rectangle', 'ellipse', 'circle', 'linearPath', 'polygon', 'arc', 'curve', 'path']) {
    const orig = rc[m].bind(rc);
    rc[m] = (...a) => {
      const r = orig(...a), g = rs[m](...norm(a, m));
      host.appendChild(g);
      ops.push({ m: m === 'path' && /z\s*$/i.test(a[0]) ? 'closedpath' : m, g, grp, seq: ++seq });
      return r;
    };
  }
  const tag = () => { const el = L.lastChild; el.dataset.seq = ++seq; el.dataset.grp = grp || ''; };
  for (const name of ['plain', 'lbl']) {
    const f = window[name];
    window[name] = function (...a) { const r = f.apply(this, a); tag(); return r; };
  }
  // title() / subtitle() paint on the canvas; re-issue them as HTML so they become movable text.
  const textAt = (kind, text, x, y, size, weight, family, color) => {
    ctx.font = `${weight} ${size}px ${family}`;
    const m = ctx.measureText(text), A = m.fontBoundingBoxAscent, D = m.fontBoundingBoxDescent;
    const div = document.createElement('div');
    div.className = 'label';
    div.style.cssText = `left:${x}px;top:${y - A}px;width:max-content;white-space:nowrap;` +
      `font-family:${family};font-size:${size}px;font-weight:${weight};line-height:${A + D}px;color:${color}`;
    div.textContent = text;
    L.appendChild(div); tag(); div.dataset.grp = kind;
  };
  // "中文\u2003English" titles become two atoms, so a two-line caption can fly into them.
  window.title = (text, x, y, size = 44) => {
    const parts = text.split('\u2003');
    ctx.font = `700 ${size}px ${FONT_TI}`;
    const dx = ctx.measureText(parts[0] + '\u2003').width;
    textAt('title', parts[0], x, y, size, 700, FONT_TI, C.title);
    if (parts.length > 1) textAt('title', parts.slice(1).join('\u2003'), x + dx, y, size, 700, FONT_TI, C.title);
  };
  window.subtitle = (text, x, y, size = 22) => textAt('subtitle', text, x, y, size, 400, FONT_BD, C.subtitle);
  // Multi-stroke helpers move as one shape.
  for (const name of ['arrow', 'frame', 'timeline', 'taskCard', 'bubble', 'legend']) {
    const f = window[name];
    window[name] = function (...a) {
      const outer = depth === 0; if (outer) grp = `${name}:${++gid}`;
      depth++;
      try { return f.apply(this, a); } finally { depth--; if (outer) grp = null; }
    };
  }
})();
"""

POST = r"""
window.__deckExtract = async () => {
  await document.fonts.ready;
  const stage = document.querySelector('.stage'), sr = stage.getBoundingClientRect();
  const q = v => Math.round(v * 10) / 10;
  const R = r => [q(r.left - sr.left), q(r.top - sr.top), q(r.width), q(r.height)];
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const groups = [], byKey = new Map();
  for (const op of window.__deckOps) {
    const k = op.grp || `op${op.seq}`;
    if (!byKey.has(k)) { const G = { gid: op.grp, seq: op.seq, ms: [], gs: [] }; byKey.set(k, G); groups.push(G); }
    const G = byKey.get(k); G.ms.push(op.m); G.gs.push(op.g);
  }
  const shapes = groups.map(G => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of G.gs) {
      const b = g.getBBox();
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
    const p = 5, st = G.gs[0].querySelector('path:not([stroke="none"])');
    return { seq: G.seq, gid: G.gid, ms: G.ms, stroke: st ? st.getAttribute('stroke') : null,
             r: [q(x0 - p), q(y0 - p), q(x1 - x0 + 2 * p), q(y1 - y0 + 2 * p)],
             svg: G.gs.map(g => g.outerHTML).join('') };
  });

  const Lc = document.getElementById('labels'), texts = [];
  const isBlock = el => getComputedStyle(el).display === 'block';
  const hasInline = el => [...el.childNodes].some(n =>
    (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !isBlock(n)));
  for (const root of Lc.children) {
    const seq = +root.dataset.seq, gid = root.dataset.grp || null;
    const emit = leaf => {
      if (!norm(leaf.innerText)) return;
      const cs = getComputedStyle(leaf);
      let op = 1; for (let e = leaf; e && e !== Lc; e = e.parentElement) op *= +getComputedStyle(e).opacity;
      const base = `font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:${cs.fontWeight};` +
        `font-style:${cs.fontStyle};line-height:${cs.lineHeight};color:${cs.color};text-align:${cs.textAlign};` +
        `letter-spacing:${cs.letterSpacing};white-space:${cs.whiteSpace}`;
      const br = leaf.getBoundingClientRect();
      const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const segs = [[]];
      for (const n of leaf.childNodes) n.nodeName === 'BR' ? segs.push([]) : segs[segs.length - 1].push(n);
      const lines = segs.filter(s => s.some(n => n.textContent.trim()));
      if (lines.length <= 1 || bg) {
        const rg = document.createRange(); rg.selectNodeContents(leaf);
        const t = { seq, gid, r: R(br), t: R(rg.getBoundingClientRect()), txt: norm(leaf.innerText), html: leaf.innerHTML,
                    css: base + `;background:${cs.backgroundColor};padding:${cs.padding}`, op };
        if (leaf.innerText.includes('\u2003')) t.em = leaf.innerText.split('\u2003').map(norm);   // one-line "English  中文" label
        texts.push(t);
        return;
      }
      // One movable atom per <br> line: same width and alignment as the parent, stacked line boxes.
      const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
      const cx = br.left + pl, cw = br.width - pl - pr, ch = br.height - pt - pb, n = segs.length;
      segs.forEach((s, i) => {
        if (!s.some(nd => nd.textContent.trim())) return;
        const rg = document.createRange(); rg.setStartBefore(s[0]); rg.setEndAfter(s[s.length - 1]);
        const tr = rg.getBoundingClientRect();
        texts.push({ seq, gid, r: R({ left: cx, top: br.top + pt + ch * i / n, width: cw, height: ch / n }), t: R(tr),
                     txt: norm(s.map(nd => nd.textContent).join('')),
                     html: s.map(nd => nd.nodeType === 3 ? esc(nd.textContent) : nd.outerHTML).join(''),
                     css: base, op });
      });
    };
    const walk = el => {
      const kids = [...el.children].filter(isBlock);
      if (kids.length && !hasInline(el)) kids.forEach(walk); else emit(el);
    };
    walk(root);
  }
  const images = [...Lc.querySelectorAll('img')].map(im => {
    let op = 1; for (let e = im; e && e !== Lc; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    return { r: R(im.getBoundingClientRect()), src: im.getAttribute('src'), op };
  });
  // The style's theme: paper colour, .ti / .bd font stacks, card palette (C.card), shape glow (C.glow).
  const font = cls => { const e = document.createElement('div'); e.className = cls; Lc.appendChild(e);
                        const f = getComputedStyle(e).fontFamily; e.remove(); return f; };
  const theme = { bg: getComputedStyle(stage).backgroundColor, ti: font('ti'), bd: font('bd'),
                  card: C.card || null, glow: C.glow || null };
  return { w: canvas.width, h: canvas.height, shapes, texts, images, theme };
};
"""

CLOSED = {'rectangle', 'polygon', 'ellipse', 'circle', 'closedpath'}
NUM = re.compile(r'(-?\d+\.\d)\d+')
CJK = re.compile(r'[\u4e00-\u9fff]')
BOLD = re.compile(r'font-weight:\s*([6-9]00|bold)')


def zh_first(t):
    """Pairing name of a one-line bilingual label: its Chinese part first, whichever part the slide shows first."""
    parts = t.get('em') or [t['txt']]
    return ' '.join(sorted(parts, key=lambda s: not CJK.search(s)))


def iou(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0, x1 - x0) * max(0, y1 - y0)
    return inter / (a[2] * a[3] + b[2] * b[3] - inter)


def inside(pt, r):
    return r[0] <= pt[0] <= r[0] + r[2] and r[1] <= pt[1] <= r[1] + r[3]


def structure(d):
    """Group closed shapes and the text drawn into them into nodes; key frames by their label."""
    shapes, texts = d['shapes'], d['texts']
    for s in shapes:
        s['svg'] = NUM.sub(r'\1', s['svg'])
        s['grp'] = s['gid'].split(':')[0] if s['gid'] else None
    nodes = []
    closed = [i for i, s in enumerate(shapes) if not s['gid'] and len(s['ms']) == 1 and s['ms'][0] in CLOSED]
    prev = None
    for i in closed:
        s = shapes[i]
        p = shapes[prev] if prev is not None else None
        if p is not None and p['seq'] == s['seq'] - 1 and p['stroke'] == s['stroke'] and iou(p['r'], s['r']) > 0.5:
            nodes[p['node']]['shapes'].append(i)          # stacked copies of the same box
        else:
            nodes.append({'shapes': [i], 'texts': []})
        s['node'] = len(nodes) - 1
        prev = i
    for j, t in enumerate(texts):
        t['grp'] = t['gid'].split(':')[0] if t['gid'] else None
        if t['grp'] == 'legend':
            continue
        c = (t['t'][0] + t['t'][2] / 2, t['t'][1] + t['t'][3] / 2)
        own = [i for i in closed if shapes[i]['seq'] < t['seq'] and inside(c, shapes[i]['r'])]
        if own:
            n = shapes[max(own, key=lambda i: shapes[i]['seq'])]['node']
            t['node'] = n
            nodes[n]['texts'].append(j)
    # A node's name is its first bold Chinese line (the slides lead with English), else its first line.
    for n in nodes:
        zh = [j for j in n['texts'] if BOLD.search(texts[j]['css']) and CJK.search(texts[j]['txt'])]
        n['key'] = texts[(zh or n['texts'])[0]]['txt'] if n['texts'] else None
    labels = {}
    for j, t in enumerate(texts):
        if t['grp'] == 'frame':
            labels.setdefault(t['gid'], j)
    for s in shapes:
        if s['grp'] == 'frame':
            j = labels.get(s['gid'])
            if j is None:   # frame(..., null) + a separate plain() label sitting on its top edge
                x, y, w, _ = s['r']
                on_edge = [k for k, t in enumerate(texts) if t['grp'] is None and 'node' not in t
                           and x <= t['t'][0] + t['t'][2] / 2 <= x + w
                           and abs(t['t'][1] + t['t'][3] / 2 - (y + 5)) < 20]
                j = on_edge[0] if on_edge else None
            if j is not None:
                s['fkey'], s['ftext'] = zh_first(texts[j]), j
        s['c'] = s.pop('stroke', None)     # stroke colour: keynote.html tints the style's glow with it
        for k in ('ms', 'gid'):
            s.pop(k, None)
    for t in texts:
        t.pop('gid', None)
        t.pop('em', None)
    d['nodes'] = nodes
    return d


def main():
    assert 'ov' in dict(SOURCES), "SOURCES needs the overview under key 'ov'"
    out = {}
    with tempfile.TemporaryDirectory(prefix='deck_') as tmp, sync_playwright() as p:
        browser = p.chromium.launch()
        for key, rel in SOURCES:
            src = os.path.join(ROOT, rel)
            html = open(src, encoding='utf-8').read()
            assert html.count(MARK) == 1, src
            html = html.replace(MARK, PRE + MARK + '\n' + POST)
            path = os.path.join(tmp, key + '.html')
            open(path, 'w', encoding='utf-8').write(html)
            m = re.search(r'<canvas id="c" width="(\d+)" height="(\d+)"', html)
            page = browser.new_page(viewport={'width': int(m.group(1)), 'height': int(m.group(2))})
            page.goto('file://' + path)
            page.wait_for_function('window.__renderDone === true && window.__deckExtract', timeout=60000)
            d = structure(page.evaluate('window.__deckExtract()'))
            page.close()
            for im in d['images']:     # relative to the diagram, read from disk: the page itself ran from tmp
                f = os.path.join(os.path.dirname(src), im['src'])
                im['src'] = f"data:{MIME[os.path.splitext(f)[1]]};base64," + base64.b64encode(open(f, 'rb').read()).decode()
            out[key] = d
            keyed = sum(1 for n in d['nodes'] if n['key'])
            print(f"{key}: {d['w']}x{d['h']}  shapes={len(d['shapes'])} texts={len(d['texts'])} images={len(d['images'])} nodes={len(d['nodes'])} keyed={keyed}")
        browser.close()
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, 'w', encoding='utf-8') as f:
        f.write('window.DECK_DATA = ')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('wrote', DATA, os.path.getsize(DATA) // 1024, 'KB')


def bundle():
    """keynote.html with deck_data.js inlined: one offline file to copy, mail or open from a USB stick."""
    html = open(os.path.join(HERE, 'keynote.html'), encoding='utf-8').read()
    data = open(DATA, encoding='utf-8').read().replace('</', '<\\/')   # keep "</script>" out of the inline script
    assert html.count(TAG) == 1 and '<!--' not in data
    dst = os.path.join(HERE, DECK_NAME + '.html')
    open(dst, 'w', encoding='utf-8').write(html.replace(TAG, '<script>' + data + '</script>'))
    print('wrote', dst, os.path.getsize(dst) // 1024, 'KB')


if __name__ == '__main__':
    if '--bundle' not in sys.argv:
        main()
    bundle()

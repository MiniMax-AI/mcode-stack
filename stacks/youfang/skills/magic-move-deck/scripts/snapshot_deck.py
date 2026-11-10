"""Screenshot a Magic Move deck: every slide, chosen transitions frozen at chosen progress, title-overlap scan.

Drives the deck's test hook window.__deck (setState / freeze) in headless Chromium at 1920x1080.
Fails (exit 1) on any page error. Conclusions still come from looking at the PNGs.

usage:
  python3 snapshot_deck.py keynote.html --out /tmp/shots --slides
  python3 snapshot_deck.py keynote.html --out /tmp/shots --trans 0-1,1-0 --p 0.04,0.1,0.2,0.3,0.46
  python3 snapshot_deck.py keynote.html --out /tmp/shots --overlap 2-3,3-2
  python3 snapshot_deck.py deck.html --offline        # bundled file: no http(s) reference, every slide renders

--overlap freezes i→j at p = k/40 and reports, per frame, the largest overlap between the text boxes
(Range rects, not the wider element boxes) of a flying Latin title line and a flying CJK title line
(elements with class .gh), in stage px.
"""
import argparse
import os
import re
import sys

from playwright.sync_api import sync_playwright

OVERLAP_JS = r"""() => {
  const cjk = s => /[\u4e00-\u9fff]/.test(s);
  const vis = [...document.querySelectorAll('.gh')].filter(e => {
    let o = 1; for (let n = e; n && n.id !== 'stage'; n = n.parentElement) o *= +getComputedStyle(n).opacity;
    return o > 0.02 && e.textContent.trim();
  }).map(e => { const rg = document.createRange(); rg.selectNodeContents(e);
                return { zh: cjk(e.textContent), r: rg.getBoundingClientRect(), t: e.textContent.trim() }; });
  const S = document.getElementById('stage').getBoundingClientRect();   // only what is on screen counts
  let best = null;
  for (const a of vis) for (const b of vis) {
    if (a.zh || !b.zh) continue;
    const x0 = Math.max(a.r.left, b.r.left, S.left), x1 = Math.min(a.r.right, b.r.right, S.right);
    const y0 = Math.max(a.r.top, b.r.top, S.top), y1 = Math.min(a.r.bottom, b.r.bottom, S.bottom);
    const w = x1 - x0, h = y1 - y0;
    if (w > 0 && h > 0 && (!best || w * h > best.w * best.h))
      best = { w: Math.round(w), h: Math.round(h), x: Math.round(x0), y: Math.round(y0), en: a.t, zh: b.t };
  }
  return best;
}"""


def pairs(spec):
    return [tuple(int(v) for v in s.split('-')) for s in spec.split(',') if s]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('deck')
    ap.add_argument('--out', default='/tmp/deck_shots')
    ap.add_argument('--slides', action='store_true', help='screenshot every slide')
    ap.add_argument('--trans', default='', help='transitions i-j[,i-j...] (0-based slide indexes)')
    ap.add_argument('--p', default='0.06,0.15,0.25,0.35,0.5,0.75', help='progress values for --trans')
    ap.add_argument('--overlap', default='', help='transitions to scan for title-line overlap at p = k/40')
    ap.add_argument('--offline', action='store_true', help='bundled deck: assert no http reference, shoot every slide')
    a = ap.parse_args()
    deck = os.path.abspath(a.deck)
    os.makedirs(a.out, exist_ok=True)
    ok = True
    if a.offline:
        n = len(re.findall('http', open(deck, encoding='utf-8').read()))
        print(f'http references: {n}')
        ok &= n == 0
        a.slides = True
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--force-color-profile=srgb'])
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        if a.offline:
            page.route(re.compile(r'^https?://'), lambda r: r.abort())
        page.goto('file://' + deck)
        page.wait_for_function('window.__ready === true', timeout=60000)
        n = page.evaluate('__deck.SLIDES.length')
        print(f'slides: {n}')
        if a.slides:
            for i in range(n):
                page.evaluate(f'__deck.setState({i})')
                page.screenshot(path=os.path.join(a.out, f'slide_{i:02d}.png'))
        for i, j in pairs(a.trans):
            for v in [float(x) for x in a.p.split(',')]:
                page.evaluate(f'__deck.freeze({i}, {j}, {v})')
                page.screenshot(path=os.path.join(a.out, f'trans_{i:02d}-{j:02d}_p{v:.3f}.png'))
            page.evaluate(f'__deck.freeze({i}, {j}, 1)')
        for i, j in pairs(a.overlap):
            worst = None
            for k in range(1, 40):
                page.evaluate(f'__deck.freeze({i}, {j}, {k / 40})')
                hit = page.evaluate(OVERLAP_JS)
                if hit:
                    print(f'  {i}->{j} p={k / 40:.3f}: {hit["w"]}x{hit["h"]}px at ({hit["x"]},{hit["y"]})  "{hit["en"]}" x "{hit["zh"]}"')
                    if not worst or hit['w'] * hit['h'] > worst['w'] * worst['h']:
                        worst = dict(hit, p=k / 40)
            page.evaluate(f'__deck.freeze({i}, {j}, 1)')
            print(f'overlap {i}->{j}: ' + (f'max {worst["w"]}x{worst["h"]}px at ({worst["x"]},{worst["y"]}) p={worst["p"]:.3f}' if worst else 'none'))
        browser.close()
    if errors:
        print('page errors:', *errors, sep='\n  ')
        ok = False
    print('screenshots in', a.out)
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()

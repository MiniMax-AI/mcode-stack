#!/usr/bin/env python3
"""Capture real source pages as 9:16 phone screenshots, with the quoted phrase located.

For every `spot` shot in script.json ({"key": ..., "phrase": ...}) this opens sources.json[key]
in a mobile browser, scrolls the phrase to ~40% of the screen, waits for the layout to stop
moving, and saves a screenshot plus the phrase's rectangles (in screenshot pixels).

    python3 capture.py --script script.json --sources sources.json --out shots
    python3 capture.py ... --only 'bun_joins|Today, Bun makes $0 in revenue.'   # re-shoot one

`phrase` is matched across text nodes; a phrase starting with '#' is treated as a CSS selector
(useful for GitHub code views, whose lines are not plain text: '#LC15' = line 15).
Writes <out>/index.json: {"key|phrase": {"file": "...png", "rects": [[x, y, w, h], ...]}}
"""
import argparse, base64, json, os, sys
from playwright.sync_api import sync_playwright

VIEW_W, VIEW_H = 432, 768       # CSS px of a large phone; x2.5 = 1080x1920, so DSF 5 gives a 2x frame for zooming
DSF_DEFAULT = 5                 # 2160x3840 captures stay sharp when the compositor zooms ~1.4x on the quote
SETTLE_POLLS, SETTLE_MS = 20, 700   # lazy images shift layout; poll the phrase position until it stops moving
PHRASE_AT = 0.40                # put the phrase 40% down the screen: room for a translation box below it
UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '   # an iPhone UA so sites serve
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')                     # their mobile layout, as viewers see it
FIND = r'''(phrase) => {
  if (phrase.startsWith('#')) { const e = document.querySelector(phrase); if (!e) return false;
    const r = document.createRange(); r.selectNodeContents(e); window.__r = r; return true; }
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const nodes = []; let n, acc = '';
  while ((n = w.nextNode())) { nodes.push([n, acc.length]); acc += n.data; }
  for (let from = 0;;) {
    const i = acc.indexOf(phrase, from); if (i < 0) return false;
    const loc = off => { for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k][1] <= off) return [nodes[k][0], off - nodes[k][1]]; };
    const [sn, so] = loc(i), [en, eo] = loc(i + phrase.length);
    const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo);
    const b = r.getBoundingClientRect(); if (b.width > 0 && b.height > 0) { window.__r = r; return true; }
    from = i + 1;
  }
}'''
HIDE = '''() => { for (const el of document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],#onetrust-consent-sdk')) el.style.display = 'none'; }'''
CENTER = f'''() => {{ const b = window.__r.getBoundingClientRect(); window.scrollTo({{top: scrollY + b.top - innerHeight * {PHRASE_AT}, behavior: "instant"}}); }}'''


def jobs_from(script, sources):
    jobs = {}
    for line in script['lines']:
        for sh in line['shots']:
            if sh['type'] != 'spot':
                continue
            if sh['key'] not in sources:
                sys.exit(f"sources.json has no url for key {sh['key']!r}")
            jobs[f"{sh['key']}|{sh['phrase']}"] = (sources[sh['key']], sh['phrase'])
    return jobs


def shoot(ctx, url, phrase, path, dsf):
    pg = ctx.new_page(); cdp = ctx.new_cdp_session(pg)
    try:
        pg.goto(url, wait_until='domcontentloaded', timeout=60000)
        pg.evaluate("() => document.querySelectorAll('img').forEach(i => { i.loading = 'eager'; })")
        pg.wait_for_timeout(4000); pg.evaluate(HIDE)
        if not pg.evaluate(FIND, phrase):
            raise RuntimeError('phrase not found on page (check exact wording / casing)')
        pg.add_style_tag(content='html,body{scroll-behavior:auto!important}')
        pg.evaluate(CENTER); pg.wait_for_timeout(1200); pg.evaluate(HIDE)
        for _ in range(SETTLE_POLLS):
            a = pg.evaluate('() => window.__r.getBoundingClientRect().top + scrollY'); pg.wait_for_timeout(SETTLE_MS)
            if abs(pg.evaluate('() => window.__r.getBoundingClientRect().top + scrollY') - a) < 1:
                break
        pg.evaluate(CENTER); pg.wait_for_timeout(800)
        rects = pg.evaluate('() => [...window.__r.getClientRects()].filter(r => r.width > 2).map(r => [r.left, r.top, r.width, r.height])')
        try:   # viewport screenshot keeps rects and pixels in the same coordinate frame
            pg.screenshot(path=path, timeout=25000, animations='disabled', caret='hide')
        except Exception:   # some pages hang waiting for web fonts; fall back to a raw CDP capture
            sx, sy = pg.evaluate('() => [scrollX, scrollY]')
            data = cdp.send('Page.captureScreenshot', {'format': 'png', 'clip': {'x': sx, 'y': sy, 'width': VIEW_W, 'height': VIEW_H, 'scale': dsf}})['data']
            open(path, 'wb').write(base64.b64decode(data))
        return [[round(v * dsf) for v in r] for r in rects]
    finally:
        pg.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='script.json'); ap.add_argument('--sources', default='sources.json')
    ap.add_argument('--out', default='shots'); ap.add_argument('--dsf', type=float, default=DSF_DEFAULT)
    ap.add_argument('--only', nargs='*', help='re-shoot only these "key|phrase" entries')
    a = ap.parse_args()
    jobs = jobs_from(json.load(open(a.script)), json.load(open(a.sources)))
    os.makedirs(a.out, exist_ok=True); idx_path = os.path.join(a.out, 'index.json')
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    failed = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': VIEW_W, 'height': VIEW_H}, device_scale_factor=a.dsf, is_mobile=True, has_touch=True, user_agent=UA)
        for i, (k, (url, phrase)) in enumerate(jobs.items()):
            if a.only and k not in a.only:
                continue
            path = os.path.join(a.out, f'{i:02d}.png')
            try:
                index[k] = {'file': path, 'rects': shoot(ctx, url, phrase, path, a.dsf)}
                print('ok  ', k)
            except Exception as e:
                failed.append(k); print('FAIL', k, '—', str(e).splitlines()[0][:160])
        b.close()
    json.dump(index, open(idx_path, 'w'), ensure_ascii=False, indent=1)
    if failed:
        sys.exit(f'{len(failed)} capture(s) failed; fix the phrase/url or use a "web" layout instead')


if __name__ == '__main__':
    main()

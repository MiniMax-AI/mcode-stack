#!/usr/bin/env python3
"""Text-density lint for 1080x1920 vertical video, run against the real rendered frames.

    python3 lint.py                       # exit 1 if anything fails
    python3 lint.py --page compositor.html --timeline timeline.json --captures shots/index.json

Each shot is rendered twice (≈1 s in, and settled near its end); every visible text node is
measured. Captions are checked one by one. Thresholds and their sources are in RULES.
Text dimmed to <= 35% opacity counts as texture (code context lines, background copy) and is
skipped; an element with a data-lint-group attribute (a diagram, a list) counts as one block.
"""
import argparse, json, os, re, shutil, sys
from collections import Counter
from playwright.sync_api import sync_playwright

RULES = dict(
    SAFE_L=60, SAFE_T=180, SAFE_B=1920 - 320,  # TikTok/Douyin UI: 60 px edge, top tabs, bottom 320 px (caption/music/name)
    SAFE_R_LOW=1080 - 120, RIGHT_RAIL_Y=850,   # the like/comment/share rail covers the right 120 px of the lower half only
    SAFE_R_HIGH=1020,                          # above the rail only the 60 px edge margin applies
    CAP_TOP_MIN=1380,                          # captions sit low, inside the 1200-1550 band, clear of the bottom overlay
    CAP_MAX_LINE=16, CAP_MAX_LINES=1,          # Netflix zh-CN: 16 chars/line; short video: one line
    CAP_MAX_CPS=9.0, CAP_MIN_DUR=0.6,          # Netflix adult reading speed; anything shorter than 0.6 s flickers
    CAP_CLEAR=60,                              # px of empty space above the caption
    MIN_FONT=34, MIN_FONT_LABEL=26, LABEL_MAX=24,  # body >= 34 px on a 1080 frame; small labels allowed if short
    MAX_BLOCKS=4,                              # text blocks on screen besides the caption
    MAX_LOAD=36,                               # reading load besides the caption (汉字 1, latin char 0.5)
    MAX_LEVELS=3, LEVEL_STEP=1.15,             # font-size levels per screen; sizes within 15% read as one level
    LINE_MAX=14,                               # load per line for on-screen text
    ORPHAN=2.6,                                # last line narrower than 2.6 em = a widowed character or two
    TEXTURE_OPACITY=0.35,                      # dimmer than this is texture, not text to read
)
JS = r'''(texture) => {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  const alpha = el => { let a = 1; for (let e = el; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') return 0; a *= parseFloat(s.opacity); } return a; };
  while ((n = w.nextNode())) {
    const t = n.data.replace(/\s+/g, ' ').trim(); if (!t) continue;
    const el = n.parentElement, a = alpha(el); if (a < 0.05) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const rs = [...r.getClientRects()].filter(x => x.width > 1 && x.height > 1); if (!rs.length) continue;
    let blk = el.closest('[data-lint-group]');
    if (!blk) { blk = el; while (blk && ['inline', 'inline-block'].includes(getComputedStyle(blk).display)) blk = blk.parentElement; }
    if (!blk.dataset.bid) blk.dataset.bid = Math.random().toString(36).slice(2, 8);
    let sc = 1; for (let e = el; e && e !== document.body; e = e.parentElement) { const m = getComputedStyle(e).transform.match(/matrix\(([^)]+)\)/);
      if (m) sc *= Math.hypot(...m[1].split(',').slice(0, 2).map(Number)); }
    const top = Math.max(...rs.map(x => x.top)), earlier = rs.filter(x => x.top < top - 4);
    out.push({ t, bid: blk.dataset.bid, cap: !!el.closest('#cap'), texture: a <= texture, fs: Math.round(parseFloat(getComputedStyle(el).fontSize) * sc),
      x0: Math.min(...rs.map(x => x.left)), y0: Math.min(...rs.map(x => x.top)), x1: Math.max(...rs.map(x => x.right)), y1: Math.max(...rs.map(x => x.bottom)),
      lines: new Set(rs.map(x => Math.round(x.top / 8))).size,
      lastw: earlier.length ? rs.filter(x => x.top >= top - 4).reduce((s, x) => s + x.width, 0) : 1e9 });
  }
  return out;
}'''


def load(s):
    return sum(1 if ord(ch) > 0x2e80 else 0.5 for ch in s if not ch.isspace() and ch not in '，。、：；？！,.:;?!“”"')


def check_screen(items, R):
    screen = [i for i in items if not i['cap'] and not i['texture']]
    blocks = {i['bid'] for i in screen}; total = sum(load(i['t']) for i in screen); levels = []
    for s in sorted({i['fs'] for i in screen}):
        if not levels or s > levels[-1] * R['LEVEL_STEP']:
            levels.append(s)
    v = []
    if len(blocks) > R['MAX_BLOCKS']: v.append(f"{len(blocks)} text blocks > {R['MAX_BLOCKS']}")
    if total > R['MAX_LOAD']: v.append(f"reading load {total:.0f} > {R['MAX_LOAD']}")
    if len(levels) > R['MAX_LEVELS']: v.append(f"{len(levels)} font-size levels > {R['MAX_LEVELS']} {levels}")
    for i in screen:
        tag = f"「{i['t'][:12]}」"
        if i['fs'] < R['MIN_FONT'] and (i['fs'] < R['MIN_FONT_LABEL'] or load(i['t']) > R['LABEL_MAX']): v.append(f"too small {i['fs']}px {tag}")
        right = R['SAFE_R_LOW'] if i['y1'] > R['RIGHT_RAIL_Y'] else R['SAFE_R_HIGH']
        if i['x1'] > 0 and i['x0'] < 1080 and (i['x0'] < R['SAFE_L'] - 1 or i['x1'] > right + 1 or i['y0'] < R['SAFE_T'] - 1 or i['y1'] > R['SAFE_B'] + 1):
            v.append(f"outside safe zone ({i['x0']:.0f},{i['y0']:.0f})-({i['x1']:.0f},{i['y1']:.0f}) {tag}")
        if i['fs'] >= R['MIN_FONT'] and i['lastw'] < R['ORPHAN'] * i['fs']: v.append(f"orphan last line …{i['t'][-6:]}")
        if i['fs'] >= R['MIN_FONT'] and load(i['t']) / i['lines'] > R['LINE_MAX']: v.append(f"line too long {load(i['t']) / i['lines']:.0f}/line {tag}")
    return len(blocks), total, levels, v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default='compositor.html'); ap.add_argument('--timeline', default='timeline.json')
    ap.add_argument('--captures', default='shots/index.json')
    a = ap.parse_args(); R = RULES
    if not os.path.exists(a.page):   # same first-run copy as render.py
        shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'compositor.html'), a.page)
    tl = json.load(open(a.timeline)); idx = json.load(open(a.captures)) if os.path.exists(a.captures) else {}
    issues = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--allow-file-access-from-files']); pg = b.new_page(viewport={'width': 1080, 'height': 1920})
        pg.goto('file://' + os.path.abspath(a.page)); pg.evaluate('([tl, idx]) => setup(tl, idx)', [tl, idx])
        for k, sh in enumerate(tl['shots']):
            d = sh['end'] - sh['start']; worst = None
            for t in sorted({sh['start'] + min(1.0, d / 2), sh['start'] + max(0.3, min(d - 0.25, 2.6))}):
                pg.evaluate(f'render({t})'); res = check_screen(pg.evaluate(JS, R['TEXTURE_OPACITY']), R)
                if worst is None or len(res[3]) > len(worst[3]): worst = res
            nb, total, levels, v = worst
            print(f"#{k:02d} {sh['type']:<7} {sh['start']:6.1f}s blocks={nb} load={total:4.0f} sizes={levels}  {'OK' if not v else '✗ ' + '; '.join(dict.fromkeys(v))}")
            issues += [(f'shot {k}', x) for x in dict.fromkeys(v)]
        for c in tl['cues']:
            pg.evaluate(f"render({(c['s'] + c['e']) / 2})"); items = pg.evaluate(JS, R['TEXTURE_OPACITY'])
            cap = [i for i in items if i['cap']]
            if not cap:
                continue
            y0, y1 = min(i['y0'] for i in cap), max(i['y1'] for i in cap); lines = max(i['lines'] for i in cap)
            dur, n, v = c['e'] - c['s'], load(c['text']), []
            if y0 < R['CAP_TOP_MIN']: v.append(f'caption too high y={y0:.0f}')
            if y1 > R['SAFE_B']: v.append(f'caption too low y={y1:.0f}')
            if lines > R['CAP_MAX_LINES']: v.append(f'caption wraps to {lines} lines')
            if n > R['CAP_MAX_LINE']: v.append(f'caption {n:.0f} chars')
            if dur < R['CAP_MIN_DUR']: v.append(f'caption shown {dur:.2f}s')
            elif n / dur > R['CAP_MAX_CPS']: v.append(f'caption {n / dur:.1f} chars/s')
            near = [i for i in items if not i['cap'] and not i['texture'] and i['y1'] > y0 - R['CAP_CLEAR'] and i['y0'] < y1]
            if near: v.append(f"text crowding the caption 「{near[0]['t'][:8]}」")
            issues += [(f"caption {c['s']:.1f}s「{c['text']}」", x) for x in v]
        b.close()
    caps = [x for x in issues if x[0].startswith('caption')]
    if caps:
        print(f'\n{len(caps)} caption issue(s):', Counter(re.sub(r'[\d.]+.*', '', v).strip() for _, v in caps).most_common())
        for x in caps[:10]: print('  ', *x)
    print(f'\n{len(issues)} issue(s)')
    sys.exit(1 if issues else 0)


if __name__ == '__main__':
    main()

"""Style templates for the Magic Move deck: render one diagram in every style, or switch diagrams to a style.

Every styles/<id>/diagram.html exposes the same helpers (box, node, frame, arrow, lbl, plain, title, ...),
the same 9 role slots (C.user ... C.error) and the same CONFIG-free main() contract, so the main() of
any diagram renders unchanged in any style. This script moves a main() between templates.

usage:
  python3 styles.py list
  python3 styles.py samples details/01_topic.html --out style-samples
      -> style-samples/<style>.html + <style>.png for every style, and style-samples/contact-sheet.png (2x2)
  python3 styles.py apply minimal overview.html details/*.html
      -> rewrites each file in place: the chosen style's helpers, the file's own main() and canvas size

Run it from anywhere; it finds the templates next to itself (../styles). Needs Playwright Chromium for
`samples`; rendering loads rough.js from jsDelivr.
"""
import argparse
import html
import os
import re
import sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLES_DIR = os.path.join(SKILL, 'styles')
MARK = 'main();\nwindow.__renderDone = true;'
MAIN = re.compile(r'^function main\(\)', re.M)
CANVAS = re.compile(r'<canvas id="c" width="(\d+)" height="(\d+)"></canvas>')
STAGE = re.compile(r'<div class="stage" style="width: \d+px; height: \d+px;">')


def styles():
    """Style ids in display order (STYLE.md `<!-- order: N -->` line), with their one-line descriptions."""
    out = []
    for sid in sorted(os.listdir(STYLES_DIR)):
        md = os.path.join(STYLES_DIR, sid, 'STYLE.md')
        if not os.path.isfile(os.path.join(STYLES_DIR, sid, 'diagram.html')):
            continue
        text = open(md, encoding='utf-8').read() if os.path.isfile(md) else ''
        head = re.search(r'^# (.+)$', text, re.M)
        blurb = re.search(r'^> (.+)$', text, re.M)
        order = re.search(r'<!-- order: (\d+) -->', text)
        out.append((int(order.group(1)) if order else 99, sid, head.group(1) if head else sid, blurb.group(1) if blurb else ''))
    return [(sid, name, blurb) for _, sid, name, blurb in sorted(out)]


def split(src, path):
    """(helpers before main, main() source, canvas w, canvas h) of a diagram or template."""
    assert src.count(MARK) == 1, f'{path}: expected exactly one "{MARK!r}"'
    ms = list(MAIN.finditer(src))
    assert ms, f'{path}: no top-level "function main()"'
    i, j = ms[-1].start(), src.index(MARK)
    m = CANVAS.search(src)
    assert m, f'{path}: no <canvas id="c" width=.. height=..>'
    return src[:i], src[i:j], int(m.group(1)), int(m.group(2))


def restyle(sid, main_src, w, h, base=None):
    """The chosen style's template with this main() and canvas size (base: directory images resolve against)."""
    tpl_path = os.path.join(STYLES_DIR, sid, 'diagram.html')
    tpl = open(tpl_path, encoding='utf-8').read()
    head, _, _, _ = split(tpl, tpl_path)
    out = head + main_src + tpl[tpl.index(MARK):]
    out = CANVAS.sub(f'<canvas id="c" width="{w}" height="{h}"></canvas>', out, count=1)
    out = STAGE.sub(f'<div class="stage" style="width: {w}px; height: {h}px;">', out, count=1)
    if base:
        out = out.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<base href="file://{html.escape(base)}/">', 1)
    return out


def render(page, path, png, w, h):
    page.set_viewport_size({'width': w, 'height': h})
    page.goto('file://' + path)
    page.wait_for_function('window.__renderDone === true', timeout=60000)
    page.evaluate('document.fonts.ready.then(() => true)')
    page.screenshot(path=png)


def cmd_samples(a):
    from playwright.sync_api import sync_playwright
    src_path = os.path.abspath(a.diagram)
    _, main_src, w, h = split(open(src_path, encoding='utf-8').read(), src_path)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    chosen = [s for s in styles() if not a.styles or s[0] in a.styles.split(',')]
    base = os.path.dirname(src_path) if os.path.dirname(src_path) != out else None
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        shots = []
        for sid, name, _ in chosen:
            hp, png = os.path.join(out, sid + '.html'), os.path.join(out, sid + '.png')
            open(hp, 'w', encoding='utf-8').write(restyle(sid, main_src, w, h, base))
            render(page, hp, png, w, h)
            shots.append((sid, name, png))
            print('wrote', png)
        # contact sheet: 2 columns, each sample at half size, labelled "A · handdrawn · 手绘" ...
        cw, ch = w // 2, h // 2
        cells = ''.join(
            f'<figure><img src="file://{html.escape(png)}" width="{cw}" height="{ch}">'
            f'<figcaption>{chr(65 + k)} · {html.escape(name)}</figcaption></figure>'
            for k, (_, name, png) in enumerate(shots))
        sheet = os.path.join(out, 'contact-sheet.html')
        open(sheet, 'w', encoding='utf-8').write(
            '<!DOCTYPE html><meta charset="utf-8"><style>'
            'body{margin:0;background:#e9e9ec;font:600 26px system-ui,"PingFang SC",sans-serif;color:#222}'
            '.g{display:grid;grid-template-columns:repeat(2,max-content);gap:28px;padding:28px}'
            'figure{margin:0}img{display:block;border:1px solid #c9c9cf;box-shadow:0 6px 20px rgba(0,0,0,.08)}'
            'figcaption{padding:12px 2px 0}</style>'
            f'<div class="g">{cells}</div><script>window.__renderDone = true;</script>')
        rows = (len(shots) + 1) // 2
        page.set_viewport_size({'width': 2 * cw + 3 * 28 + 4, 'height': rows * (ch + 60) + (rows + 1) * 28})
        page.goto('file://' + sheet)
        page.wait_for_function('[...document.images].every(i => i.complete)')
        page.screenshot(path=os.path.join(out, 'contact-sheet.png'), full_page=True)
        print('wrote', os.path.join(out, 'contact-sheet.png'))
        browser.close()
    if errors:
        sys.exit('page errors:\n' + '\n'.join(errors))


def cmd_apply(a):
    ids = [s[0] for s in styles()]
    if a.style not in ids:
        sys.exit(f'unknown style {a.style!r}; choose one of {", ".join(ids)}')
    for f in a.files:
        path = os.path.abspath(f)
        _, main_src, w, h = split(open(path, encoding='utf-8').read(), path)
        open(path, 'w', encoding='utf-8').write(restyle(a.style, main_src, w, h))
        print(f'{f}: {a.style} ({w}x{h})')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('list', help='available styles')
    s = sub.add_parser('samples', help='render one diagram in every style + a 2x2 contact sheet')
    s.add_argument('diagram')
    s.add_argument('--out', default='style-samples')
    s.add_argument('--styles', default='', help='comma-separated subset (default: all)')
    p = sub.add_parser('apply', help='switch diagrams to a style in place (keeps each main() and canvas size)')
    p.add_argument('style')
    p.add_argument('files', nargs='+')
    a = ap.parse_args()
    if a.cmd == 'list':
        for sid, name, blurb in styles():
            print(f'{sid:10s} {name}  —  {blurb}')
    elif a.cmd == 'samples':
        cmd_samples(a)
    else:
        cmd_apply(a)


if __name__ == '__main__':
    main()

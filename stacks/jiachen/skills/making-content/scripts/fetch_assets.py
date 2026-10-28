#!/usr/bin/env python3
"""Fetch the non-capture assets a project needs, into the project dir.

    python3 fetch_assets.py fonts                                   # fonts/fonts.css + woff2 (Inter, Source Serif 4, JetBrains Mono)
    python3 fetch_assets.py logo oven-sh --repo oven-sh/bun         # logos/oven-sh.png from the repo owner's GitHub avatar
    python3 fetch_assets.py logo ferris --url https://rustacean.net/assets/rustacean-flat-happy.png
    python3 fetch_assets.py music "Digital Lemonade"                # music/Digital_Lemonade.mp3 + prints the CC-BY credit line

Chinese glyphs come from the system (Noto Sans CJK SC / PingFang SC); only Latin faces are downloaded.
"""
import argparse, hashlib, os, re, sys, urllib.parse
import requests

FONT_FAMILIES = ['Inter:wght@400;600;800', 'Source+Serif+4:wght@400;600', 'JetBrains+Mono:wght@400;700']   # the --sans/--serif/--mono faces compositor.html names
BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'   # Google Fonts serves woff2 only to modern UAs
AVATAR_SIZE = 256   # px; stickers render at <= 132 px, so 2x is enough


def get(url, **kw):
    r = requests.get(url, timeout=30, headers={'User-Agent': BROWSER_UA}, **kw)
    r.raise_for_status(); return r


def fonts():
    os.makedirs('fonts', exist_ok=True); blocks = []
    for fam in FONT_FAMILIES:
        css = get(f'https://fonts.googleapis.com/css2?family={fam}&display=swap').text
        for sub, block in re.findall(r'/\* ([\w-]+) \*/\s*(@font-face \{.*?\})', css, re.S):
            if sub not in ('latin', 'latin-ext'):
                continue
            url = re.search(r'url\((.*?)\)', block).group(1); name = hashlib.md5(url.encode()).hexdigest()[:10] + '.woff2'
            if not os.path.exists(f'fonts/{name}'):
                open(f'fonts/{name}', 'wb').write(get(url).content)
            blocks.append(block.replace(url, name))
    open('fonts/fonts.css', 'w').write('\n'.join(blocks)); print(f'fonts/fonts.css ({len(blocks)} faces)')


def logo(name, repo=None, url=None):
    os.makedirs('logos', exist_ok=True)
    if repo:   # github.com/<org>.png and avatars/<login> are often blocked or return a placeholder; the repo page has the real /u/<id> URL
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(); pg.goto(f'https://github.com/{repo}', wait_until='domcontentloaded', timeout=45000)
            src = pg.evaluate(r"() => { const i = [...document.querySelectorAll('img')].find(i => /avatars\.githubusercontent\.com\/u\//.test(i.src)); return i && i.src; }")
            b.close()
        if not src:
            sys.exit(f'no owner avatar found on github.com/{repo}')
        url = src.split('?')[0] + f'?s={AVATAR_SIZE}&v=4'
    if not url:
        sys.exit('give --repo owner/repo or --url')
    data = get(url).content
    if len(data) < 500:
        sys.exit(f'{url} returned {len(data)} bytes — probably an error page')
    open(f'logos/{name}.png', 'wb').write(data); print(f'logos/{name}.png <- {url}')


def music(track):
    os.makedirs('music', exist_ok=True); fn = 'music/' + track.replace(' ', '_') + '.mp3'
    url = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/' + urllib.parse.quote(track) + '.mp3'
    open(fn, 'wb').write(get(url).content)
    print(fn); print(f'credit (put it in the post description): Music: "{track}" Kevin MacLeod (incompetech.com), CC BY 4.0')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd', required=True)
    sp.add_parser('fonts')
    lg = sp.add_parser('logo'); lg.add_argument('name'); lg.add_argument('--repo'); lg.add_argument('--url')
    mu = sp.add_parser('music'); mu.add_argument('track')
    a = ap.parse_args()
    try:
        fonts() if a.cmd == 'fonts' else logo(a.name, a.repo, a.url) if a.cmd == 'logo' else music(a.track)
    except requests.RequestException as e:
        sys.exit(f'download failed: {e} (a sandbox allowlist may block the host; fetch it elsewhere and drop it in place)')

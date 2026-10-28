#!/usr/bin/env python3
"""Render the compositor page frame by frame into an H.264 mp4 (or preview stills).

    python3 render.py --stills            # the settled last frame of every shot + sheet.jpg contact sheet
    python3 render.py --stills 0.5 12 40  # specific times
    python3 render.py --out final.mp4     # full video with mix.wav, loudness-normalised
    python3 render.py --cover cover.html --out cover.png   # screenshot a static cover page

The compositor is copied into the project dir on first run (compositor.html) so a project can
tweak layouts without touching the skill. Run from the project dir (fonts/, logos/, shots/ live there).
"""
import argparse, glob, json, os, shutil, subprocess, sys
from playwright.sync_api import sync_playwright

FPS = 30               # platform-native frame rate; 60 doubles render time for no visible gain on slides and zooms
JPEG_Q = 92            # frames travel as JPEG to ffmpeg; 92 is visually lossless for flat graphics
CRF = 21               # ~10-20 MB for 90 s of 1080x1920 graphics; chat uploads cap at 30 MB
LOUDNESS = 'loudnorm=I=-14:TP=-1.5:LRA=11'   # common short-video target (-14 LUFS)
HERE = os.path.dirname(os.path.abspath(__file__))


def open_page(p, page, tl, idx):
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    pg = b.new_page(viewport={'width': 1080, 'height': 1920})
    errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('file://' + os.path.abspath(page))
    try:
        pg.evaluate('([tl, idx]) => setup(tl, idx)', [tl, idx])
    except Exception as e:
        sys.exit(f'compositor setup failed: {e}\n{errors}')
    return b, pg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default='compositor.html'); ap.add_argument('--timeline', default='timeline.json')
    ap.add_argument('--captures', default='shots/index.json'); ap.add_argument('--audio', default='mix.wav')
    ap.add_argument('--out', default='video.mp4'); ap.add_argument('--stills', nargs='*', type=float)
    ap.add_argument('--cover', help='static HTML page to screenshot at 1080x1920 (see templates/cover.html)')
    a = ap.parse_args()
    if a.cover:
        with sync_playwright() as p:
            b = p.chromium.launch(args=['--allow-file-access-from-files']); pg = b.new_page(viewport={'width': 1080, 'height': 1920})
            pg.goto('file://' + os.path.abspath(a.cover)); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(300)
            pg.screenshot(path=a.out); b.close()
        print('->', a.out); return
    if not os.path.exists(a.page):
        shutil.copy(os.path.join(HERE, 'compositor.html'), a.page); print('copied compositor.html into the project')
    tl = json.load(open(a.timeline)); idx = json.load(open(a.captures)) if os.path.exists(a.captures) else {}
    with sync_playwright() as p:
        b, pg = open_page(p, a.page, tl, idx)
        if a.stills is not None:
            ts = a.stills or [s['end'] - 0.35 for s in tl['shots']]   # settled end state of every shot
            os.makedirs('stills', exist_ok=True)
            for f in glob.glob('stills/*.png'):
                os.remove(f)
            for k, t in enumerate(ts):
                pg.evaluate(f'render({t})'); pg.screenshot(path=f'stills/{k:02d}.png')
            b.close()
            from PIL import Image
            fs = sorted(glob.glob('stills/*.png')); W, H, cols = 240, 427, min(9, len(fs)); rows = -(-len(fs) // cols)
            sheet = Image.new('RGB', (W * cols, H * rows), 'white')
            for k, f in enumerate(fs):
                sheet.paste(Image.open(f).convert('RGB').resize((W, H)), ((k % cols) * W, (k // cols) * H))
            sheet.save('sheet.jpg', quality=88); print(f'{len(fs)} stills -> stills/, sheet.jpg')
            return
        n = int(tl['total'] * FPS)
        ff = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'mjpeg', '-i', '-',
                               '-i', a.audio, '-af', LOUDNESS, '-c:v', 'libx264', '-preset', 'medium', '-crf', str(CRF), '-pix_fmt', 'yuv420p',
                               '-r', str(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', a.out],
                              stdin=subprocess.PIPE)
        for i in range(n):
            pg.evaluate(f'render({i / FPS})'); ff.stdin.write(pg.screenshot(type='jpeg', quality=JPEG_Q))
            if i % (FPS * 20) == 0:
                print(f'{i}/{n} frames', flush=True)
        ff.stdin.close(); code = ff.wait(); b.close()
        if code:
            sys.exit(f'ffmpeg exited {code}')
        print('->', a.out, f'{os.path.getsize(a.out) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()

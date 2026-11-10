"""Record keynote.html to video, frame by frame, at the deck's own transition timing.

Each slide is held (one screenshot, repeated); each transition is stepped with __deck.freeze(i, j, p)
at FPS, so motion is exact regardless of machine speed. PNG frames are piped straight into ffmpeg,
which writes a 4K master and a 1080p copy in one pass. Music, if given, is trimmed and faded to fit
and normalized to LUFS.

usage: python3 render_video.py [music.mp3]   -> video/<VIDEO_NAME>_4k.mp4, video/<VIDEO_NAME>_1080p.mp4
       python3 render_video.py --mux-only music.mp3   (reuse video/silent_*.mp4, only add the music)

Copy this file next to keynote.html; keep video/ out of git (large, regenerable).
"""
import os
import subprocess
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, 'keynote.html')
OUT = os.path.join(HERE, 'video')
VIDEO_NAME = 'deck'
FPS = 60
PAPER_JS = "getComputedStyle(document.getElementById('stage')).backgroundColor"   # fades from / to the style's paper
FADE_IN, FADE_OUT = 0.8, 1.5
LUFS = -16.0                            # music is the only audio track; keep it at a calm background level


def hold_seconds(sl, i, n):
    """Seconds a slide stays still before the next transition starts."""
    if sl['d'] == 'cv':
        return 3.5                      # opening card
    if sl['d'] == 'end':
        return 4.5                      # closing card
    if sl['d'] == 'ov':
        return 2.0 if sl.get('focus') else 3.0
    return 2.5 if sl.get('focus') else 3.0


def record(silent_4k, silent_1080):
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--force-color-profile=srgb'])
        page = browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=2)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_function('window.__ready === true', timeout=60000)
        slides = page.evaluate('__deck.SLIDES')
        paper = '0x' + ''.join(f'{int(v):02x}' for v in page.evaluate(PAPER_JS).split('(')[1].split(')')[0].split(',')[:3])
        n = len(slides)
        # plan: (hold i) (transition i→i+1) (hold i+1) ...
        frames, plan = 0, []
        for i in range(n):
            plan.append(('hold', i, round(hold_seconds(slides[i], i, n) * FPS)))
            if i + 1 < n:
                plan.append(('trans', i, None))
        total = None
        ff = None
        shot = lambda: page.screenshot(type='png')
        for kind, i, count in plan:
            if kind == 'hold':
                page.evaluate(f'__deck.setState({i})')
                png = shot()
                frames_here = [png] * count
            else:
                dur = page.evaluate(f'__deck.freeze({i}, {i + 1}, 0)') / 1000
                k = round(dur * FPS)
                frames_here = []
                for f in range(1, k):            # f = k is the next slide's first held frame
                    page.evaluate(f'__deck.freeze({i}, {i + 1}, {f / k})')
                    frames_here.append(shot())
                page.evaluate(f'__deck.freeze({i}, {i + 1}, 1)')
            if ff is None:
                total = estimate_total(page, slides, n)
                ff = start_ffmpeg(silent_4k, silent_1080, total, paper)
            for b in frames_here:
                ff.stdin.write(b)
            frames += len(frames_here)
            print(f'{kind:5s} {i:2d}  frames={frames}  t={frames / FPS:6.2f}s', flush=True)
        ff.stdin.close()
        assert ff.wait() == 0, 'ffmpeg failed'
        browser.close()
        assert not errors, errors
        return frames / FPS


def estimate_total(page, slides, n):
    """Exact length up front (ffmpeg's fade-out needs it): holds + transition frames."""
    t = sum(round(hold_seconds(slides[i], i, n) * FPS) for i in range(n))
    durs = page.evaluate('''(n) => { const d = []; for (let i = 0; i + 1 < n; i++) d.push(__deck.freeze(i, i + 1, 0)); __deck.setState(0); return d; }''', n)
    t += sum(round(d / 1000 * FPS) - 1 for d in durs)
    return t / FPS


def start_ffmpeg(out4k, out1080, total, paper):
    vf = (f'fade=t=in:d={FADE_IN}:color={paper},fade=t=out:st={total - FADE_OUT:.3f}:d={FADE_OUT}:color={paper},'
          'format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv,'
          'split=2[a][b];[b]scale=1920:1080:flags=lanczos[c]')
    tag = ['-movflags', '+faststart']   # ffmpeg 8 takes color tags from the frames (setparams), not -color_* flags
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', str(FPS), '-c:v', 'png', '-i', '-',
           '-filter_complex', '[0:v]scale=out_color_matrix=bt709,' + vf,
           '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', *tag, out4k,
           '-map', '[c]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', *tag, out1080]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def music_gain_db(music, total):
    """Gain that brings the used span to LUFS integrated loudness, capped so the true peak stays under -1 dBFS."""
    err = subprocess.run(['ffmpeg', '-nostats', '-hide_banner', '-i', music, '-af', f'atrim=0:{total:.3f},ebur128=peak=true',
                          '-f', 'null', '-'], capture_output=True, text=True, check=True).stderr
    lufs = float(err.rsplit('I:', 1)[1].split('LUFS')[0])
    peak = float(err.rsplit('Peak:', 1)[1].split('dBFS')[0])
    return min(LUFS - lufs, -1.0 - peak)


def add_music(video, music, total, gain_db, dst):
    af = f'atrim=0:{total:.3f},afade=t=in:d=2,afade=t=out:st={total - 6:.3f}:d=6,volume={gain_db:.2f}dB,aresample=48000'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-i', music, '-filter_complex', f'[1:a]{af}[m]',
                    '-map', '0:v', '-map', '[m]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart',
                    '-shortest', dst], check=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    s4k, s1080 = os.path.join(OUT, 'silent_4k.mp4'), os.path.join(OUT, 'silent_1080p.mp4')
    if '--mux-only' not in sys.argv:
        total = record(s4k, s1080)
    else:
        total = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', s4k]))
    print(f'video {total:.2f}s')
    music = next((a for a in sys.argv[1:] if not a.startswith('--')), None)
    if music:
        gain = music_gain_db(music, total)
        print(f'music gain {gain:+.1f} dB')
        for src, name in ((s4k, f'{VIDEO_NAME}_4k.mp4'), (s1080, f'{VIDEO_NAME}_1080p.mp4')):
            add_music(src, music, total, gain, os.path.join(OUT, name))
            print('wrote', os.path.join(OUT, name))


if __name__ == '__main__':
    main()

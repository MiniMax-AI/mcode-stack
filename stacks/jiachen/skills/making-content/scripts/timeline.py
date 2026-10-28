#!/usr/bin/env python3
"""Turn script.json + per-line TTS clips into timeline.json (shots, captions) and mix.wav.

    python3 timeline.py --script script.json --tts tts --music music/Digital_Lemonade.mp3

* Shot cuts land on the word named by a shot's "anchor" (word timestamps from tts.py).
* Captions come from each line's "cap" ('/' and punctuation mark the breaks), re-split to one
  short line each, and merged when a piece would flash by too fast. Punctuation is dropped.
* Audio = voice + music ducked under speech (whoosh on layout changes, off by default).
  No per-element "pop" sounds (viewers found them distracting).
"""
import argparse, json, os, re, subprocess, sys
import numpy as np, soundfile as sf

LEAD, GAP, TAIL = 0.1, 0.1, 1.6     # s: silence before the first line / between lines / after the last
SR = 48000                          # Hz; the rate render.py encodes AAC at
CAP_MAX = 16                        # caption load per line (汉字 = 1, latin char = .5); Netflix zh-CN allows 16
CAP_MIN_DUR, CAP_MAX_CPS = 0.6, 9   # s on screen / chars per second (Netflix adult reading speed)
CUT_LEAD = 0.12                     # s: cut slightly before the anchor word so the picture lands with the word
DUCK_SPEECH, DUCK_GAP = 0.11, 0.26  # music gain under speech / in pauses (~14 dB / ~6 dB below the voice)
DUCK_ON = 0.03                      # envelope level that counts as speech (envelope normalised to 1)
WHOOSH_GAIN = 0.0                   # transition whoosh off: viewers found sound effects odd; 0.18 was audible under the voice


def load(s):
    return sum(1 if ord(ch) > 0x2e80 else 0.5 for ch in s if not ch.isspace() and ch not in '，。、：；？！,.:;?!“”"')


def keep(c):
    return not (c.isspace() or c in '，、：；。？！,.:;?!')


def speakable(text):   # must match tts.py
    return re.sub(r'(?<=[A-Za-z0-9])[_-](?=[A-Za-z0-9])', ' ', text)


def split_cap(p):
    if load(p) <= CAP_MAX:
        return [p]
    latin = lambda ch: ch.isascii() and (ch.isalnum() or ch in '_$%.+-')
    cands = [i for i in range(1, len(p)) if not (latin(p[i - 1]) and latin(p[i]))
             and not (p[i] == ' ' and i + 1 < len(p) and latin(p[i - 1]) and latin(p[i + 1])) and p[i] not in '的了吗呢']
    half = load(p) / 2
    i = min(cands, key=lambda i: abs(load(p[:i]) - half)) if cands else len(p) // 2
    return split_cap(p[:i].strip()) + split_cap(p[i:].strip())


def merge_fast(cues, start):
    """Merge a too-short/too-fast caption into a neighbour, preferring not to cross a sentence end."""
    bad = lambda c: c['e'] - c['s'] < CAP_MIN_DUR or load(c['text']) / max(c['e'] - c['s'], 0.01) > CAP_MAX_CPS
    k = start
    while k < len(cues):
        if bad(cues[k]):
            opts = []
            for j in (k - 1, k + 1):
                if start <= j < len(cues):
                    a, b = sorted((k, j))
                    m = {'s': cues[a]['s'], 'e': cues[b]['e'], 'text': cues[a]['text'] + ' ' + cues[b]['text'], 'end': cues[b]['end']}
                    if load(m['text']) <= CAP_MAX:
                        opts.append(((10 if cues[a]['end'] else 0) + load(m['text']) / (m['e'] - m['s']), a, b, m))
            if opts:
                _, a, b, m = min(opts, key=lambda o: o[0]); cues[a] = m; del cues[b]; k = start; continue
        k += 1


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    if not out.strip():
        sys.exit(f'cannot read {path}; run tts.py first')
    return float(out)


def build(script, tts_dir):
    t, lines, shots, cues = LEAD, [], [], []
    for i, x in enumerate(script['lines']):
        base = os.path.join(tts_dir, f'{i:02d}')
        d = duration(base + '.mp3'); j = json.load(open(base + '.json'))
        text, T = j['text'], []
        for w in j['words']:
            cs = [c for c in w['word'] if keep(c)]
            T += [w['startTime'] + (w['endTime'] - w['startTime']) * k / max(1, len(cs)) for k in range(len(cs))]
        T.append(j['words'][-1]['endTime'] if j['words'] else d)

        def at(anchor):
            a = speakable(anchor)
            if a not in text:
                sys.exit(f'line {i}: anchor {anchor!r} not found in narration')
            return t + T[min(sum(1 for c in text[:text.index(a)] if keep(c)), len(T) - 1)]
        lines.append({'i': i, 'start': round(t, 3), 'dur': d})
        for k, sh in enumerate(x['shots']):
            st = 0 if (i == 0 and k == 0) else (at(sh['anchor']) - CUT_LEAD if sh.get('anchor') else t)
            sh = {**sh, 'start': round(max(0, st), 3), 'chapter': x['chapter']}
            if sh['type'] == 'stack':
                sh['items'] = [{**it, 'at': round(at(it['anchor']), 3)} for it in sh['items']]
            shots.append(sh)
        pieces, ends = [], []
        for r in re.findall(r'[^，、：；。？！/]+[，、：；。？！/]?', x['cap']):
            body = r.rstrip('，、：；。？！/').strip()
            if body:
                sub = split_cap(body); pieces += sub; ends += [False] * (len(sub) - 1) + [r[-1:] in '。？！']
        tot, acc, n_, first = sum(load(p) for p in pieces) or 1, 0, len(T) - 1, len(cues)
        for p, e in zip(pieces, ends):
            k0 = round(acc / tot * n_); acc += load(p); k1 = round(acc / tot * n_)
            cues.append({'s': round(t + T[k0], 3), 'e': round(t + T[min(k1, n_)], 3), 'text': p, 'end': e})
        merge_fast(cues, first)
        t += d + GAP
    total = round(t - GAP + TAIL, 3)
    for k, sh in enumerate(shots):
        sh['end'] = shots[k + 1]['start'] if k + 1 < len(shots) else total
    return lines, shots, cues, total


def whoosh(rng):
    n = int(0.42 * SR); x = rng.standard_normal(n); out = np.zeros(n); hop = 512
    for s0 in range(0, n, hop):   # band-pass noise with a rising centre frequency
        seg = x[s0:s0 + hop * 2]; f = np.fft.rfft(seg, n=hop * 2); fr = np.fft.rfftfreq(hop * 2, 1 / SR)
        c = 300 + 5000 * (s0 / n); f *= np.exp(-((fr - c) / (c * 0.6)) ** 2); y = np.fft.irfft(f)[:len(seg)]
        out[s0:s0 + len(y)] += y * np.hanning(len(y))
    return out / np.abs(out).max() * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5 * WHOOSH_GAIN


def mix(lines, shots, total, tts_dir, music, out, tmp):
    n = int(total * SR)
    ins = sum([['-i', os.path.join(tts_dir, f"{L['i']:02d}.mp3")] for L in lines], [])
    flt = ';'.join(f"[{k}:a]aresample={SR},adelay={int(L['start'] * 1000)}|{int(L['start'] * 1000)}[a{k}]" for k, L in enumerate(lines))
    flt += ';' + ''.join(f'[a{k}]' for k in range(len(lines))) + f'amix=inputs={len(lines)}:normalize=0,apad,atrim=0:{total},pan=mono|c0=c0[o]'
    vpath = os.path.join(tmp, 'voice.wav')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *ins, '-filter_complex', flt, '-map', '[o]', '-ar', str(SR), '-ac', '1', vpath], check=True)
    voice, _ = sf.read(vpath); voice = np.pad(voice, (0, max(0, n - len(voice))))[:n]
    bed = np.zeros((n, 2))
    if music:
        mpath = os.path.join(tmp, 'music.wav')
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', music, '-ar', str(SR), '-ac', '2', mpath], check=True)
        m, _ = sf.read(mpath); m = np.tile(m, (int(np.ceil(n / len(m))), 1))[:n]
        env = np.convolve(np.abs(voice), np.ones(int(0.25 * SR)) / int(0.25 * SR), mode='same'); env /= env.max() + 1e-9
        duck = np.convolve(np.where(env > DUCK_ON, DUCK_SPEECH, DUCK_GAP), np.ones(int(0.3 * SR)) / int(0.3 * SR), mode='same')
        fade = np.ones(n); fade[-int(2.5 * SR):] = np.linspace(1, 0, int(2.5 * SR)); fade[:int(0.4 * SR)] = np.linspace(0, 1, int(0.4 * SR))
        bed = m * (duck * fade)[:, None]
    fx, rng = np.zeros(n), np.random.default_rng(7)
    for k in range(1, len(shots)):
        if shots[k]['type'] != shots[k - 1]['type']:
            w = whoosh(rng); i0 = max(0, int((shots[k]['start'] - CUT_LEAD) * SR)); seg = w[:max(0, n - i0)]; fx[i0:i0 + len(seg)] += seg
    m = bed + (voice + fx)[:, None]
    sf.write(out, m / max(1.0, np.abs(m).max() / 0.97), SR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='script.json'); ap.add_argument('--tts', default='tts')
    ap.add_argument('--music', help='background track (looped, ducked under the voice)')
    ap.add_argument('--out', default='timeline.json'); ap.add_argument('--mix', default='mix.wav'); ap.add_argument('--tmp', default='.')
    a = ap.parse_args()
    script = json.load(open(a.script))
    lines, shots, cues, total = build(script, a.tts)
    json.dump({'meta': script.get('meta', {}), 'shots': shots, 'cues': cues, 'total': total, 'lines': lines},
              open(a.out, 'w'), ensure_ascii=False)
    mix(lines, shots, total, a.tts, a.music, a.mix, a.tmp)
    print(f'{total:.1f}s, {len(shots)} shots, {len(cues)} captions -> {a.out}, {a.mix}')


if __name__ == '__main__':
    main()

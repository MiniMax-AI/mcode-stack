#!/usr/bin/env python3
"""Synthesize one audio clip per narration line, with word timestamps.

Writes <out>/NN.mp3 and <out>/NN.json = {"text": ..., "words": [{"word", "startTime", "endTime"}]}
(seconds). Existing clips are kept unless --force, so a re-run only fills gaps.

    # draft voice, free, no key (Microsoft Edge read-aloud)
    python3 tts.py --engine edge --voice zh-CN-YunxiNeural
    # final voice: Volcengine Doubao voice clone (needs a key and a trained speaker id)
    VOLC_TTS_API_KEY=... VOLC_TTS_SPEAKER=S_xxxxxxx python3 tts.py --engine volc

Underscores/hyphens between letters are spoken as spaces (rusty_v8 -> "rusty v8"),
otherwise TTS engines read them aloud as "杠"/"underscore". Captions keep the original text.
"""
import argparse, asyncio, base64, json, os, re, ssl, sys, uuid
from concurrent.futures import ThreadPoolExecutor

VOLC_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
VOLC_RESOURCE = 'seed-icl-2.0'   # 声音复刻 2.0「字符版」(per-character billing); the「并发版」needs purchased concurrency
VOLC_RATE = 25                   # speech_rate in [-50, 100]; 25 ≈ 5.5 汉字/s, a brisk explainer pace
VOLC_CONTEXT = '用轻松、口语化、像跟朋友聊天的语气说'   # voice instruction; officially for preset voices, harmless on clones
EDGE_RATE = '+12%'               # Edge's default pace is slow for short video
WORKERS = 4                      # stay well under the 10 concurrent requests of the per-character plan
VOLC_ERRORS = {
    45000030: 'resource not granted: in the Doubao voice console, enable 声音复刻 2.0 (字符版) and grant this API key access to it',
    45000292: 'concurrency quota exceeded: the 并发版 resource has 0 purchased concurrency; use the 字符版 resource (seed-icl-2.0)',
}


def speakable(text):
    return re.sub(r'(?<=[A-Za-z0-9])[_-](?=[A-Za-z0-9])', ' ', text)


def volc(text, out):
    import requests
    key, spk = os.environ.get('VOLC_TTS_API_KEY'), os.environ.get('VOLC_TTS_SPEAKER')
    if not key or not spk:
        sys.exit('set VOLC_TTS_API_KEY and VOLC_TTS_SPEAKER (the S_... voice id) first')
    req = {'text': text, 'speaker': spk, 'context_texts': [VOLC_CONTEXT],
           'audio_params': {'format': 'mp3', 'sample_rate': 24000, 'speech_rate': VOLC_RATE, 'enable_subtitle': True}}
    last = None
    for _ in range(3):
        r = requests.post(VOLC_URL, stream=True, timeout=120, json={'user': {'uid': 'video'}, 'req_params': req},
                          headers={'X-Api-Key': key, 'X-Api-Resource-Id': os.environ.get('VOLC_TTS_RESOURCE', VOLC_RESOURCE),
                                   'X-Api-Request-Id': uuid.uuid4().hex,   # required; requests without it were rejected
                                   'Content-Type': 'application/json'})
        audio, words = b'', []
        for line in r.iter_lines():
            if not line:
                continue
            j = json.loads(line)
            if j.get('data'):
                audio += base64.b64decode(j['data'])
            elif (j.get('sentence') or {}).get('words'):
                words += j['sentence']['words']
            else:
                last = j
        code = (last or {}).get('code') or ((last or {}).get('header') or {}).get('code')
        if audio and code == 20000000:
            open(out + '.mp3', 'wb').write(audio)
            return [{'word': w['word'], 'startTime': w['startTime'], 'endTime': w['endTime']} for w in words]
        if code in VOLC_ERRORS:
            sys.exit(f'Volcengine {code}: {VOLC_ERRORS[code]}')
    sys.exit(f'Volcengine TTS failed: {last}')


def edge(text, out, voice):
    import aiohttp, edge_tts

    async def run():
        ca = os.environ.get('SSL_CERT_FILE')   # behind a TLS-inspecting proxy, point this at the proxy CA bundle
        conn = aiohttp.TCPConnector(ssl=ssl.create_default_context(cafile=ca)) if ca else None
        com = edge_tts.Communicate(text, voice, rate=EDGE_RATE, boundary='WordBoundary', connector=conn)
        audio, words = b'', []
        async for ch in com.stream():
            if ch['type'] == 'audio':
                audio += ch['data']
            elif ch['type'] == 'WordBoundary':   # offset/duration are in 100 ns ticks
                s = ch['offset'] / 1e7; words.append({'word': ch['text'], 'startTime': s, 'endTime': s + ch['duration'] / 1e7})
        open(out + '.mp3', 'wb').write(audio)
        return words
    return asyncio.run(run())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', default='script.json'); ap.add_argument('--out', default='tts')
    ap.add_argument('--engine', choices=['edge', 'volc'], default='edge'); ap.add_argument('--voice', default='zh-CN-YunxiNeural')
    ap.add_argument('--force', action='store_true'); ap.add_argument('--only', type=int, nargs='*', help='line indexes to (re)generate')
    a = ap.parse_args()
    lines = json.load(open(a.script))['lines']; os.makedirs(a.out, exist_ok=True)

    def one(i):
        base = os.path.join(a.out, f'{i:02d}')
        if a.only is not None and i not in a.only:
            return
        if not a.force and a.only is None and os.path.exists(base + '.json') and os.path.exists(base + '.mp3'):
            return
        text = speakable(lines[i]['n'])
        words = volc(text, base) if a.engine == 'volc' else edge(text, base, a.voice)
        json.dump({'text': text, 'words': words}, open(base + '.json', 'w'), ensure_ascii=False)
        print(f'{i:02d} {len(words)} words')
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(one, range(len(lines))))


if __name__ == '__main__':
    main()

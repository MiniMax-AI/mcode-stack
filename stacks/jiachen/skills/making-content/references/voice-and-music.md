# Voice and music

## Contents

- Edge: the draft voice
- Volcengine voice clone: the posted voice (user setup, request, parameters, errors, docs)
- Letting the user pick a voice setting
- Music: source, choice, credit
- Mix levels

## Edge: the draft voice

`tts.py --engine edge` uses Microsoft Edge's read-aloud voices through the `edge-tts` package: free, no key, word timestamps included. Default voice `zh-CN-YunxiNeural` (male, lively) at `+12%`; `zh-CN-XiaoxiaoNeural` is a common female alternative. It still sounds like TTS, so it is for checking timing and layouts, not for posting.

Behind a TLS-inspecting proxy, set `SSL_CERT_FILE` to the proxy's CA bundle; `tts.py` passes it to the websocket connector.

## Volcengine voice clone: the posted voice

The user's own cloned voice (豆包语音 声音复刻) usually removes most of the "AI feel". It needs three things only the user can do, so ask for them in the first message:

1. In the Volcengine console, open 豆包语音 and create a voice clone (声音复刻) from a recording; training yields a speaker id like `S_xxxxxxxx`.
2. Enable the 声音复刻 2.0 **字符版** resource (billed per character). The 并发版 needs purchased concurrency; with none bought, every request fails with 45000292.
3. Create an API key and grant it that resource; until it is granted, requests fail with 45000030.

The user hands over the key and the speaker id in chat. They go into `VOLC_TTS_API_KEY` and `VOLC_TTS_SPEAKER` for the command, never into a file. Suggest revoking the key when the video is done. Console labels change from time to time; when they do not match, read the docs (below) rather than guessing.

### Request

```text
POST https://openspeech.bytedance.com/api/v3/tts/unidirectional
X-Api-Key:          <key>
X-Api-Resource-Id:  seed-icl-2.0              (字符版; override with VOLC_TTS_RESOURCE)
X-Api-Request-Id:   <fresh uuid>              (required; requests without it were rejected)
Content-Type:       application/json

{"user": {"uid": "video"},
 "req_params": {"text": "...", "speaker": "S_xxxxxxxx",
                "context_texts": ["用轻松、口语化、像跟朋友聊天的语气说"],
                "audio_params": {"format": "mp3", "sample_rate": 24000, "speech_rate": 25, "enable_subtitle": true}}}
```

The response streams JSON lines: `data` holds base64 audio chunks, `sentence.words` holds `{word, startTime, endTime}` in seconds (that is what `enable_subtitle` turns on), and the last line carries code `20000000` on success. `tts.py` handles all of this and retries twice.

### Parameters worth tuning

| Parameter | Range | Notes |
|---|---|---|
| `speech_rate` | -50 to 100 | 0 is slow for short video; 25 sounded brisk and natural (about 5 字/s with pauses). `VOLC_RATE` in tts.py. |
| `context_texts` | free text | A spoken style instruction. Officially for preset voices; on cloned voices it did no harm in testing. `VOLC_CONTEXT` in tts.py. |
| `pitch` | -12 to 12 | Leave at 0 for a clone; shifting it makes the voice stop sounding like the user. |

### Errors

| Code | Meaning | Fix |
|---|---|---|
| 20000000 | Success | — |
| 45000030 | Resource not granted | Enable 声音复刻 2.0 字符版 and grant the API key access to it |
| 45000292 | Concurrency quota exceeded | The 并发版 has 0 purchased concurrency; use `seed-icl-2.0` (字符版) |

The 字符版 has its own concurrency limit (10 at the time of writing; check the console); `tts.py` uses 4 workers to stay under it.

### Reading the docs

docs.volcengine.com pages render in JavaScript, so WebFetch sees an empty shell. Fetch the JSON behind a page instead, with `DocumentCode` set to the last path segment of the page URL:

```text
https://docs.volcengine.com/api/doc/getDocDetail?type=online&LibraryCode=DoubaoVoice&DocumentCode=tone-training-http
```

## Letting the user pick a voice setting

Voice one representative line, with a number and an English name in it, as 2–3 variants (for example speech_rate 10, 25 with the style instruction, 40), send them as files, and ask which one. Listen for: identifiers read with "杠" or letter by letter, numbers read in the wrong form, flat endings on questions. Respell in `n` and regenerate only that line with `--only N`, into a fresh `--out` directory if the rest is already approved.

## Music: source, choice, credit

**Source.** incompetech.com (Kevin MacLeod): direct mp3 downloads under CC BY 4.0, free with credit. `fetch_assets.py music "Digital Lemonade"` downloads by the exact track title used in the site's file name and prints the credit line.

**Choice.** Offer 2–3 tracks that fit the tone and let the user pick. For tech explainers, light electronic tracks without vocals work, for example "Digital Lemonade".

**Credit.** In the post description: `Music: "Digital Lemonade" Kevin MacLeod (incompetech.com), CC BY 4.0`.

**Platform music instead.** If the user wants a trending sound from the 抖音 library, run `timeline.py` without `--music` and they add the sound in the app.

## Mix levels

Set in `timeline.py`; the loudness target in `render.py`.

| What | Value | Why |
|---|---|---|
| Music under speech | ×0.11 | the voice stays clear on phone speakers |
| Music in pauses | ×0.26 | fills gaps without pumping |
| Speech detection | 0.25 s envelope, 0.3 s gain smoothing | ducking moves smoothly, not word by word |
| Fades | 0.4 s in, 2.5 s out | no hard start or stop |
| Transition whoosh | 0 (off) | pop sounds distracted viewers, and a softer whoosh still felt odd |
| Loudness | -14 LUFS integrated, -1.5 dBTP | the common short-video target |

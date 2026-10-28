# Making short videos

Turns source material into a 60–180 s vertical explainer that reads as hand-edited rather than generated. The pipeline is deterministic: `script.json` → one TTS clip per line with word timestamps → `timeline.json` + `mix.wav` → an HTML compositor that Playwright renders frame by frame → ffmpeg. Each default below fixed a real viewer complaint; the table at the end says which. The voice rules live in this skill's `SKILL.md`.


## Contents

- Setup
- Workflow: 1. Decide with the user first · 2. Write script.json · 3. Fetch assets · 4. Voice · 5. Timeline and mix · 6. Review stills and lint until clean · 7. Render and deliver
- Why the defaults are what they are
- Files

## Setup

Once per machine:

```bash
pip install -r requirements.txt            # in this skill's directory
python3 -m playwright install chromium
# also needed: ffmpeg + ffprobe on PATH, and a CJK system font (PingFang SC on macOS, Noto Sans CJK SC on Linux)
```

If this skill's directory has no `scripts/` (the copy is partial), the full package is in the repository the skill was installed from: ask the user to attach it or install the skill again.

One directory per video; run every script from it. `S` is this skill's `scripts/` directory (this file lives in `references/`, so from here `../scripts`).

```text
my-video/
  script.json          narration, captions, shots (written by you, from templates/script.example.json)
  sources.json         {"capture key": "https://..."} for real-page captures
  shots/ tts/ logos/ fonts/ music/                       fetched or generated
  compositor.html timeline.json mix.wav stills/ sheet.jpg final.mp4 cover.png
```

## Workflow

Copy into the task list and tick off:

```text
- [ ] 0. Check the topic can win (SKILL.md); stop if it is a dead end
- [ ] 1. Decide with the user: platform + length, voice, hook, music, what to keep out
- [ ] 2. Write script.json and sources.json
- [ ] 3. Fetch assets: fonts, logos, music, page captures
- [ ] 4. Voice: Edge draft now, cloned voice once the user's key is ready
- [ ] 5. Build timeline.json + mix.wav
- [ ] 6. Review stills and lint until 0 issues
- [ ] 7. Render, check, deliver video + cover + description
```

Review in order of cost: script text, then one voice sample, then the contact sheet, then a full render. Send each stage to the user while they are watching, so a wrong direction costs minutes rather than a render.

### 1. Decide with the user first

The user's taste moves the result more than any script, so ask in one round (AskUserQuestion where the harness has it), recommended option first:

| Question | Default |
|---|---|
| Platform and length | 抖音: one 75–95 s cut. 小红书, 视频号, B站: 2–3 min works. A long and a short cut can share one project. |
| Voice | Edge draft first; the user's cloned voice (Volcengine) for the posted version. |
| Hook | 3–4 hooks written from the material: counter-intuitive fact, shocking number, question, conclusion first. |
| Music | One incompetech track (CC BY, credited in the description); offer 2–3 that fit the tone. |
| Keep out | What is private: employer, colleagues, internal project names, personal details. Strip them before writing anything else. |

Put everything only the user can do into this first message, not at the end: creating a voice clone and API key in the Volcengine console (steps in `references/voice-and-music.md`), choosing music, supplying private logos or footage. Build with the Edge voice meanwhile.

Later, stop and ask whenever a choice changes the result a lot (voice, hook, cutting a section); decide smaller things yourself and say what you decided.

### 2. Write script.json

Read `references/layouts.md` for the schema and the ten layouts, and start from `templates/script.example.json`. Editorial rules:

- **Hook within 3 s.** Line 0 says the hook as a question; `meta.hook` shows it as a big overlay for the first 1.6 s. The first shot is the most striking real evidence, such as the source page saying "$0 in revenue".
- **Conclusion by about 15 s.** Line 2 or 3 starts with 先说结论 and states it in one short sentence; everything after is evidence.
- **Spoken, not written.** Short sentences, spoken connectives (你想想, 结果, 那 Cloudflare 呢？, 换我也得买), no parentheses, no enumerations. Say every `n` in your head.
- **Budget.** The cloned voice at speech_rate 25 averages about 5 字/s including pauses (Latin letters count half): 90 s ≈ 430–450 字 of narration, 3 min ≈ 850.
- **`n` and `cap` differ on purpose.** `n` is what the voice says (numbers as words when a voice misreads digits: 十亿美元). `cap` is what the caption shows: digits (10亿美元), identifiers in real spelling (fake_value_), and `/` wherever a caption should break.
- **New picture every 3–6 s, layouts rotating.** A back-to-back repeat is fine for a pair (two cards of a two-part conclusion), not for a whole section. A line can carry two shots; the second cuts on its `anchor` word.
- **Chinese first.** Every English quote gets a Chinese translation set larger than the original.
- **End on the conclusion** plus one question that invites comments (这是我的判断。你觉得最后谁会赢？评论区聊聊). No 下期预告 or 关注我 ending unless the user asks for one.

### 3. Fetch assets

```bash
python3 $S/fetch_assets.py fonts
python3 $S/fetch_assets.py logo oven-sh --repo oven-sh/bun      # GitHub owner avatar -> logos/oven-sh.png
python3 $S/fetch_assets.py logo ferris --url https://rustacean.net/assets/rustacean-flat-happy.png
python3 $S/fetch_assets.py music "Digital Lemonade"             # also prints the credit line
python3 $S/capture.py --script script.json --sources sources.json --out shots
```

`capture.py` exits non-zero if a phrase is not on the page: copy the phrase from the page exactly, or switch that shot to a `web` layout. If a sandbox allowlist blocks a host, ask the user to drop the file into place. More capture and logo tips are in references/layouts.md.

### 4. Voice

```bash
python3 $S/tts.py --engine edge --out tts-edge                                          # draft: free, no key
VOLC_TTS_API_KEY=... VOLC_TTS_SPEAKER=S_... python3 $S/tts.py --engine volc --out tts-volc   # posted version
```

- The key lives in environment variables only, never in a script, file or commit. Suggest revoking a temporary key when the video is done.
- Before voicing everything, voice one representative line (with a number and an English name in it) in 2–3 variants, send them, and let the user pick by ear. The defaults in `tts.py` (speech_rate 25 plus the conversational instruction) are a good starting point.
- Give every voice version its own `--out` directory. A re-run with `--force` or `--only` overwrites clips the user may already have approved.
- `tts.py` speaks `_` and `-` between letters or digits as a space (rusty_v8 → "rusty v8"); listen for other symbols and respell them in `n`.
- Behind a TLS-inspecting proxy, Edge needs `SSL_CERT_FILE` pointed at the proxy's CA bundle.

Console steps, parameters and error codes: `references/voice-and-music.md`.

### 5. Timeline and mix

```bash
python3 $S/timeline.py --script script.json --tts tts-volc --music music/Digital_Lemonade.mp3
```

Writes `timeline.json` (shots, caption cues, chapters) and `mix.wav` (voice and music ducked under speech; no sound effects). It stops with `anchor ... not found in narration` when an `anchor` is not a literal substring of that line's `n`.

A second cut in the same project shares captures, logos and music; give its script, voice clips and outputs their own names and pass them to every later step:

```bash
python3 $S/timeline.py --script script-90s.json --tts tts-90s --music music/Digital_Lemonade.mp3 --out timeline-90s.json --mix mix-90s.wav
python3 $S/lint.py --timeline timeline-90s.json
python3 $S/render.py --timeline timeline-90s.json --audio mix-90s.wav --out final-90s.mp4
```

### 6. Review stills and lint until clean

```bash
python3 $S/render.py --stills      # settled end state of every shot -> stills/NN.png + sheet.jpg
python3 $S/lint.py                 # exits 1 while anything fails
```

1. Open `sheet.jpg` with the Read tool and look: one focal point per frame, nothing clipped, no run of one layout, Chinese larger than English. Open single stills for detail; `render.py --stills 0.5 12.3` grabs exact times.
2. Fix every lint issue with the table in `references/text-density-lint.md` — usually shorter text, a second shot, or context dimmed to texture — and re-run both commands until lint prints `0 issue(s)`.
3. If a frame feels empty after thinning the text, add motion (logo stickers, a counter, bars), not words.

### 7. Render and deliver

```bash
python3 $S/render.py --out final.mp4
cp $S/../templates/cover.html . && python3 $S/render.py --cover cover.html --out cover.png
ffprobe -v error -show_entries format=duration,size -of csv=p=0 final.mp4    # planned length, under 30 MB
ffmpeg -i final.mp4 -af ebur128 -f null - 2>&1 | grep -A1 'Integrated'       # -16 to -14 LUFS (target -14)
```

A 90 s render takes about 3 minutes, so give it a long timeout or run it in the background; it comes out around 10–20 MB. Edit the cover's text and logos before rendering it; profile grids crop covers to 3:4, so keep its content inside y 240–1680.

Send `final.mp4` and `cover.png` to the user (SendUserFile where available), and put the post description in the reply:

- the conclusion in about 400 字, as numbered points, for people who will not watch;
- where the facts come from (official blogs, repos);
- the music credit printed by `fetch_assets.py`, e.g. `Music: "Digital Lemonade" Kevin MacLeod (incompetech.com), CC BY 4.0`.

Write the post description with the voice rules in this skill's `SKILL.md` (rewrite mode) before sending it.

## Why the defaults are what they are

Each row is a complaint from a real review of this pipeline and the default that fixed it. Keep them unless the user asks otherwise.

| Viewer said | Default |
|---|---|
| AI 味很重 | Mostly the voice: cloned voice, faster, conversational. Then real sources instead of slides, spoken copy, a cut every 3–6 s. |
| 容易走神 | Hook overlay on the first frame, hook question as line 0, music bed, chapter progress bar. |
| Screenshots too dense, no focal point | `spot` zooms one phrase and dims the rest; dense pages are re-typeset as `web`. |
| One layout for two minutes | Ten layouts, rotated. |
| Keyword sticker too close to captions | Stickers sit in the top zone (y ≈ 330); captions at y 1420. |
| Wants more real-world bits | Logo tiles, mascots and drifting shapes, all animated. |
| rusty_v8 read as "rusty 杠 v8" | `_` and `-` between letters are spoken as spaces. |
| A "biu" sound on every pop-in, then the whoosh felt odd too | No sound effects: `WHOOSH_GAIN = 0`. |
| The whole frame bouncing on the beat looked ugly | No whole-frame periodic zoom or shake; only elements inside a shot move. |
| Half the viewers gone by 20 s: the opening re-showed numbers and narrated how the material was read | The first frame is content, not a still cover; no "we read X" process lines. |
| The hook confused people who had not seen the earlier episode | The first 15 s make sense to a stranger, in units a stranger knows. |
| Too much English on screen | Chinese translation large, original small. |
| 字太密，眼花 | Lint gate: at most 4 text blocks and 36 字 per screen; captions one line of at most 16 字, low on screen. |
| Too empty after cutting text | Ambient motion instead of more words. |
| 下期预告 felt superfluous | No teaser ending. |
| Is 3 minutes right for 抖音? | 90 s main cut; the long cut goes to 小红书 or B站. |

## Files

| File | Use |
|---|---|
| `scripts/capture.py` | Run: real-page screenshots with the quoted phrase located |
| `scripts/tts.py` | Run: one voice clip per line with word timestamps (Edge or Volcengine) |
| `scripts/timeline.py` | Run: `timeline.json` + `mix.wav` |
| `scripts/render.py` | Run: stills and contact sheet, final mp4, cover png |
| `scripts/lint.py` | Run: text-density lint on the rendered frames |
| `scripts/fetch_assets.py` | Run: fonts, logos, music |
| `scripts/compositor.html` | Read when adding or changing a layout. The first `render.py`/`lint.py` run copies it into the project; edit that copy for one video, the skill's copy for all of them. |
| `templates/script.example.json` | Copy: one example of every layout |
| `templates/cover.html` | Copy and edit: the cover |
| `references/layouts.md` | Read while writing `script.json` |
| `references/voice-and-music.md` | Read when setting up the cloned voice, hitting a TTS error, or choosing music |
| `references/text-density-lint.md` | Read when lint fails |

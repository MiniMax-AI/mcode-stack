# Text-density lint

## Contents

- What lint.py measures
- Rules and where the numbers come from
- Fixing violations
- Changing a rule

## What lint.py measures

`lint.py` loads the project's `compositor.html` with the real timeline and captures, renders every shot twice (about 1 s in, and near its settled end) and measures each visible text node: box, rendered font size including transforms, line count, reading load. Then it renders the middle of every caption cue and checks the caption on its own.

Reading load counts 汉字 as 1 and Latin characters as 0.5; punctuation is free.

Two things are not counted as text to read:

- text at 35% opacity or less is texture (code context lines, owner and file path, watermarks);
- everything inside an element with a `data-lint-group` attribute counts as one block (a diagram, a ladder).

## Rules and where the numbers come from

Frame: 1080×1920. Every threshold is in `RULES` at the top of `scripts/lint.py`.

| Rule | Value | Source or reason |
|---|---|---|
| Safe zone | x 60–1020 above y 850, x 60–960 below it; y 180–1600 | 抖音/TikTok overlays: top tabs, the like/comment/share rail on the lower right, the name/description/music block at the bottom [2][3][4] |
| Caption position | top at y ≥ 1380 | low and out of the picture's centre, still above the bottom overlay [3][4] |
| Caption length | 1 line, at most 16 字 | Netflix Simplified Chinese: 16 characters per line [1]; short video uses one line |
| Caption speed | at most 9 字/s, at least 0.6 s on screen | Netflix adult reading speed of 9 characters per second [1]; shorter captions flicker |
| Caption clearance | 60 px free above the caption | the caption must not read as part of the picture |
| Body text size | at least 34 px | legible on a phone at arm's length; labels may be 26 px if at most 24 字 |
| Text blocks per screen | at most 4, caption excluded | one focal point, few eye jumps |
| Reading load per screen | at most 36, caption excluded | a 3–6 s shot is read once, while the voice is talking |
| Font-size levels | at most 3 (sizes within 15% count as one) | clear hierarchy |
| Line length | at most 14 per line | large type, short lines |
| Orphans | last line at least 2.6 em wide | no one- or two-character last lines |

Sources:

1. Netflix, Simplified Chinese Timed Text Style Guide — https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007-Chinese-Simplified-Timed-Text-Style-Guide
2. PostPlanify, TikTok safe zone checker — https://postplanify.com/tools/tiktok-safe-zone-checker
3. BlitzCut, safe zones for YouTube Shorts, Reels and TikTok — https://blitzcutai.com/blog/safe-zones-youtube-shorts-reels-tiktok
4. Reap, short-form video safe zones — https://reap.video/blog/short-form-video-safe-zones

## Fixing violations

| lint says | Usual fix |
|---|---|
| `N text blocks > 4` | Join label and value into one element; drop a label the voice already says; wrap a diagram in `data-lint-group` |
| `reading load N > 36` | Cut words, since the voice carries the detail; or split into two shots |
| `N font-size levels > 3` | Reuse an existing size, or dim the least important text to texture |
| `too small Npx` | Raise it to 34 px, or shorten it to a label of at most 24 字 |
| `outside safe zone` | Move it inside; bleed layouts may bleed backgrounds, never text |
| `orphan last line` | Break the line yourself with `\n` in `zh`, `zh1`, `hook` or `title` |
| `line too long` | Add `\n` or shorten |
| `caption N chars` | Add a `/` in `cap` |
| `caption N chars/s` or `caption shown 0.xx s` | Fewer 字 in that piece, or move the `/` so the merge pass can join it with a neighbour |
| `caption wraps to 2 lines` | A shorter piece; Latin words are wide |
| `caption too high` / `too low` | Something overrides `#cap`; the caption position itself stays fixed |
| `text crowding the caption` | Move the element up, or dim it to texture; keep the 60 px gap |

After fixing, re-run `render.py --stills` and look at the sheet again: lint catches density, not ugliness.

## Changing a rule

Change a value only for a reason that applies to the whole video, such as another platform's overlay layout or another frame size, keep its comment in `RULES` accurate, and re-lint every shot.

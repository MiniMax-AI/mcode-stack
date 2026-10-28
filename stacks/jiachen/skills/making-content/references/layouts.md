# Layouts and script.json

## Contents

- script.json shape
- Fields every shot can have
- The ten layouts: spot, web, pull, card, code, flow, stack, vs, counter, bars
- Choosing a layout
- Real assets: page captures, logos, mascots, fonts

## script.json shape

```json
{
  "meta": {
    "title": "大厂为啥都在抢 [[JS 运行时]]？",
    "hook": "一分钱没赚的公司\n凭啥被 [[Anthropic]]\n买下了？",
    "keywords": ["Anthropic", "Cloudflare", "Claude Code", "Bun", "Deno"]
  },
  "lines": [
    {
      "n": "一家一分钱都没赚的公司，Anthropic 为啥非买不可？",
      "cap": "一家一分钱都没赚的公司/Anthropic 为啥非买不可？",
      "chapter": "收购",
      "shots": [{"type": "spot", "key": "bun_joins", "phrase": "Today, Bun makes $0 in revenue.",
                 "kw": "收入 $0", "logos": ["oven-sh"], "src": "bun.com/blog"}]
    }
  ]
}
```

In every text field `[[x]]` marks a yellow highlight and `\n` a line break.

| Field | Meaning |
|---|---|
| `meta.hook` | Overlay on the first 1.6 s. At most 3 lines of about 8 字. |
| `meta.title` | Small pill shown for 2.4 s after the hook, and again when a chapter opens on a `card`. |
| `meta.keywords` | Words highlighted in captions. Numbers with units (10亿美元, 50%, $0) are highlighted without being listed. |
| `lines[].n` | Narration exactly as spoken. |
| `lines[].cap` | Caption text. Punctuation and `/` are the break points; each caption ends up one line of at most 16 字, and pieces that would flash by are merged. |
| `lines[].chapter` | Chapter name. Drives the progress-bar segments and the chip in the top-left corner. 3–5 chapters per video. |
| `lines[].shots` | One or two shots. The first starts with the line; a later one needs `anchor`. |

## Fields every shot can have

| Field | Meaning |
|---|---|
| `type` | One of the ten layouts below. |
| `anchor` | A literal substring of the line's `n`. The cut lands 0.12 s before that word is spoken. |
| `logos` | Logo tiles that pop in: file names in `logos/` without `.png`; `">"` draws an arrow between two tiles. |
| `src` | Source shown in the chip after the chapter name, e.g. `bun.com/blog`. |
| `kw` | Keyword sticker in the top zone. Meant for `spot`, where the shot's `logos` ride in front of it; on other layouts the logos would show twice. |

## The ten layouts

Text budgets below keep a shot inside the lint limits (see text-density-lint.md).

### spot — real screenshot, one phrase in focus

`{"type": "spot", "key": "bun_joins", "phrase": "Today, Bun makes $0 in revenue.", "zh": "Bun 目前[[收入为零]]", "kw": "收入 $0", "logos": ["oven-sh"], "src": "bun.com/blog"}`

The capture is zoomed until the phrase spans about 72% of the width, the phrase gets a yellow marker, everything else is dimmed. `zh` adds a translation box under it. Needs `capture.py` and a `sources.json` entry for `key`. Use it for a short, punchy sentence on a clean page; the real page is the proof.

### web — re-typeset article view

`{"type": "web", "url": "bun.com/blog", "bg": "#fbf0df", "wm": "oven-sh", "zh1": "Bun 被 [[Anthropic]]\n收购了", "en1": "[[Bun is joining Anthropic]]", "logos": ["oven-sh", ">", "anthropics"]}`

A white browser sheet with a URL bar bleeds off three edges; one big Chinese line, the original underneath in small type. `bg` is the brand colour behind the sheet, `wm` a faint logo watermark. Use it when the page is dense, the quote is long, or capture fails. Budget: `zh1` at most 2 lines of 8 字, `en1` at most 2 short lines.

### pull — quote, translation first

`{"type": "pull", "theme": "cream", "zh": "Bun 挂了\nClaude Code\n也就挂了", "en": "If Bun breaks, Claude Code breaks.", "src": "bun.com/blog", "logos": ["oven-sh"]}`

Big quotation mark, the Chinese line large and coloured, the original smaller and fading in word by word. `theme` is `dark` or `cream`. Break `zh` yourself so no line ends with a lone character (at most 3 lines of about 7 字).

### card — one statement

`{"type": "card", "theme": "yellow", "lines": ["一个买大脑", "一个买手"], "sub": "…", "items": ["…"], "mono": false, "logos": ["…"]}`

Hero type; all lines share one size, fitted to 840 px. On `dark`, the second line is yellow. `items` are chips that pop in, `sub` a small line, `mono` sets the lines in a code face. Use it for the conclusion and for turns in the argument. Budget: at most 3 lines of 6–8 字.

### code — real source lines

`{"type": "code", "path": "anthropic-experimental/sandbox-runtime", "file": "src/sandbox/credential-sentinel.ts", "sha": "85af865", "lines": [[13, "import type …"], [15, "export const SENTINEL_PREFIX = 'fake_value_'"], [31, "…"]], "hl": [15]}`

GitHub-dark view. Owner, path and context lines are dimmed to texture; the `hl` line is highlighted and wraps inside the safe zone. Gaps in line numbers show a `⋮` row. Use it when "the code literally says so". 3–5 lines, only the `hl` line is meant to be read.

### flow — a path through a system

`{"type": "flow", "nodes": [{"title": "沙箱里", "code": "fake_value_…"}, {"title": "出口代理", "code": "白名单域名才换"}, {"title": "API 收到", "code": "真 token"}], "token": {"before": "fake_value_…", "after": "真 token"}}`

Three boxes top to bottom; a token travels down and changes at the middle box. Exactly 3 nodes; keep each `code` under about 12 characters.

### stack — a ladder revealed on cue

`{"type": "stack", "title": "agent 沙箱 · [[从轻到重]]", "items": [{"label": "解释器", "av": "pydantic", "anchor": "解释器"}, {"label": "V8 isolate", "av": "cloudflare", "anchor": "V8"}]}`

Each item appears when its `anchor` is spoken; the current one turns yellow; `av` adds a logo. Use it for taxonomies and rankings. At most 5 items, each `anchor` taken from the line's `n`.

### vs — two numbers in contrast

`{"type": "vs", "rows": [{"label": "Claude Code 年化收入", "value": "$1B", "frac": 1, "av": "anthropics"}, {"label": "Bun 被收购时的收入", "value": "$0", "frac": 0, "av": "oven-sh"}]}`

Label, huge number, a bar of length `frac` (0–1); a row with `frac` 0 turns red. Two rows.

### counter — one big number

`{"type": "counter", "value": 1000000, "prefix": "+", "label": "一个 PR 新增的代码行数", "src": "simonwillison.net", "logos": ["github"]}`

Counts up on yellow in about a second.

### bars — a measured before and after

`{"type": "bars", "title": "Claude Code CPU 占用", "rows": [{"name": "Zig 版 Bun", "v": 24, "logo": "ziglang"}, {"name": "Rust 版 Bun", "v": 10, "logo": "ferris"}], "unit": "%", "src": "bun.com/blog"}`

Horizontal bars grow one after another; the last row is yellow. `unit` defaults to `%`. 2–3 rows.

## Choosing a layout

| Material | Layout |
|---|---|
| A short sentence on a real page | spot |
| A long or dense passage | web |
| A line worth quoting | pull |
| The conclusion, a turn in the argument | card |
| Real code | code |
| A request or data path | flow |
| A taxonomy or ranking | stack |
| Two numbers in contrast | vs |
| One big number | counter |
| A before/after measurement | bars |

A 90 s cut that worked had 17 shots (7 card, 3 spot, 3 web, and one each of pull, vs, counter, bars), about 5.4 s per shot.

## Real assets

**Page captures (`capture.py`).** A 432×768 CSS px phone viewport at device scale factor 5 gives 2160×3840 PNGs, so the zoom stays sharp. The phrase must match the page text exactly: case, straight or curly quotes, non-breaking spaces. A phrase starting with `#` is a CSS selector; GitHub code lines are `#LC15` for line 15. Cookie and consent banners are hidden by id and class; other overlays usually mean the shot works better as `web`. Re-shoot one entry with `--only 'key|phrase'`.

**Logos (`fetch_assets.py logo`).** GitHub owner avatars give a consistent, recognisable set: `logo cloudflare --repo cloudflare/workerd`. The script reads the real `avatars.githubusercontent.com/u/<id>` URL from the repo page, because `github.com/<org>.png` can return 403 and `/avatars/<login>` a placeholder. Tiles render at 132 px, so 256 px sources are enough.

**Mascots and project art (`--url`).** Use the project's official art, e.g. Ferris from rustacean.net (public domain). Non-square images need contain-fit: add the name to `WIDE` in `compositor.html`.

**Fonts (`fetch_assets.py fonts`).** Latin faces (Inter, Source Serif 4, JetBrains Mono) come from Google Fonts; Chinese comes from the system font, so a machine without PingFang SC or Noto Sans CJK SC renders tofu.

**Attribution.** Logos only identify the company or project being discussed. Name the sources of quotes and numbers in the post description.

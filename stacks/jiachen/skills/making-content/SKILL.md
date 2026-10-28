---
name: making-content
description: "Content production in three modes: rewrite, Xiaohongshu (小红书) image post, short video. Rewrite (default): turns an AI-sounding Chinese or mixed Chinese-English draft (post, newsletter, engineering blog, commentary) into the author's restrained style: few emoji, short paragraphs, hedged claims, neutral wording, English terms split by spaces. Triggers: 按我的风格改, 去 AI 味, 润色, 改改这篇, or a vague 帮我改改 when the context is a structured draft. Also for a Xiaohongshu image post from scratch (title, cover, cards, body, hooks); read references/xhs-post.md first. Also turns a document, research, notes or an article into a 60-180 s vertical video (抖音, 小红书, 视频号, B站: real sources, voice-over, captions, cover). Triggers: 做成视频, 做个短视频, 剪个 90 秒版本, 配音, 换成我的声音, or complaints of 字太密, AI 味太重, 容易走神; read references/video-pipeline.md first."
---

# Making Content

Three uses: rewrite an AI-written draft in the author's style, make a Xiaohongshu image post from scratch, and turn material into a short video. All three share the style rules below; each rule targets a recurring tell of AI writing. "The author" is the user whose voice the text should carry.

The rules are a default distilled from one author's edits of AI drafts. The user's own samples in `test-cases/` and anything the user says about their style take precedence over them.

## Three uses

- **Rewrite** (default): the user gives a draft; revise it with the style rules below.
- **Xiaohongshu image post from scratch**: read [references/xhs-post.md](references/xhs-post.md) first (workflow, title, cover, cards, body text, taking a position). Text on the cards and in the body still follows the style rules below. The rewrite-only items under "Don'ts" (do not restructure, do not add facts the draft lacks) do not apply here.
- **Short video**: read [references/video-pipeline.md](references/video-pipeline.md) first (workflow, script.json, voice, rendering, lint). Read [references/layouts.md](references/layouts.md) while writing script.json, [references/voice-and-music.md](references/voice-and-music.md) when cloning a voice or hitting a TTS error, and [references/text-density-lint.md](references/text-density-lint.md) when lint fails. Narration and copy still follow the style rules below; the question that invites comments at the end of a video is a deliberate part of the video format, so follow video-pipeline.md there.

## Before a post or video from scratch: check the topic can win

Do this before any outline, and again whenever new data arrives (numbers from a published version, search results the user sends). Rewrite mode skips it.

1. State the goal in one line: reach (likes, saves and plays from strangers) or a named audience. Ask if it is unclear.
2. Measure heat and saturation from raw search results, not from memory. Search the topic on the target platform, or on the web when the platform cannot be read; ask the user for screenshots only as a last resort. For the top 10 results, note age, likes and saves, angle, and whether the creator shows their face. Note how many days have passed since the news broke and whether the planned angle is already among the top results.
3. Compare with the account: the author's median and best numbers for this kind of content. Read the account data if the project keeps it; otherwise ask.
4. Give a probability that the piece beats the author's median, with the reasons and the check that would change it.
5. If the result is decided by conditions that editing cannot change (news past its peak, every angle already taken by bigger accounts, a topic outside what the author's audience follows, a format the author will not do), call the topic a dead end. List those conditions, say what would have to change for it to work, and stop. Do not polish hooks, pacing or visuals inside a dead topic, and do not cycle through new angles on it; the user picks the next topic.

## Sentence-level references (sibling skills)

Before writing in rewrite or image-post mode, read these third-party skills, installed next to this one under `~/.claude/skills/` or `~/.agents/skills/`:

- **lieflat-less-ai-tone/SKILL.md**: 11 rules for removing AI tone in Chinese, each backed by corpus measurements: crowded lists joined by 、, neighbouring sentences with the same structure, overused colons, stock openers, five kinds of translationese, paragraph-initial commentary with no referent, and more. It covers the sentence level this file leaves out. After rewriting, check the result against its "最终验收" checklist at the end.
- **chinese-writing-style/SKILL.md**: general rules for plain Chinese writing (long sentences, nominalization, how numbers are stated, text written for agents), mainly for documents and reports.
- **humanizer/SKILL.md**: for English drafts only (English posts and replies on X); read it before writing English. It lists 26 kinds of English AI tone, such as "Not X but Y", forced triads, dashes, one-line closers and stock words. Check the result item by item against it. Do not read it for Chinese drafts.

Where these skills conflict with this file, this file wins: lieflat itself says a style document overrides its rules, and this file is that style document. For overlapping rules (contrast constructions, dashes, personifying metaphors), follow this file's version. Rhetorical questions in the body are not an AI tell (measured, people use them far more than AI does), so do not remove them in passing.

If any of these skills is missing, ask the user whether to install it, and install only the missing ones if they agree: `skills add adao-max/agent-skills -g -y -a claude-code -a codex -s chinese-writing-style`, `skills add larashero3-dotcom/lieflat-less-ai-tone -g -y -a claude-code -a codex -s lieflat-less-ai-tone`, `skills add blader/humanizer -g -y -a claude-code -a codex -s humanizer`. If the user declines or installation fails, rewrite with this file's rules alone and mention at the end that the sentence-level references were missing.

## Read the test cases first (if any)

Each folder under `test-cases/` is a before/after sample:
- `ai-draft.md`: a typical AI-written first draft
- `final.md`: the author's final version
- `README.md` (optional): notes on the scenario

**Before rewriting, read one or two at random**: where the AI over-decorated, and how far the author cut it back. This calibrates better than the rules do. If the user's draft is close to a test case's scenario (for example, another Xiaohongshu explainer), read that kind first.

### No test cases, or the scenario is not covered

`test-cases/` is what makes this skill personal: the style rules below are an abstract summary, and real voice calibration comes from concrete samples. If `test-cases/` does not exist, or the draft belongs to a scenario not covered yet (for example a first English newsletter, a long technical blog post, a short comment, or mixed Chinese-English), **invite the user** after rewriting to keep it as a new sample, in the user's language:

> This draft is a [scenario], and test-cases/ has nothing of this kind yet. If you want to keep it as a sample, I can save the ai-draft and your final version under `test-cases/YYYY-MM-DD-scenario/`, so the next draft of this kind can be calibrated against it.

`test-cases/` is in .gitignore: samples stay on the local machine and are never committed.

## Style rules (by importance)

### 1. Very few emoji

- By default **0–2 emoji** in the whole piece.
- **No** decorative emoji on headings, at paragraph starts, or before list items (🚨 / 📊 / 🛠 / 💡 / 🤔 and the like).
- The only allowed use: as an emotional reaction right after a **contrast** (for example 🤡 for irony after finding out that multi agent quietly burns tokens).
- One test: "Is this emoji decoration or reaction?" Delete decoration, keep reaction.

### 2. No emotional words

Avoid: 打脸 / 神话破灭 / 卷错方向 / 反潮流 / 唱衰 / 翻车 / 翻盘 / 颠覆认知 / 终于清晰

Use: 背书 / 共识 / 反对 / 倾向 / 质疑 / 边界 / 立场

→ AI uses emotional words to manufacture impact; the author shows contrast with neutral statements and lets the facts speak.

### 3. Hedge; avoid absolutes

Avoid: 直接跑赢 / 必然更好 / 完全失败 / 100% / 一定

Use: 经常好过 / 往往更优 / 有时 / 不少情况下 / 大多时候

→ Match the strength of the source's wording exactly. The alphasignal source says "consistently match or beat", which maps to 经常好过, not 直接跑赢.

→ Do not overstate analogies either: write 和 X 是类似思路, not 和 X 是同一个思路.

→ Exception: a piece may carry **one** firm judgment, stated flatly and with a time frame, for example "一年内，大多数 PR 会先经过 agent 评审". Only if the author agrees with it; label it as 我的判断 and put it early. Facts, quotes and analogies still use the hedged wording above. See "Taking a position" in references/xhs-post.md.

### 4. Headings are statements, not mechanical layers

Avoid: "第一层：业界共识", "第二层：学术数据", "🏗️ 第一节"

Use: "业界的共识是 single 是默认，multi 才是例外", "学术界最近的研究也反对 multi agent"

→ A heading is itself a claim. Skimming the headings should give the reader the core argument, not empty layer labels.

### 5. Tight paragraphs, mostly 1–3 sentences

AI tends to write each point as a 5–8 sentence block. The author's paragraphs are 1–3 sentences, dense and without repetition.

How: split a long paragraph into 2–3 short ones, each with one concrete point and one sentence of explanation. Delete any sentence that only transitions, restates, or cushions.

### 6. Quote little and precisely

Cover each authoritative source in 2–3 sentences, quote one key line, and stop. **Do not interpret the quote at length.** The reader wants "X said Y", not "X said Y, which means Z, so we can infer W".

Example:

❌ AI version (over-expanded):

> Walden Yan 直接点名 OpenAI Swarm + Microsoft AutoGen「actively push concepts which I believe to be the wrong way of building agents」。他的反论从**人类协作**切入：「If Engineer A's code causes a merge conflict with Engineer B...」翻译：人类工程师能协作，是因为人类有"非平凡的智能"做隐式同步——能听懂语气、读出言外之意、推断对方决策依据。LLM 根本没这层能力。结果就是：「Running multiple agents in collaboration only results in fragile systems.」

✅ Tight version:

> Cognition AI（开发 Devin 的公司）写过一篇《Don't Build Multi-Agents》，认为人类工程师能协作，靠的是隐式同步：听懂语气、读出言外之意、推断对方的决策依据。LLM 还没有这层能力，硬拼成 multi agent 系统会很脆弱。

### 7. English terms with spaces, not hyphens

Avoid: `multi-agent` / `sub-agent` / `single-agent` / `pre-answer-scaffolding`

Use: `multi agent` / `sub agent` / `single agent` / `pre answer scaffolding`

→ A consistent typography preference of the author. Apply it throughout when rewriting.

Exception: fixed proper names (`KV-cache`) keep their hyphen.

### 8. Delete transition sentences

AI likes to write: 接下来我们看 X, 综上所述, 让我们深入了解, 值得注意的是, 另一方面, 更重要的是

Delete all of them and go straight into the next paragraph. Readers keep up on their own.

**Exception**: **keep** pointer phrases with substance, such as 具体到 eval, 在这里你会发现, 我们首先要知道的一点是, 在跨过基础的质量门槛后. They are not empty transitions; they point at the specific thing that comes next and help the reader keep pace.

Test: delete the phrase. If the next sentence still gets the reader going at once, it was an empty transition; delete it. If not, it is a substantive pointer; keep it.

### 9. Delete rhetorical exaggeration and floating abstractions

Avoid: 硬数据狠到离谱 / 数据狠到打脸 / 反差感拉满 / 信息密度爆炸

→ Let the data speak. "错误率放大 17.2 倍" is the whole sentence; it needs no 狠到离谱.

Likewise, **abstract summary words never stand alone**: 结构性 / 制度轨道 / 时空压缩 / 叙事 / 框架 / 焦虑 / 共识 / 信任危机. AI uses them as summary labels. Each time one appears, the same sentence must carry a concrete data point or a named entity; otherwise delete it and rewrite.

Test: remove the abstract word from the sentence. If no information is lost, it was padding.

❌ 这些动作拼在一起是同一种焦虑。

✅ 各方都在积极地寻找替代方案。

❌ 这是制度性的转变。

✅ 巴基斯坦这周首次单独提出收费机制。

### 10. End with a first-person position

AI tends to end with a barrage of questions: "你做项目时是直接堆 multi 还是先扛过 single？... 评论区聊聊👇"

The author tends to state a position naturally and add an invitation:

> 内容有点长，我自己日常更习惯先让 agent 写测试再写实现，有些场景也会反过来，欢迎在评论区分享你的做法～

Note the parts: **admitting an imperfection** (略长) + **a first-person position** (我自己偏好) + **a natural invitation** (欢迎 + ～).

A piece with a firm judgment does not end with a question to drive engagement. Instead, state an attitude toward the industry first, then bring the judgment down to a concrete practice the reader knows and say it more boldly, with [doge] to lighten the tone:

> 有人担心 AI 来了就不需要工程师了，我倒觉得现在正是做工程最有意思的时候，工具每隔几个月就换一轮，每次都有新机会。现在很多团队还在手写 commit message，大胆预言一年后这件事没人再做了 [doge]

(An AI draft would typically end with "这个判断你同意吗？评论区聊～"; delete that and write a paragraph like the one above.)

**No literary wrap-up**:

- Do not repackage the framework as a metaphor ("棋盘上的最后一步落子……").
- Do not make a poetic callback to the title.
- No theatrical words such as 收场 / 尾声 / 下一幕.
- Do not end on a rhetorical question ("这场博弈，谁真正赢了？").

→ The last concrete statement is the ending. One more paragraph is AI's "completeness" anxiety: it fears the piece will feel unfinished and adds a poetic close. The author trusts readers to close the piece themselves.

### 11. No hashtags by default, and do not suggest any

Unless the user explicitly asks for tags, do not pile "#AIagent #LLM #大模型" at the end, and do not suggest topics. Authors often pick tags themselves before posting, based on view counts, so tags at the end of a final.md in test-cases do not mean the rewrite should carry them.

### 12. Titles of works in 《》

Not `<Don't Build Multi-Agents>` or `"Don't Build Multi-Agents"`; write 《Don't Build Multi-Agents》.

### 13. Plain list items, no bold + emoji

Avoid: `1️⃣ **工具数 > 10** → 留 single（强行 multi 就用 decentralized topology，66.4% > centralized 62.1%）`

Use: `1. 工具数 > 10 → 留 single`

→ Delete decorative number emoji (1️⃣2️⃣3️⃣) and bold inside list items. If a data point matters, give it its own sentence instead of stuffing it into a list item.

### 14. Attribute quotes accurately

AI easily turns "X wrote this on their own blog" into "X talked about it with team Y". Check the source: an original blog post or a retelling in a webinar? Did X write it, or did Y retell X?

Whenever you meet an attribution while rewriting, check first:
- Is this the original or a second-hand retelling?
- Is it a blog post, or an interview / livestream / tweet?
- If unsure, write it conservatively (在某次分享中提到) rather than naming the wrong occasion.

### 15. Titles: a "why" question or a statement

A good main title is a statement-like question such as 为什么 X 经常好过 Y？

Avoid clickbait patterns: "multi agent 神话破灭", "你不知道的真相", "3 个数据让你重新认识 X".

A Xiaohongshu title must also:

- be at most 20 characters, make sense on its own, and not lean on context the reader does not remember (such as 半年后有答案);
- use words readers search for (Agent, 沙箱, Claude Code); a concept you coined yourself gets no searches, so put it on the cover and in the body;
- not generalize with 大厂; use 前沿团队, 各家, or name them. Keep brand names out of titles of commentary and comparison posts (the cover and body may name them); a news post about one company's official release may put that company's name in the title;
- give a counter-intuitive claim a qualifier that makes it accurate: in 别把**所有**评审都交给 Agent, 所有 keeps it accurate and leaves a question open;
- trend titles also work: "IDE转向终端：Agent 又回到了命令行" (A 转向 B + colon + one judgment). The counter-intuitive line can then go on the cover to complement the title.

### 16. No AI contrast or emphasis constructions

Even when the content is right, these read like AI hunting for drama. Avoid:

- 不是 X 而是 Y / 并不是 X 而是 Y / X 其实不是 Y 而是 Z
- 真正的 X / 真正值得关注的是 X / 真正的问题不是 X
- 不仅 X 更是 Y / 不仅 X 还是 Y
- 与其说 X 不如说 Y
- X 看起来像 Y，但其实是 Z

Instead, state Y directly. If a contrast is needed, set the facts side by side without contrast connectives forcing them into line.

❌ 它不仅是一个工具问题，更是一个组织问题。

✅ 它是一个组织问题，工具只是症状。

→ This is AI's most frequent sentence decoration. The author's points are solid enough not to need a contrast structure for weight.

### 17. Do not comment on your own writing

Avoid:

- 这个比喻很爽，但……
- 很少人注意到……
- 大家都没说到位……
- 这件事没人讨论
- 有个细节值得注意
- any narration of the reader's reaction (读到这你可能会问……)

→ AI likes to tell the story and, alongside it, how cleverly it is telling it, to keep the reader company. The author does not: just tell it and let readers form their own opinion. If a point really is rarely discussed, explaining it clearly is enough; it needs no 很少人注意到 footnote.

### 18. Open with the point, no meta positioning

Avoid:

- 大部分讨论在分析 X，但其实 Y
- 很多人说 X，但真相是 Y
- 看到现在最多的两种解读……两种都不算错……其实应该问的是……
- 先说结论：……
- any opening that spends two or more sentences on what others say before giving your own view

Use: the first claim, directly. To preview the structure, use one parallel sentence that covers every section (向西，X；向东，Y).

→ AI positions itself by negating others; the author assumes readers are already thinking about the topic and need no onboarding. The opening is the argument itself.

A Xiaohongshu opening carries no version numbers or exact dates (在 3 月 12 日发布了 v1.4.2 → 这几天发布了新版本). Use a product's full name the first time, then the community's short form (Claude Code → cc).

Laying out what each company does (facts) is not meta positioning and can open the piece as evidence; what does not work is stating what others say and then negating it. The opening may also start with why this is worth talking about now (an industry shift, for example "终端 agent 火起来以后，不少人又回到了命令行"), then what each company does, then your own judgment.

### 19. Punctuation

- No 「」 corner brackets: they read like translationese or anime subtitles.
- Use the Chinese dash —— sparingly; where several sentences in a row use it, switch to commas or colons, or split the sentence.
- **Never put —— on a line of its own as a section divider**: that is AI and markdown-rendering thinking; natural paragraphs carry the flow.
- No ASCII straight quotes "foo"; use Chinese curly quotes “foo”.
- An explanatory dash can often go: in 双方心里都有一张隐形的底牌——海峡, delete ——海峡 and trust the reader to follow the next sentence.

### 20. Formulas and math go into prose

Avoid: a formula in its own code block, or indentation plus symbol glossaries (that is how LaTeX papers and technical docs do it).

Use: the formula spelled out in plain Chinese.

→ On Xiaohongshu, WeChat official accounts and long engineering posts, math notation visually breaks the reading flow. A rigorous derivation can go on the last image as further reading; the body stays plain.

❌ AI version: `SE = σ / √N` in its own code block, followed by an indented glossary "σ : 单题噪声有多大 / N : 题数".

✅ In the prose:

> 测出来的分数会上下抖，抖动的幅度大约是单题噪声除以题数的平方根。先有个大概印象就好，完整推导放在最后一张图里。

→ The same goes for LaTeX, concept definitions in tables, and indented symbol dictionaries: they look good rendered as markdown, but these pieces follow a "prose + one or two images" layout for Xiaohongshu and WeChat, not a GitHub README.

### 21. A human feel comes from concrete community context

Next to a point, the author may add one line about a concrete event readers lived through, with a reaction emoji, for example:

> 所以第三方插件装之前最好看一眼源码，想想之前那几个藏了恶意代码的 npm 包 [doge]

That line refers to malicious packages readers may remember. It adds context and makes the piece feel written by a person. On Xiaohongshu, reaction emoji use the platform's emoticon codes ([doge]).

Do not invent such events. Where one would fit, note after the rewrite that "an example from the community could go here" and let the user write it.

Personal and work experience is the author's to share; do not add it unless they provide it, and do not mention their employer. When the piece needs a human feel and there is no community example, use an industry observation the author agrees with, and make the group of people concrete: 不少团队之前把代码评审全交给人，现在开始让 agent 先过一遍 (an AI draft would say only 不少团队). A human feel can also come from the author's attitude toward the industry, for example 我倒觉得现在正是做工程最有意思的时候.

### 22. A metaphor carries the technical term it stands for

Avoid: 给 agent 装个刹车 / 刹车太灵也不好 (the metaphor alone)

Use: 给 agent 装个刹车（写文件前先等用户确认）

→ With the metaphor alone, readers must guess the mapping, and experts find it empty. Add the technical term the first time a metaphor appears in each section and on each card.

### 23. Name the core concept and give it a counterpart

For example 分层评审, with 一次性评审 as its counterpart. Once named, use the same name on the cover, in the body and at the end; do not switch to synonyms. A newly coined name gets no searches, so the title still uses words readers know (see rule 15).

## Workflow

Copy this checklist into the response and tick items off as you go:

````
Rewrite progress:
- [ ] 1. Read test-cases (if any, at least 1) to calibrate
- [ ] 2. Read the sibling skills under "Sentence-level references" (plus humanizer for English drafts) and mark problems with their rules; if one is missing, first ask the user whether to install it, as above
- [ ] 3. Read the user's AI draft and mark problems rule by rule (decorative emoji / emotional words / absolutes / mechanical layers / transitions / AI contrast constructions / floating abstractions / self-commentary / literary wrap-up / meta opening / hashtags / formulas in blocks / metaphors without the technical term / an unlabeled judgment)
- [ ] 4. Rewrite: fix every marked rule
- [ ] 5. Reread: does this read like AI or like the author? If it still sounds like AI, revise again
- [ ] 6. Check against the "最终验收" checklist at the end of lieflat-less-ai-tone; for English drafts use humanizer's items instead; if not installed, handle it as in step 2
- [ ] 7. Boundary check: do not rewrite parts the user already wrote well; change only what has a problem
- [ ] 8. If this is a new scenario test-cases/ does not cover, invite the user to keep it as a sample (see "No test cases, or the scenario is not covered")
````

## Borderline calls

For calls like "should this emoji stay" or "is this sentence a transition", lean toward **deleting** or **simplifying**. The overall taste is restraint: cutting a little too much is safer than keeping a little too much.

## Don'ts

- **Do not restructure the piece** unless the user explicitly asks for it.
- **Do not replace the user's key lines or core arguments**; change only tone and expression.
- **Do not add facts or data the user's draft lacks**: this is a rewrite, not new writing.
- **Do not translate English quotes into Chinese** unless the user asks.

## Output format

- Output the complete rewritten piece directly.
- If there were many changes, sum up the main direction in one or two sentences at the end (for example: removed emoji and emotional words, turned headings into statements).
- List any uncertain attribution or fact separately for the user to confirm; **do not guess in the text**.

## Maintaining test cases

`test-cases/` is excluded by `.gitignore` and **stays on the local machine**, for later evals. Each test case is a folder:

```
test-cases/
└── YYYY-MM-DD-scenario/
    ├── README.md         # optional: the scenario (what draft, which platform, which audience)
    ├── ai-draft.md       # the AI-written first draft
    └── final.md          # the author's final version
```

Name a new test case with a `YYYY-MM-DD-` prefix for sorting and a folder name that describes the scenario (for example `2026-05-04-tech-explainer`).

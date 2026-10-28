# Making a Xiaohongshu image post from scratch

Distilled from making technical image posts (several cards plus body text). Text on the cards and in the body still follows the style rules in SKILL.md.

## Contents

- Workflow
- Title
- Cover
- Cards
- Body text
- Taking a position
- Lessons from reference accounts

## Workflow

1. Settle the storyline and the evidence first, then write the cards and the body; **decide the title last**. Once the post is written, compare against hit titles from the reference accounts the author follows (ask which, if you do not know), and offer 2–3 candidates, each with its reason, for the author to choose.
2. When the author asks to optimize for clicks, give one recommendation and explain it. If the author has a reason not to use a wording (for example, not wanting to name a brand), change it at once without arguing.
3. Before publishing, open every quoted source again; words in a screenshot must match it exactly. Mark guesses and summaries as such.
4. Write the cards as HTML and render them to PNG (headless Chrome or Playwright; reuse the author's card template if they have one from earlier posts). Re-render after every change and look at each card: nothing overflowing the canvas, no line with only one or two characters, no large empty block at the bottom.
5. Before publishing, the author rewrites the body in their own words and decides whether to tick the AI-assisted label. The author picks the topic tags (SKILL.md rule 11).

## Title

- At most 20 characters and understandable on its own: no references to context readers do not remember, such as 半年前那篇 or 上一条.
- Use words readers search for and click (Agent, 沙箱, Claude Code). A concept you coined gets no searches; explain it on the cover and in the body.
- Counter-intuitive imperatives or judgments get clicks, but keep a qualifier that makes them accurate: in 别把所有评审都交给 Agent, 所有 keeps it accurate and leaves a question open (so which reviews should it take?).
- Do not generalize with 大厂: many teams building agents are new and sharp. Use 前沿团队, 各家, or name them.
- Keep brand names out of titles of commentary and comparison posts (naming a competitor in a title can look like an attack); brands and logos may appear on the cover and in the body. A news post about one company's official release (for example an engineering blog post from that company) may put that company's name in the title: the brand is the biggest hook.
- Freshness is how readers feel, not how old the news is. A point readers already find stale (for example 上下文越长越贵) becomes evidence in the body; the title uses a newer framing.
- Title and cover can carry two different hooks. For example, a trend title "IDE转向终端：Agent 又回到了命令行" with the counter-intuitive "别把所有评审都交给 Agent" on the cover.

## Cover

- **It must not look like an AI template at a glance.** Dark background + huge white bold title + keywords highlighted in yellow + tag pills + a block of code or a diagram underneath is the generic AI cover, and posts using it look interchangeable. Instead, build the cover around real material (official images, page screenshots), make annotations look hand-made (circles, arrows, marker strokes), and keep the text sparse and plain. Change the composition and colours for every post; before starting, put the previous cover and hit covers from the same niche side by side and compare.
- A clean solid background. No blurred screenshot as the background: that is a video-cover technique and distracts on an image post. No decorative emoji either; they look cheap.
- The main element is one large diagram or architecture chart; metaphors in it also carry their technical terms (记忆 · 上下文, 双手 · 工具调用).
- Text density passes the lint: at most 4 text blocks, a reading load of at most 36 (汉字 count 1, Latin letters 0.5), at most 3 font-size levels. The rules come from this skill's `references/text-density-lint.md`. If it is over, cut secondary text such as arrow labels and logo captions first.
- At the top, the hot term readers are following, as the most prominent tag (终端 Agent 火了, or IDE → 终端 to echo the title); the core concept (分层评审) can be the heading of the architecture chart.
- Use logo tiles instead of a list of names: more eye-catching, and they cost no characters.
- For a news post about one company's official release, put that company's real logo on the cover; the big text can reuse the title's words (title <公司>换掉<工具>, cover <公司> 抛弃了 <工具>). The brand and the action are the biggest click hooks. Do not add a logo for a brand the big text already names. Logos go without tile frames. One layout that worked: the new brand's mark enlarged and bleeding off one corner behind the big text, and a hand-drawn cross over the replaced product's logo in the opposite corner on the plain background, not overlapping marks of a similar colour. When the cross and the logo are similar in colour, draw the cross in ink so the logo stays recognizable.

## Cards

- 3:4 portrait (1200×1600). 3:5 fills the screen only when edited and published in the Xiaohongshu app; other routes leave white bars.
- Many people look at the images and skip the body: every card has a paragraph of explanation, and one sentence at the bottom leads naturally to the next card, with no 下一页 label. Keep the share of text in the images high, so the images alone tell the whole story.
- Structure of each card: small tag, big heading, a paragraph of explanation, one image or table, one-sentence conclusion.
- For side-by-side comparisons, one summary table (companies × key dimensions), with a one-line "the most X" characterization per company, marked as your own summary. This card earns most of the saves.
- Use real material: team or project logos, official page screenshots (box the key original text, with a larger Chinese translation underneath). No photos or names of real private individuals in screenshots.
- When naming competitors for comparison, add a fairness note (for example: the product you favour has the same limitation elsewhere), so it does not read as putting others down.
- Every card states its sources and an as-of date at the bottom.

## Body text

- Xiaohongshu caps the body at 1,000 characters, tags included, so keep the body under 900. Details go into the images; the body carries only the storyline and points to them (看图 N 那张表).
- Order of the first two paragraphs: why this is worth talking about now (an industry shift) → what each company does → my judgment. Do not open with 很多人以为……其实…… (SKILL.md rule 18).
- Do not add personal or work experience the author has not provided, and do not mention their employer. For a human feel, use an industry observation the author agrees with, and make the group concrete (不少团队之前把代码评审全交给人，现在开始让 agent 先过一遍) (SKILL.md rule 21).
- Do not end with a question to drive engagement; close with a first-person attitude plus a more concrete, bolder judgment (SKILL.md rule 10). No topic tags in the body.
- If `test-cases/` has Xiaohongshu image-post samples, read them first.

## Taking a position

A clear judgment is what gets discussed and shared most: a sharply worded judgment post often draws several times the comments of a neutral explainer from the same account. Research agrees that moderate controversy increases discussion while too much makes people unwilling to join in (Chen & Berger, 2013, *Journal of Consumer Research*). So aim for a technical judgment peers will argue about, not a flame war. This section applies to posts on X as well.

- The judgment must be falsifiable, ideally with a time frame or a number: 一年内，大多数 PR 会先经过 agent 评审 beats agent 评审挺有用.
- Put it early (title, cover or first paragraph) and come back to it at the end; the evidence in between must hold it up.
- It must be a judgment the author agrees with, labeled 我的判断; facts, quotes and analogies still use hedged wording (SKILL.md rule 3).
- Argue a technical position. Do not target specific people or companies, use no emotional words, and do not court controversy for its own sake. Do not write a judgment the evidence cannot support.
- At the end, state the judgment once more, brought down to a practice readers know (大胆预言一年后没人再手写 commit message [doge]). Do not invite engagement with questions such as 你同意吗 (SKILL.md rule 10).
- Reply seriously to people who push back; the replies themselves spread the post.

## Lessons from reference accounts

- Among small accounts of similar size, hit posts often have only 1–2 images (a text-only cover or one comparison table) with everything in the body; telling the whole story across 9 cards is what large accounts do. Both routes work; on the card route, the images alone must tell the whole story.
- What several hit posts share: one dense summary table that earns the saves; first person; a number or a clear judgment in the title; controversial judgments drawing far more comments than other posts.

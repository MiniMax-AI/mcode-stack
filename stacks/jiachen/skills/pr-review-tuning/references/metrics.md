# Metrics

What `scripts/metrics.mjs` computes from `prs.jsonl`, how, and what each number cannot tell you. The headline numbers go into the first table of `metrics.md`, with last week's value, the change and the direction that counts as better.

## Input

`prs.jsonl` has one JSON record per PR, written by `collect.mjs`:

- `host`, `project`, `number`, `url`, `title`, `author`, `state` (`open`, `merged`, `closed`), `created_at`, `merged_at`, `source_branch`, `target_branch`, `draft`;
- `summary`: the bot's last summary, `{ verdict, tier, round, phase }`, or `null` when the bot never posted one;
- `history`: one entry per published review run, `{ sha, verdict, round, model_called, at, arm, usage: { input, output, cache_read }, tier, ... }`. The bot keeps the last 30 runs of a PR, so a PR with more runs is undercounted;
- `threads`: one entry per bot thread, `{ id, kind, source, severity, type, class, lens, title, path, created_at, resolved, resolved_by_bot, resolved_by, human_replies, first_human_reply_at, human_reply_texts }`. `kind` is `finding` or the kind of question; `human_reply_texts` holds at most three short replies;
- `quiz`: `{ posted, answered }` or `null`;
- `fixes`: earlier PRs this PR says it fixes or reverts; `files`: the paths it changed.

Lines that are not a JSON object are skipped and counted in the report header.

## The window

With `--since` and `--until` (the end is excluded):

- a PR is **reviewed** when one of its runs (`history[].at`) falls in the window;
- threads, runs and rounds count when they were created in the window;
- the merge measures (coverage, unanswered at merge, time to merge, follow-up fixes) take PRs merged in the window.

Without them every record counts, and a PR is reviewed when it has a summary or a run.

## Headline numbers

| Number | Definition | Better |
| --- | --- | --- |
| PRs reviewed | Reviewed PRs. | context |
| Bot threads | Threads the bot opened. | context |
| Merged PRs the bot reviewed | Merged PRs with a summary or a run at any time, divided by merged PRs. A drop points at the setup (a missing secret, a stale template copy, a branch without the workflow) more often than at the rules. | higher |
| Threads per reviewed PR: median, p90, max | Threads per reviewed PR. A reviewed PR without a thread counts as zero; `metrics.md` gives their share. | lower |
| Threads with a human reply | Threads with at least one reply from someone other than the bot. It cannot tell agreement from dismissal; the outcomes can. | higher |
| Threads unanswered at merge | Of the threads opened before the merge of a merged PR, the share that nobody had replied to by the merge and no person resolved. A thread only the bot resolved counts as unanswered: nobody engaged with it. | lower |
| Replied threads fixed or accepted, rejected, deferred | Outcome of each replied thread, from its reply texts (see "Reply outcomes"). | higher, lower, lower |
| Rounds per reviewed PR: median, p90 | Runs that called a model. The bot's own round counter also requires every direction to finish, so it can be lower. `metrics.md` also lists runs per PR, which include runs that only reused earlier results. | lower |
| Tokens per round: median, p90 | Input, output and cache-read tokens of a run that called a model, added up, from the usage stored with the run. Runs without stored usage are left out and counted. | lower |
| Open to merge, hours: median, p90 | `merged_at` minus `created_at` of merged PRs, without sync-like source branches (below). It measures the whole road to merge; review is one part of it, so read it together with rounds and threads. | lower |
| Author quizzes answered | Reviewed PRs whose author answered the quiz, divided by reviewed PRs with a quiz. | higher |
| Follow-up fix pairs, and the two splits | See "Follow-up fixes". | lower |

The change against `--previous` is this week's number minus last week's. For a share, `metrics.md` shows the difference of the two displayed percentages, in points, so the row adds up; `metrics.json` keeps the exact difference.

## Thread groups

Each thread falls into one group, in this order:

1. **P0/P1 defects**: findings with severity P0 or P1.
2. **Maintainability**: other findings of type `maintainability`: copies or structure that agree today and can drift.
3. **Leftovers**: other findings of type `leftover`: code, comments or dependencies a removed feature left behind.
4. **P2 defects**: P2 findings of type `defect`.
5. **Other findings**: findings without a known severity or type.
6. **Rule questions**: questions the pipeline asks by rule (`source` `condition`), split by `kind`: `risk_path` (a risk area of the rule pack was touched), `description` (verification or rollback missing from the description), `ui_evidence` (UI files changed without a screenshot), `severity` (the verifier proposed another severity), `non_convergence` (three blocking rounds in a row), and any kind the bot adds later.
7. **Model questions**: questions a review direction raised for a person (`source` `model`).
8. **Other questions**: questions without a known source.

For every group and rule-question kind `metrics.md` gives the threads, their share of all threads, and the shares replied, resolved, resolved by a person and resolved by the bot, and how many were unanswered at merge. A person resolving a finding usually dismisses it; the bot resolves a finding when the next review of that file no longer reports it, and a rule question when its condition clears.

## Unanswered at merge, caveats

- The record has no resolve time, so a person's resolve counts as an answer whenever it happened.
- A reply without a time counts as answered.
- "Unanswered" does not mean "unread": someone may have read the summary and moved on. It means nobody engaged with the thread.

## Reply outcomes

Every replied thread is classified from its reply texts. Hypothetical clauses are removed first: "if", "unless" or "in case" up to the next punctuation, and 如果, 假如, 要是, 万一 or 假设 up to the next punctuation. Then the first rule that matches decides:

1. **Deferred**, explicit: follow-up; a separate, another, next, later or new PR, ticket or issue; out of scope; not in this PR; tracked in; TODO; tech debt; defer; postpone. In Chinese: 后续, 之后再, 以后再, 下个 PR, 另开, 单独提, 二期, 排期, 先不改, 暂不处理, 技术债.
2. **Rejected**, explicit: by design, intended, expected behavior, won't fix, not a bug, false positive, not applicable, no change needed, keep it as is, not needed, unnecessary, can't happen, already handled. In Chinese: 设计如此, 预期行为, 符合预期, 有意为之, 不是问题, 误报, 不需要改, 无需修改, 不用改, 保持现状, 不改, 不会发生.
3. **Fixed or accepted**: a commit hash (7 to 40 hex characters with a digit and a letter); fixed, done, addressed, updated, changed, added, removed, good catch, good point, agreed, makes sense, will fix, you're right. In Chinese: 已修, 修复, 已改, 改了, 已处理, 已调整, 已补, 补了, 已加, 已删, 已更新, 采纳, 接受, 同意, 有道理, 确实.
4. **Deferred**, weak: later, eventually, someday, not now. In Chinese: 稍后, 回头, 晚点, 以后, 再说.
5. **Rejected**, rebuttal: a sentence that starts with "No," or "Nope", disagree, it's fine, not true, incorrect, doesn't apply, irrelevant. In Chinese: 不会, 不对, 没必要, 不存在, 不涉及, 不影响.
6. **Fixed or accepted**, plain acknowledgement: thanks, ok, sure, yes, LGTM, ack. In Chinese: 好的, 嗯, 可以, 收到, 谢谢.
7. **Other**: nothing matched.

The patterns are approximate:

- "Fixed" is the author's word, not a checked code change.
- A reply that answers a question with evidence ("the screenshot is in the design doc") often ends up as other or rejected, though the question did its job.
- A mixed reply takes the earliest rule that matches.

So judge at least 30 replied threads by hand each week, report the agreement, and when you change the patterns, measure them again on a sample you did not tune them on.

## Follow-up fixes

A merged PR whose `fixes` field names an earlier PR forms one pair per earlier PR. The pairs are split by what the bot did on the earlier PR:

- **flagged**: the earlier PR had a bot thread on a file the fix changed;
- **not flagged**: the earlier PR was reviewed, with no bot thread on those files;
- **not reviewed**: the earlier PR never got a review;
- **missing**: the earlier PR is not in `prs.jsonl`, for example because it was merged before the window.

A pair is a lead, not a verdict: it says only that one PR fixes another. Judge each pair as the weekly procedure says. "Flagged" usually means a thread was ignored, or was about something else on that file; misses hide in "not flagged". To judge a pair whose earlier PR is missing, collect an earlier window for it.

## Time to merge, sync-like branches

PRs whose source branch matches the sync pattern are left out of the time to merge, because their open time follows a release cadence, not review. The default pattern matches `main`, `master`, `trunk`, `dev`, `develop`, `staging` and `production`, branches that start with `release` or `releases` followed by `/`, `-`, `_` or nothing, and any branch with a `sync` segment such as `sync/main-to-dev` or `chore/sync-api`. Replace it with `--sync-branches <regex>` when the team names such branches differently.

## Quantiles

Nearest rank: sort the values and take the one at rank ⌈p·n⌉. The median of an even count is the lower of the two middle values, and every median and p90 is a value that occurred. Below about 20 values, report counts ("3 of 7") rather than shares.

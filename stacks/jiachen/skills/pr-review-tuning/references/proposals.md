# Proposals

At most three a week, each one change with one reason, ranked. A proposal is a draft until a person decides on it.

## Where a change goes

| Where | What it can change | How it lands |
| --- | --- | --- |
| `.mcode-review.json` in the repository | Risk areas (their globs and the questions they ask), `ui_globs`, `generated_globs`, tier thresholds, stack checklists, author quiz settings | A PR to the repository |
| `.mcode-review.md` in the repository | Known failure patterns that every review direction checks | A PR to the repository |
| The plugin in mcode-stack | Lens checklists, prompts, severity and evidence rules, verdict and thread logic, limits in code | An issue or PR upstream, or a commit in the team's fork that CI pins |
| CI settings | Phase, language, branch filters, models | Not by this skill: describe the change and let a person make it |

Prefer the smallest change at the place where the problem starts, and the repository's rule pack over the plugin. Both rule files are read from the merge base, so an approved change applies to PRs whose merge base contains it.

## Template

```markdown
# P<n>: <what changes, in one line>

**Problem, measured.** <numbers from metrics.json with their counts; the threads, PRs or pairs you read, with links>

**Change.** <the exact diff of .mcode-review.json or .mcode-review.md, or the file and rule of a plugin change>

**Expected effect.**

| Goal | Effect | How it was estimated |
| --- | --- | --- |
| Fewer threads per PR | | |
| Fewer follow-up fixes | | |
| Faster review | | |
| Simpler code | | |

**Risk.** <what can get worse, for whom, and which goal it trades against>

**How next week shows it.** <the numbers to watch, and the value that would mean it did not work>

**Other tools.** <how two or three other review tools handle the same problem, each with a link to its documentation and the date read>

**Backtest.** <cases, tokens, result; or why there is none>

**Decision.** <empty until a person decides: approved or rejected, by whom, when>
```

## Estimating the effect

- Replay before you backtest. Many changes (no thread for some kind of question, a cap on new threads per round, skipping some branches) can be estimated from `prs.jsonl` alone: a short script drops the threads the new rule would not have opened and recomputes threads per PR. Say which of the dropped threads people found useful (replied and fixed), and count the P0 and P1 among them.
- Backtest the changes that alter what a review direction looks for or reports; see `backtest.md`.
- Do not claim more precision than the counts allow: below about 20 cases, write "3 of 7", not "43%".

## Other review tools

Find out how established tools handle the same problem: the official documentation or configuration reference of AI review bots (for example CodeRabbit, GitHub Copilot code review, Greptile, Qodo Merge, Graphite) and of rule-based review tools such as Danger. Record the default, what can be configured, the link and the date you read it.

What other tools do is evidence that an approach works somewhere, not a reason on its own. The reason is the mechanism: which threads the change removes or adds on this repository, which existing rule it reuses, and what it costs.

## Ranking

Rank by the measured size of the problem, times your confidence in the effect, divided by risk and cost. One change that removes a class of noise beats several that trim it. Drop a proposal that helps one goal while it clearly hurts another. A proposal a person rejected comes back only with new evidence, and says what is new.

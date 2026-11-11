# Weekly report template

Write `report.md` in the user's language, conclusion first. Every number comes from `metrics.json` or from a judgment recorded in `data/judgments.json`. Keep verified, inferred and unverified claims apart. Leave out a section that has nothing to say, except Conclusion, Headline and Verification.

```markdown
# <week> MCode Review tuning: <project>

Window: <since> to <until>, <time zone>. <First run: measure only. | Proposals wait for a decision.>

## Conclusion

<Two to five sentences: what moved since last week, the largest source of noise, the most costly miss, and what you recommend.>

## Headline

<The headline table of metrics.md: metric, this week, last week, change, direction.>

## Last week's changes

<For each change merged since the last report: what its proposal predicted and what the numbers show.>

## Noise

<Groups, question kinds and PRs that produce threads nobody uses, with numbers and two or three example threads. The agreement of the outcome classifier with your own judgment on the sample.>

## Misses

<Follow-up pairs by judgment: missed, ignored, not visible in review, unrelated. Every miss: the PR, the fix, and what the review should have seen.>

## Speed and cost

<Rounds per PR, tokens per round by tier, time to merge.>

## Maintainability

<Maintainability and duplication threads fixed against deferred; the deferred backlog.>

## Author quiz

<Answer rate, when the quiz is on.>

## Proposals

<Numbered: the change, the measured problem, the expected effect on each goal, the risk, how next week shows it, other tools, the backtest, the file. A table of options where there is a choice, with your recommendation. On the first run: the candidate problems for next week, ranked.>

## Verification

<From verify.md: which numbers were recomputed and how, which judgments were re-judged, the agreement, and what was fixed or taken out.>

## Verified, inferred, not verified

- Verified: <counted by a script and recomputed independently>
- Inferred: <estimates, replays, judgments>
- Not verified: <claims nobody checked, such as "fixed" in a reply>

## Open items from last week

## Files

<Paths of the data, the proposals, the backtest output and verify.md.>
```

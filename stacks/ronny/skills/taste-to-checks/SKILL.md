---
name: taste-to-checks
description: Turn a review correction we keep making on agent output into something that runs on its own, a test, lint rule, hook, CI step or project rule, so the miss does not come back next session. Use when we keep correcting agents on the same mistake (import order, naming, a forbidden API, a missing test), when the same review comment shows up on a second PR, or after a review finds a miss that a check could have caught.
---

# Taste to Checks

If we tell an agent the same thing twice, the second time is our fault. Taste
that lives only in our heads has to be applied by hand in every review, and it
does not scale with the number of sessions we run. We write it down where it
runs by itself.

## 1. Catch the repeat

Signs a correction should become a check:

- we wrote the same review comment on two agent PRs;
- the same thing went wrong after compaction or in a new session;
- `evidence-first-review` found a miss that a mechanical check would catch.

One-off quirks stay out. Only encode what has happened more than once or caused
real damage.

## 2. Write the rule as one testable sentence

Bad: "keep the code clean". Good: "no new `any` in `packages/core`", "every
new tool has a description under 200 characters", "a bug fix PR includes a test
that fails on main".

If we cannot make it testable, it is a judgment call. Keep it in review.

## 3. Pick the strongest place it fits

| Rule shape | Where it goes |
| --- | --- |
| Code pattern to forbid | lint rule or a grep in CI, with an error message that names the fix |
| Behaviour that must hold | test, written to fail on the bad version first |
| Must happen on every edit or commit | hook (pre-commit, or a MiniMax Code hook) |
| Needs context, not mechanical | project rules (`AGENTS.md`) or a skill, as a last resort |

Prefer the top of the table. Text in `AGENTS.md` is read and sometimes
ignored; a failing check is not.

## 4. Prove the check works

Run it against the past mistake: check out the commit or reapply the bad diff
and confirm it fails with a clear message. Then confirm it passes on current
main. A check that never failed has not been shown to work.

## 5. Ship it small

One rule per PR, with the review comment or incident it came from linked in
the description.

## Output

The rule sentence, where it went, the command that showed it failing on the old
mistake and passing on main, and the PR link.

## References

- Addy Osmani, ["Critical thinking when agents do the work"](https://x.com/addyosmani/status/2117512471930167377)

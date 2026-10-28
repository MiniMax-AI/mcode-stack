---
name: independent-review
description: Review a code change from a clean context, the way an outside reviewer would. Use after the agent finishes an implementation, before merging, or when asked for an independent or second-opinion review of a diff.
---

# Independent Review

The agent that wrote the code has made many small decisions and convinced
itself of each one. A reviewer that inherits that conversation tends to follow
the same reasoning and miss the same things. This skill keeps the reviewer
outside the author's context.

Companion to MCode Engineering Notes 01, "More subagents isn't better".

## 1. Give the reviewer exactly three inputs

Collect these, and nothing else:

1. **The diff.** For example `git diff <base>...HEAD`, or the staged changes.
2. **The requirement.** The issue, spec, task description or acceptance
   criteria the change is supposed to satisfy.
3. **Test results.** The commands that were run and their real output,
   including failures and skipped tests.

Do **not** pass the author's conversation, plan, intermediate reasoning or
self-assessment. The question the reviewer answers is "does this change meet
the requirement?", not "does the author's reasoning hold up?".

If the requirement is missing, stop and ask for it. A review without a
requirement can only check style.

## 2. Run the review in a fresh context

Prefer one of these, in order:

- A subagent or task started with only the three inputs above. This is a
  black-box check with a clean boundary and a compact result, which is the
  kind of split that is worth a subagent.
- A built-in review command or skill, if your agent has one, started in a
  new session.
- A new session in which you paste the three inputs.

Ask the reviewer to look in particular for:

- Assumptions the code relies on but does not check (null or empty input,
  callers that "already validate", ordering, concurrency, error paths).
- Requirement items that the diff does not cover.
- Tests that pass without actually exercising the requirement. Tests written
  by the same agent share its blind spots, so check whether they cover the
  requirement, not only whether they pass.
- Behaviour changes outside the stated scope.

## 3. Get findings back in a fixed structure

Each finding must have:

| Field | Content |
| --- | --- |
| Problem | What is wrong, in one or two sentences |
| Location | File and line or function |
| Reason | Why it is wrong, tied to the requirement or to concrete code |
| Severity | blocking / should-fix / nit |

Findings without a location or a reason are treated as opinions, not defects.

## 4. Verify before fixing

Back in the main loop, do not apply findings wholesale. For each one:

1. Open the real code at the stated location.
2. Confirm the problem exists, ideally with a failing test or a concrete input.
3. Only then fix it, and rerun the relevant tests.
4. Record findings you rejected and why, so the next review does not raise
   them again.

## Output

End with a short summary: findings confirmed and fixed, findings rejected
(with the reason), and anything still open.

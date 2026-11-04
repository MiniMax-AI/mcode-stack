---
name: agent-brief
description: Write the brief before handing a non-trivial task to an agent or subagent, covering stakes, your own hypothesis, goal and scope in your words, what "verified" will mean, and whether the agent is thinking with you or for you. Use before starting a MiniMax Code session, spawning a subagent, or delegating a PR, analysis or doc.
---

# Agent Brief

We delegate a lot. What we try not to delegate is knowing what we asked for.
If we cannot write the task down in a few plain lines, the idea is not ready,
and the agent will fill the gaps with defaults we never chose. Five minutes
here saves a review that cannot tell right from plausible.

## 1. Set the stakes

Decide how much of this skill to run.

- **Cheap to be wrong**: a throwaway script, a rename, formatting, a local
  experiment we will delete. Hand it off and skip the rest.
- **Someone else lives with it**: code that ships, a change to the harness,
  anything touching users, money, permissions or data, a number that goes into
  a decision. Run every step, and plan to use `evidence-first-review` after.

When unsure, ask: if this is quietly wrong, who finds out, and when?

## 2. Write a hypothesis first

One line on what we expect the answer or the fix to be, written before the
agent starts. A wrong guess is fine. Its job is to give us something to compare
against, so a polished answer does not become the default.

> Hypothesis: the flaky `compaction.e2e` test is a race between the summary
> write and the next turn, not a model issue.

## 3. Brief in our own words

- **Goal**: the outcome, not the steps.
- **Who uses it**: a reviewer, a user, another agent.
- **Out of scope**: what it must not touch (public API, lockfile, other packages).
- **Constraints**: versions, style, files it may edit, commands it may run.

If we get stuck writing this, we ask the agent to interview us first, or give it
what we know and ask what we have not thought of. We do not ask it to write the
brief for us.

## 4. Define "verified" before seeing output

Pick something we can check later, decided now so we cannot bend it to fit
whatever comes back:

- a named test passes, and a new test fails on the old code;
- a command and its expected output (`mcode -p "..." --json` returns X);
- a screenshot or log line from the real app;
- a number recomputed from the source data.

Give the agent the same means to check itself (test command, fixture, a running
dev server), so it loops before we look.

## 5. Name the mode

Are we asking it to help us think, or to think for us? Both are fine. In the
second case, we owe a stricter review, because we will not have the reasoning in
our heads.

## Card

Paste this at the top of the task:

```text
Stakes: low | high
Hypothesis: ...
Goal / users / out of scope: ...
Done = (tangible check): ...
Mode: think with me | do it for me
When done: show commands run and their output first, then the summary,
then the decisions and assumptions you made.
```

## References

- Addy Osmani, ["Critical thinking when agents do the work"](https://x.com/addyosmani/status/2117512471930167377)

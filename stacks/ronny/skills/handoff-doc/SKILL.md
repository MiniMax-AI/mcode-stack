---
name: handoff-doc
description: Write a hand-off document so a fresh session or another person can continue the current task without the chat history. Use when switching tasks, after several compactions, before clearing a session, or when asked to write a handoff, brief, or progress doc.
---

# Hand-off Doc

Important state should not live only in the context window. A short, readable
hand-off doc lets you clear the session, start a new one, or pass the work to
someone else, and continue with exactly what you consider important.

Companion to MCode Engineering Notes 01 and 03.

## 1. Gather from real sources

Before writing, check the actual state instead of relying on memory of the
conversation:

- `git status`, `git log` for the branch, and the current diff.
- The test or build commands that were run and their latest real results.
- Any existing design, progress or todo files in the repository.
- Open issues, PRs or review comments linked to the task.

If something cannot be verified, mark it "unverified".

## 2. Write the doc

Save it in the repository (for example `docs/handoff/<task>.md`) or wherever
the project keeps working notes. Ask before committing it. Use this template:

```markdown
# Hand-off: <task>

Updated: <date>   Branch: <branch>   Last commit: <short sha>

## Goal
One or two sentences. What "done" looks like, and the acceptance criteria.

## Decisions made
- <decision> - because <reason>

## Constraints to keep
- <constraint the next session must not break, e.g. "do not change the public API">

## Ruled out
- <approach> - why it was dropped (so nobody tries it again)

## Current state
- Done: ...
- In progress: ...
- Verified by: <command> -> <result>

## Next steps
1. <the very next concrete action>
2. ...

## Watch out for
- Known pitfalls, flaky tests, environment quirks.

## Pointers
- Key files, functions, issues, PRs.
```

Keep it short. It is a brief, not a transcript. Leave out debugging
narratives and tool output that can be reproduced.

## 3. Hand over

- Tell the user where the doc is.
- In the new session, reference the doc first (for example by mentioning its
  path) and ask the agent to restate the goal and the next step before it
  starts.
- Update the same doc at each milestone instead of creating new ones.

## Output

The path of the doc and a three-line summary: goal, current state, next step.

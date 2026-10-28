---
name: trajectory-review
description: Review how an agent reached its result, not only whether the result passed, covering tools called, detours, unverified assumptions and wasted round trips, and turn the findings into concrete harness or prompt fixes. Use after an agent task finishes or fails, when an eval task flips, or when asked to look at the process behind a result.
---

# Trajectory Review

A passing result can hide a fragile process: an assumption that happened to
hold, a lucky retry, ten round trips where two would do. A failing result
usually has its cause several steps before the error. Review the path, not
only the end point.

## 1. Get the real trajectory

Use the actual record of the run: the session transcript, tool-call log, or
eval trace. Note the model, settings and repository state. Do not reconstruct
the run from memory.

## 2. Walk it step by step

Build a compact timeline. For each step: what the agent intended, which tool
it called with which key arguments, what came back, and what it decided next.

While walking, mark:

- **Unverified assumptions.** The agent states or acts on something it never
  checked ("callers already validate this", "the test passes").
- **Detours.** Loops, repeated searches with changing keywords, re-reading the
  same file, retries without a change in approach.
- **Wrong tool or wrong arguments.** Including tools it could not find.
- **Context waste.** Large outputs pulled in and never used, polling instead of
  waiting for a notification.
- **Missed signals.** Errors, warnings or test failures it saw and ignored.
- **Instruction drift.** Earlier constraints it later broke, often after
  compaction.

## 3. Find the first point where it went wrong

For a failure, find the earliest step after which success became unlikely.
For a pass, find the riskiest step: where a slightly different input would
have broken it.

## 4. Turn findings into fixes

Map each finding to the cheapest durable fix:

| Finding | Typical fix |
| --- | --- |
| Assumption never checked | A verification step in a skill or project rules |
| Could not find or picked the wrong tool | Tool description, naming or grouping (see `tool-budget-audit`) |
| Lost an earlier constraint | Write it into a file the agent reloads (see `long-session-check`) |
| Polling or waiting idle | Background tasks with notification (see `long-command-check`) |
| Repeated per-turn overhead | Context injection review (see `context-tax-audit`) |
| Model limitation | Record it; re-check after the next model upgrade |

Keep one-off quirks out of project-wide rules. Only propose a rule for
something that has happened more than once or caused real damage.

## 5. Confirm

A fix is a harness change, so check it with `harness-experiment`: rerun the
same task several times and compare the trajectory, not only the outcome.

## Output

The compact timeline with marked steps, the first wrong (or riskiest) step,
and a short list of proposed fixes, each tied to a specific step.

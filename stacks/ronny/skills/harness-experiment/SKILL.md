---
name: harness-experiment
description: Run a harness change as a controlled experiment, with a small end-to-end eval, one change at a time, repeated runs, and looking at flipped tasks, request count, tokens and cache hits, not just the average score. Use before and after changing prompts, tools, skills, subagent layout, compaction or other agent scaffolding, or when asked whether a change helped.
---

# Harness Experiment

Harness engineering moves forward by experiment. The principle:
**measure first, change one thing at a time, keep what survives testing.**

Companion to MCode Engineering Notes 01, 02 and 06.

## 1. Before changing anything

1. **State the hypothesis** in one sentence: what you change, what you expect
   to improve, and what might get worse.
2. **Pick or build a small end-to-end eval.** A handful of golden tasks is
   enough to start. Include tasks for every chain the agent runs in production
   and every rule it must not break. The checks must not be written by the
   agent under test; tests an agent writes for itself share its blind spots.
3. **Pin everything else.** Same model version, same settings, same tool set,
   same repository state. If the model itself changes, treat that upgrade as
   the one change and rerun the same eval.
4. **Record a baseline.** Run each task several times; agent runs are noisy and
   one run can hide a failure.

## 2. Make exactly one change

One prompt edit, one tool moved, one subagent merged, one threshold changed.
If you need several, run several experiments.

## 3. Measure the same things on both sides

For baseline and candidate, record:

| Metric | Why |
| --- | --- |
| Pass rate per task (over repeated runs) | Quality, with noise visible |
| Flipped tasks (pass to fail, fail to pass) | Averages hide regressions |
| Model requests per task | Many wins come from fewer round trips |
| Input and output tokens | Cost and context pressure |
| Cache hit rate | A change can save tokens but break caching |
| Wall-clock time | Latency the user feels |

Only report numbers you actually measured, with run counts.

## 4. Read the result

- Open every flipped task and read the trajectory, not just the final answer
  (see `trajectory-review`). Find out why it flipped.
- A change that keeps the score flat but cuts requests or tokens can be a win.
  A change that raises the average while breaking a must-not-break rule is not.
- If the evidence is mixed, keep the simpler version.
- Write the result down: hypothesis, change, numbers, flipped tasks, decision.
  Next to the code (a PR description or an experiments log) is best.

## 5. Re-check after model upgrades

Scaffolding built around a model's weak spots ages fastest. After each model
upgrade, rerun the eval and ask which parts of the harness still earn their
keep.

## Output

A short experiment record: hypothesis, the single change, eval set and run
count, the metric table for baseline and candidate, flipped tasks with causes,
and the decision (keep / revert / iterate).

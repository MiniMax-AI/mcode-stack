---
name: subagent-split-check
description: Decide whether a piece of work should go to a subagent or stay in the main agent loop. Use before spawning subagents, when designing a multi-agent architecture, or when auditing an existing set of subagents for merging back.
---

# Subagent Split Check

Subagents are a tool for managing context, not for dividing up territory.
Default to one main loop with skills loaded on demand. Split only when one
of the conditions below is clearly met.

Companion to MCode Engineering Notes 01, "More subagents isn't better".
Plain-text checklist: `checklists/subagent-split.md`.

## 1. Is there a context reason to split?

Split is worth considering only if at least one is true:

1. **Measured degradation.** The single loop gets measurably worse because
   its context grows. "Measured" means eval results, not a feeling.
2. **Parallel, disposable work.** Several pieces of work can run in parallel,
   each needs a clean context, and each can be thrown away when done (for
   example independent research threads).
3. **Tool or instruction conflict.** The main agent keeps picking the wrong
   tool, or its instructions conflict with each other.

Then ask the deciding question for the specific step: **will we need the raw
intermediate output later, or only a conclusion?** Only "just the conclusion"
work is a good fit for a subagent.

If the reason is "this belongs to another team" or "this is a different kind
of question", do not split. That leads to lossy hand-offs between agents.

## 2. If you split, cut along context boundaries

- The subtask barely depends on the rest of the system.
- It returns a compact result (a verdict, a list, a small structured object).
- Good examples: independent research threads, a component with a clear
  interface, a black-box verification step.
- Expose the subagent to the main agent as a tool, so the main agent keeps
  the conversation with the user. Hand the whole conversation over only if the
  subagent truly has to talk to the user directly.

## 3. Before splitting, check the cheaper fixes

- **Too many tools?** Merge tools by user intent and defer rarely used ones
  behind tool search (see `tool-budget-audit`).
- **Prompt too big?** Turn procedures and rules into skills, actions and live
  data into tools, and reference material into something loaded on demand.
- **Worried about losing state?** Write the plan, decisions and review
  conclusions into a design or progress doc (see `handoff-doc`). Once state
  lives in a file, the session can be cleared safely, and the urge to split
  "to protect context" mostly goes away.

## 4. Merging existing subagents back

If a system already has many subagents:

1. Build a small end-to-end eval first. A handful of golden examples is enough
   to start.
2. Merge the most frequently used, most tightly coupled ones first: those
   called back to back, reading and writing the same data, or feeding each
   other's input.
3. During the transition, wrap remaining subagents as tools for the main
   agent, which also gives you a baseline.
4. Merge one at a time: its prompt becomes a skill, its API calls become tools.
5. Compare before and after. Look at which tasks flipped, not only the total
   score, and run each task more than once.
6. Keep the subagent only if the merged version is measurably worse.

Use `harness-experiment` for the measuring discipline.

## Output

Answer with: split or keep in the main loop, the condition that justifies it
(or "none met"), where the boundary is if splitting, and what you would
measure to confirm.

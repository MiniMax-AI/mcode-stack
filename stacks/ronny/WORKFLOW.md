# Ronny's day with MiniMax Code

> **Coming soon.** This page will describe, in Ronny's own words, how he works
> with MiniMax Code every day: which parts he hands to the agent, how reviews
> are arranged, how experiments are recorded, and where he keeps a close eye
> himself. It is intentionally left empty until he writes it.

Until then, the skills in [`skills/`](skills/) are the parts of the workflow
that are already written down. A rough map:

| Moment in the day | Skill |
| --- | --- |
| Before splitting work across agents | `subagent-split-check` |
| After the agent finishes a change | `independent-review` |
| When a long session starts to drift | `long-session-check`, `handoff-doc` |
| Before and after any harness change | `harness-experiment`, `trajectory-review` |
| When auditing an agent's design | `tool-budget-audit`, `long-command-check`, `context-tax-audit` |

For reflecting on a finished session, the public
[`retro`](https://github.com/MiniMax-AI/minimax-code/tree/main/.agents/skills/retro)
skill in the MiniMax Code repository fits well alongside `trajectory-review`.

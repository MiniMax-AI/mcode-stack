# Ronny's stack: when to use each skill

Which skill in [`skills/`](skills/) fits which moment of the day:

| Moment in the day | Skill |
| --- | --- |
| Before splitting work across agents | `subagent-split-check` |
| Before opening a large change | `engineering-small-prs`, `engineering-change-descriptions` |
| After the agent finishes a change | `independent-review` |
| Reviewing someone else's PR | `engineering-code-review`, `engineering-review-comments` |
| Answering review on your own PR | `engineering-review-feedback` |
| When a hotfix claims to be urgent | `engineering-emergency-changes` |
| When a long session starts to drift | `long-session-check`, `handoff-doc` |
| Before and after any harness change | `harness-experiment`, `trajectory-review` |
| When auditing an agent's design | `tool-budget-audit`, `long-command-check`, `context-tax-audit` |

For reflecting on a finished session, the public
[`retro`](https://github.com/MiniMax-AI/minimax-code/tree/main/.agents/skills/retro)
skill in the MiniMax Code repository fits well alongside `trajectory-review`.

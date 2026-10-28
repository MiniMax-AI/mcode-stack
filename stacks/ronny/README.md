# ronny

The first stack in MCode Stack: the workflows and self-check skills of
Ronny, R&D lead of MiniMax Code. Each skill pairs with an article in the
*MCode Engineering Notes* series (see [`../../notes/`](../../notes/)).

| Skill | What it does | Notes |
| --- | --- | --- |
| [`independent-review`](skills/independent-review/SKILL.md) | Review a diff from a clean context: only diff, requirement and test results; structured findings verified before fixing | 01 |
| [`subagent-split-check`](skills/subagent-split-check/SKILL.md) | Decide whether work goes to a subagent or stays in the main loop; merge existing subagents back step by step | 01 |
| [`harness-experiment`](skills/harness-experiment/SKILL.md) | Run a harness change as an experiment: small eval, one change, repeated runs, flipped tasks | 01, 02, 06 |
| [`tool-budget-audit`](skills/tool-budget-audit/SKILL.md) | Measure what tools cost in context and pick between trimming, tool search and programmatic tool calling | 02 |
| [`long-session-check`](skills/long-session-check/SKILL.md) | Drop, summarize or write to file; when to compact vs. start fresh; review compaction and memory design | 03 |
| [`handoff-doc`](skills/handoff-doc/SKILL.md) | Write a hand-off doc (goal, decisions, ruled out, next step) so a new session can pick up | 01, 03 |
| [`long-command-check`](skills/long-command-check/SKILL.md) | Ten-point audit of how an agent runs long shell commands and background tasks | 04 |
| [`context-tax-audit`](skills/context-tax-audit/SKILL.md) | Inventory what is injected into every request and how it affects the prompt cache | 06 |
| [`trajectory-review`](skills/trajectory-review/SKILL.md) | Review how the agent got its result, not only whether it passed | - |

Plain-text versions of the checklists live in [`checklists/`](checklists/).
How Ronny strings them together: [`WORKFLOW.md`](WORKFLOW.md) (coming soon).

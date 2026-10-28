# MCode Engineering Notes and their runnable companions

*MCode Engineering Notes* is a column by the MiniMax Code team about the
engineering behind a coding agent. Each article explains one idea; this
repository holds something you can install and run for it.

| # | Article | Companion skills |
| --- | --- | --- |
| 01 | [More subagents isn't better: manage context first, then parallelize](01-subagent.md) | `independent-review`, `subagent-split-check`, `harness-experiment` |
| 02 | [Too many tools will eat your context: from tool search to PTC](02-tool-context.md) | `tool-budget-audit` |
| 03 | [Keeping long sessions sharp: compaction vs. memory](03-compaction-memory.md) | `long-session-check`, `handoff-doc` |
| 04 | [How long should one bash command wait: from foreground blocking to background tasks](04-bash-background.md) | `long-command-check` |
| 06 | [The hidden tax on every turn: what an agent puts into context](06-context-tax.md) *(upcoming)* | `context-tax-audit` |

All companion skills live in [`stacks/ronny/skills/`](../stacks/ronny/skills/).

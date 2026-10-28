# 01 · More subagents isn't better: manage context first, then parallelize

**Read:** [on X](https://x.com/Ronny_MiniMax/status/2114668749131579560)

**In one line:** subagents are a tool for isolating context, not for dividing
up work by team or question type. Default to one main loop with skills loaded
on demand, split only when context is the measured problem, and give code
review its own clean context.

**Companion skills** (in `stacks/ronny/skills/`):

- `independent-review` - the reviewer gets only the diff, the requirement and
  test results; findings come back structured and are verified before fixing.
- `subagent-split-check` - the pre-split checklist and the step-by-step path
  for merging existing subagents back.
- `harness-experiment` - "measure first, change one thing at a time, keep what
  survives testing".

Plain-text checklist: [`checklists/subagent-split.md`](../stacks/ronny/checklists/subagent-split.md)

**Install:**

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/independent-review ~/.agents/skills/
cp -R ~/mcode-stack/stacks/ronny/skills/subagent-split-check ~/.agents/skills/
```

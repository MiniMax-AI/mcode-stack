# 03 · Keeping long sessions sharp: compaction vs. memory

**In one line:** the context window is a workbench, not a warehouse.
Compaction handles "it does not fit right now", memory handles "will we
remember next time". Both are lossy, so get anything important into readable
files early, and start a new session with a hand-off doc when compaction
starts to drift.

**Companion skills:**

- `long-session-check` - sort context into drop / summarize / write to file,
  choose between compacting, rewinding and starting fresh, or review an
  agent's compaction and memory design.
- `handoff-doc` - goal, decisions, ruled-out approaches, current state, next
  step.

Plain-text checklist: [`checklists/long-session.md`](../stacks/ronny/checklists/long-session.md)

**Install:**

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/long-session-check ~/.agents/skills/
cp -R ~/mcode-stack/stacks/ronny/skills/handoff-doc ~/.agents/skills/
```

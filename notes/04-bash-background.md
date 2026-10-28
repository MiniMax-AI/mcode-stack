# 04 · How long should one bash command wait: from foreground blocking to background tasks

**In one line:** waiting on a long command wastes the user's time and can let
the prompt cache expire. Foreground is for fast commands, background is for
long ones, and the same process should connect the two. Everything that
synchronous execution gave for free (getting results back, knowing when it
ended, cleanup, remembering after compaction) then has to be rebuilt.

**Companion skill:** `long-command-check` - a ten-point audit for agent
builders, plus quick behavioural tests.

Plain-text checklist: [`checklists/long-command.md`](../stacks/ronny/checklists/long-command.md)

The implementation discussed in the article is open source in
[MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code), mainly
under `packages/local-runtime/src/background-task/`.

**Install:**

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/long-command-check ~/.agents/skills/
```

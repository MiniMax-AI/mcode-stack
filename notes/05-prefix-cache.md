# 05 · How does the agent know the current time?

**In one line:** the model has no clock. Stuffing `date` into the system
prompt is the most direct fix — and it breaks the prefix cache every turn.
Put session-stable `# Environment` up front; put per-turn time in
`<agent-context>` that is written into history and never rewritten; keep
precision to the minute. For each injected part, ask what breaks without it,
whether it needs every turn, how precise it must be, and whether its position
breaks the prompt cache.

**Companion skill:** `context-tax-audit` - inventory one real request, then
check necessity, frequency, precision, position and cache impact.

Plain-text checklist: [`checklists/context-tax.md`](../stacks/ronny/checklists/context-tax.md)

**Install:**

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/context-tax-audit ~/.agents/skills/
```

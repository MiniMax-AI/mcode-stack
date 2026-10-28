# 06 · The hidden tax on every turn: what an agent puts into context *(upcoming)*

**In one line:** every request carries far more than the user's sentence.
For each injected part, ask what breaks without it, whether it needs to be in
every turn, how precise it needs to be, and whether its position breaks the
prompt cache.

**Companion skill:** `context-tax-audit` - inventory one real request, then
check necessity, frequency, precision, position and cache impact.

Plain-text checklist: [`checklists/context-tax.md`](../stacks/ronny/checklists/context-tax.md)

**Install:**

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/context-tax-audit ~/.agents/skills/
```

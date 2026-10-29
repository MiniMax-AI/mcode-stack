# 05 · One small field can break the whole prefix cache

**In one line:** prompt caches match on prefix. A volatile field in the system
prompt kills the whole stable prefix; put session-stable env up front and
per-turn time in `<agent-context>` that is never rewritten. For each injected
part, ask what breaks without it, whether it needs every turn, how precise it
must be, and whether its position breaks the prompt cache.

**Companion skill:** `context-tax-audit` - inventory one real request, then
check necessity, frequency, precision, position and cache impact.

Plain-text checklist: [`checklists/context-tax.md`](../stacks/ronny/checklists/context-tax.md)

**Install:**

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/context-tax-audit ~/.agents/skills/
```

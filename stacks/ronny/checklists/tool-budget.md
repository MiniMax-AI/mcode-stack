# Checklist: tools and context

From MCode Engineering Notes 02. Skill version: `skills/tool-budget-audit`.

- [ ] Measure first: how much context the tool definitions take, how much the tool results take in a task, and how many round trips a task needs.
- [ ] Tools are merged by user intent; names and descriptions are clearly distinguishable; return formats are documented.
- [ ] High-frequency core tools stay resident; low-frequency tools and large MCP tool sets are loaded on demand.
- [ ] Tool search recall was tested on your own tool set, not only on someone else's benchmark.
- [ ] Tools whose catalog is fetched over the network every turn do not slow down the first token.
- [ ] With programmatic tool calling, tools are actually moved into the program, and you decided which must stay at top level.
- [ ] Tool calls from inside the program go through the same permissions, hooks and UI as direct calls.
- [ ] Tool failures return an error result instead of throwing; tools return structured data where possible.
- [ ] All logic keyed on tool names was checked so it does not silently stop working after tools move into the program.
- [ ] End-to-end eval before and after: score, request count and tokens.

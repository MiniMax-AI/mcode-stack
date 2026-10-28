# Checklist: before you split work into a subagent

From MCode Engineering Notes 01. Skill version: `skills/subagent-split-check`.

- [ ] Will the intermediate output of this subtask be needed later? Only split if you just need the conclusion.
- [ ] The reason for splitting is context, not "this belongs to another team" or "this is a different kind of question".
- [ ] There is eval data showing the single loop really gets worse, not just a feeling.
- [ ] Are there more tool definitions than the model handles well? Merge by user intent first and defer rarely used tools behind tool search.
- [ ] Procedures and rules are skills, actions and live data are tools, reference material is loaded on demand.
- [ ] The plan, decisions and review conclusions are written into a design or progress doc, not only in the conversation.
- [ ] An end-to-end eval was run before and after, flipped tasks were inspected, and each task was run more than once.

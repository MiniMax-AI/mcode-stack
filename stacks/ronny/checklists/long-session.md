# Checklist: long sessions, compaction and memory

From MCode Engineering Notes 03. Skill version: `skills/long-session-check`.

- [ ] Old tool results are cleared first, before summarizing the whole history.
- [ ] Key decisions and constraints from the session are written into files, not only kept in the conversation.
- [ ] Manual compaction tells the model what comes next and what to keep.
- [ ] The automatic compaction trigger leaves room for output and for the summary. The session can continue if compaction fails.
- [ ] Compaction requests can hit the prompt cache, and compaction does not run so often that it keeps invalidating it.
- [ ] A new task gets a new session. After several compactions, switch to a hand-off doc.
- [ ] `AGENTS.md` / `CLAUDE.md` is short and holds only long-lived, stable rules.
- [ ] Memory is scoped. Temporary progress and todos stay out of long-term memory.
- [ ] When memory exceeds its budget, truncation is visible and the most important rules always load.

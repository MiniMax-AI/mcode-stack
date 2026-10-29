# Checklist: what you inject into every request

From MCode Engineering Notes 05. Skill version: `skills/context-tax-audit`.

| Item | Ask yourself |
| --- | --- |
| Prefix awareness | Can you point to, in one request, what is the stable prefix and what changes every turn? |
| Necessity | If you delete each part, where would the model go wrong? If you cannot say, consider deleting it. |
| Position | Is current time (or anything else that changes) in the system prompt? Move it later — e.g. time in per-turn `<agent-context>`, not `# Environment`. |
| Frequency | Does a changing field need every turn / every request? Could it appear only at the start, at key points, or on change? |
| Precision | Does time need seconds? Do numbers need every digit? The more precise, the more it changes every turn. |
| Don't edit history | Are reminders already written into history rewritten in later turns? |
| Recovery | Does removed information disappear entirely on compaction, session resume or subagents? Who brings it back? |
| Measurement | Before and after a change, do you look at cache hit rate, cost per turn and quality together? Token count alone is not enough. |

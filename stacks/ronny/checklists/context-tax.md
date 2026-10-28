# Checklist: what you inject into every request

From MCode Engineering Notes 06 (upcoming). Skill version: `skills/context-tax-audit`.

| Item | Ask yourself |
| --- | --- |
| Inventory | Can you list everything in a request besides the user message, and how many tokens each part takes? |
| Necessity | If you delete each part, where would the model go wrong? If you cannot say, consider deleting it. |
| Frequency | Does it need to appear in every turn and every request? Could it appear only at the start, at key points, or on change? |
| Precision | Does time need seconds? Do numbers need every digit? The more precise, the more it changes every turn. |
| Position | Is anything that changes placed in the system prompt or tool definitions? Move it later. |
| Don't edit history | Are reminders already written into history rewritten in later turns? |
| Request-level reminders | Reminders attached only to the end of a request are paid at full price every time. Is their frequency controlled? |
| Recovery | Does removed information disappear entirely on compaction, session resume or subagents? Who brings it back? |
| Mode consistency | Can the prompt or tool set switch mid-session? |
| Measurement | Before and after a change, do you look at cache hit rate, cost per turn and quality together? Token count alone is not enough. |

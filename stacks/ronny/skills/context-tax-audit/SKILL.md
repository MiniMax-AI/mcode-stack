---
name: context-tax-audit
description: Inventory everything an agent injects into each request besides the user's message, such as system prompt, environment info, skill list, tool definitions, per-turn context blocks and reminders, and check necessity, frequency, precision, position and prompt-cache impact. Use when reviewing an agent's prompt assembly, chasing low cache hit rates, or trimming per-turn overhead.
---

# Context Tax Audit

Every request carries more than the user's sentence: system prompt,
environment info, the skill list, tool definitions, per-turn context blocks,
reminders. Most of it is worth paying for. The audit finds what is not, and
what is placed so that it breaks the prompt cache.

Companion to MCode Engineering Notes 05.
Plain-text checklist: `checklists/context-tax.md`.

## 1. Inventory one real request

Capture an actual request the agent sends (debug log, proxy, or the code that
assembles it). List every part except the user's message:

| Part | Where it sits | How often it changes | Tokens |
| --- | --- | --- | --- |

Count tokens with a tokenizer and name it; treat the counts as relative.
Do a fresh-session first request and a later turn, since they often differ.

## 2. Necessity - what breaks if you delete it?

For each part, write one sentence: "without this, the model would ...".
Typical answers: without environment info it guesses the OS and shell; without
the current time it assumes its training year; without a time budget it does
not wrap up before a deadline. If you cannot write the sentence, the part is a
candidate for removal.

## 3. Prompt-cache placement

Caches match on prefix. One changed byte invalidates everything after it.

1. Content that is **at the front and changes every request** is the most
   expensive. Move it later.
2. Content **written into history and never edited** costs once and then stays
   cacheable.
3. Content **attached only to the current request** is never cached and is
   paid at full price every time. Control its frequency.

Rules of thumb:

- Stable first, volatile last. Keep the system prompt identical for the whole
  session; put time and similar fields in the per-turn message.
- Never rewrite reminders already in history; change only future turns.
- Use only the precision you need. A timestamp to the second guarantees every
  copy differs.
- Do not switch prompt or tool set mid-session unless you mean to pay for it.

## 4. Run the checklist

| Item | Question |
| --- | --- |
| Inventory | Can you list every part of a request besides the user message, with its size? |
| Necessity | For each part, where does the model go wrong without it? |
| Frequency | Does it need to be in every turn or request, or only at the start, at key points, or on change? |
| Precision | Does it need seconds, exact counts? Higher precision means more turn-to-turn variation. |
| Position | Is anything volatile inside the system prompt or tool definitions? |
| History | Are reminders already in history ever rewritten later? |
| Request-level reminders | Is the frequency of end-of-request reminders controlled? |
| Recovery paths | If you remove something, does it vanish entirely on compaction, session resume or subagents? Who restores it? |
| Mode consistency | Can the prompt or tool set change mid-session? |
| Measurement | Before and after a change, do you look at cache hit rate, cost per turn and task quality, not just token count? |

## Output

The inventory table, a list of parts to cut, move, reduce in frequency or
reduce in precision (each with the reason), and what to measure to confirm
the change helped.

---
name: long-session-check
description: Check how an agent or a working session handles long conversations, covering tool-result clearing, compaction, what gets written to files, when to start a new session, and how memory is scoped. Use when a long session starts forgetting constraints, after several compactions, or when reviewing an agent's compaction and memory design.
---

# Long Session Check

The context window is a workbench, not a warehouse. Compaction answers "it
does not fit right now"; memory answers "will we remember next time". Both are
lossy. The safe pattern is to get anything important into human-readable
files early, and to treat compaction as tidying the workbench, not as the only
safety net.

Companion to MCode Engineering Notes 03, "Keeping long sessions sharp".
Plain-text checklist: `checklists/long-session.md`.

This skill has two modes. Pick the one that matches the request.

## Mode A - the session you are in right now

1. **Sort what is in context into three bins.**
   - *Drop*: things you can fetch again or no longer need (large file reads,
     test logs, search results, abandoned attempts).
   - *Summarize*: this-session-only story (where we are, next step, open bugs
     and leads, files recently touched).
   - *Write to a file*: anything that would hurt if lost or is needed in a
     later session (decisions and their reasons, progress, todos, acceptance
     criteria, long-lived rules).
2. **Write the third bin down now**, in the project's progress or design doc,
   or via `handoff-doc`.
3. **Choose the next move:**
   - Same task, history just long: compact, and say what comes next and what
     must be kept (for example "focus on the auth refactor, drop the test
     debugging").
   - New task: start a new session.
   - Compacted several times and drifting, or repeating questions already
     answered, or breaking earlier constraints: write a hand-off doc and start
     fresh with it.
   - Went the wrong way: rewind to before the mistake instead of compacting,
     so the wrong attempt does not end up in the summary.

## Mode B - reviewing an agent's design

Read the agent's code and configuration and answer each item with evidence
(file and line, config key, or observed behaviour):

1. Are old tool results cleared before resorting to a full summary?
2. Are tool calls and their results kept in pairs when results are cleared?
   Many model APIs reject orphaned calls.
3. Do key decisions and constraints get written to files, not only kept in
   the conversation?
4. Does manual compaction accept instructions about what to keep and what
   comes next?
5. Does automatic compaction trigger early enough to leave room for output
   and for the summary itself? Can the session continue if compaction fails
   (quota, smaller model)?
6. Can the compaction request reuse the prompt cache? Does compaction run so
   often that it keeps invalidating the cache?
7. Does compaction change only what the model sees, leaving the user's visible
   history intact? Is it kept out of user-facing budgets such as step limits?
8. Is the model told that context is managed automatically, so it does not
   stop half way to "continue next turn"?
9. Is project memory (`AGENTS.md` or similar) short and limited to stable
   rules?
10. Is memory scoped (session, project, user)? Are temporary progress and
    todos kept out of long-term memory?
11. When memory exceeds its injection budget, is truncation visible, and are
    the most important rules guaranteed to load?
12. Can a human open, edit and switch off the memory? Rules that must be
    enforced belong in hooks, not in memory.

## Output

For Mode A: the three bins, what you wrote to which file, and the chosen next
move. For Mode B: a table of the items with pass / fail / unknown, the
evidence, and the top fixes in priority order.

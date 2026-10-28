---
name: long-command-check
description: Audit how an agent harness runs long shell commands, covering foreground wait limits, moving to background without re-running, timeouts, completion notification, polling, output size, cleanup and behaviour after compaction. Use when building or reviewing an agent's shell or background-task tool, or when an agent hangs on dev servers, long builds or test runs.
---

# Long Command Check

For people building agents. The question is simple: when the agent runs a
shell command, should it wait for it to finish? Following that question leads
to a chain of design decisions. Foreground is for fast commands, background is
for long ones, and ideally the same process connects the two.

Companion to MCode Engineering Notes 04, "How long should one bash command
wait". Plain-text checklist: `checklists/long-command.md`.

## Why waiting is expensive

Two costs while the agent blocks on a command:

- The visible one: the user waits and nothing else happens.
- The hidden one: the provider's **prompt cache can expire**. While a command
  runs in the foreground there are no new model requests. If the wait is
  longer than the cache lifetime of the model service you use, the next
  request re-processes the whole prefix: slower first token, higher cost.
  Look up the cache lifetime in your provider's documentation.

Moving work to the background does not keep the cache warm forever. It saves
the time the agent would otherwise spend idle when it had other work to do.

## How to run the audit

Read the shell tool and background-task code of the target agent. For each
item, record the answer with evidence (file and function, config, or a test
you ran). Do not guess; write "unknown" if the code does not show it.

| # | Item | Question |
| --- | --- | --- |
| 1 | Foreground limit | How long does the foreground wait at most? Is that comfortably below the cache lifetime of your model service, leaving room for generation time? |
| 2 | No re-run | When a command moves from foreground to background, is it the same process, or is it killed and started again? |
| 3 | Timeout accounting | After moving to background and reading output, is the deadline reset? (It should not be, or a stuck command can run forever.) |
| 4 | Result delivery | When a background task finishes, does the model learn it from a notification, or only by polling? |
| 5 | Notification position | Is the notification appended at the end, or does it modify an already cached prefix? |
| 6 | Anti-polling | Is blocking wait time capped, and does repeated reading with no change produce a hint to stop polling? |
| 7 | Output size | Is large output truncated or written to a file and read incrementally, rather than pasted whole into context? Is incomplete output labelled as incomplete? |
| 8 | Cleanup | Who stops background tasks when the user stops the agent, when a one-shot headless run exits, and when the process restarts? Are orphaned tasks marked instead of showing "running" forever? |
| 9 | After compaction | Is "a task finished and its result was not read" tracked outside the conversation history (for example a task table), so it survives compaction? |
| 10 | Precondition | If the current environment cannot read background results, is backgrounding disabled? |

## Quick behavioural tests

If you can run the agent, try these and record what actually happened:

1. Ask it to start a dev server and then do something else. Does it hang?
2. Run a command that takes several minutes. Does it move to the background
   without starting a second copy?
3. Start a background task, then stop the agent. Is the task stopped?
4. Let a background task finish, then trigger compaction before reading the
   result. Is the unread result still surfaced afterwards?

## Output

A table of the ten items with pass / fail / unknown and evidence, the results
of any behavioural tests, and the top three fixes.

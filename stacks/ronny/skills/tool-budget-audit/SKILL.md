---
name: tool-budget-audit
description: Audit how much context an agent's tools consume, through tool definitions and tool results, and decide whether to trim the catalog, add tool search, or add programmatic tool calling. Use when an agent has many tools or MCP servers, picks the wrong tools, or burns context on tool output.
---

# Tool Budget Audit

Tools cost context in two ways, plus one side effect:

- **Definitions.** Every tool's name, description and parameter schema sits
  in context whether or not it is used this turn.
- **Intermediate results.** Every call puts its full output back into the
  conversation, and every round trip is another full model request.
- **Side effect: wrong picks.** Similar names and vague descriptions make the
  model choose the wrong tool or pass wrong arguments.

Tool search mainly saves the first cost. Programmatic tool calling (the model
writes a small program that calls tools) mainly saves the second.

Companion to MCode Engineering Notes 02, "Too many tools will eat your
context". Plain-text checklist: `checklists/tool-budget.md`.

## 1. Measure first

Work from the target project's code and real requests, not from guesses:

1. List every tool exposed to the model, grouped by source (built-in, each MCP
   server, plugins).
2. Estimate the token size of each tool definition with a tokenizer and sum it.
   Say which tokenizer you used; it is a relative measure.
3. For one or two representative tasks, record how many tool calls were made,
   how many model requests that caused, and how large the tool results were.
4. Note which tools are used almost every turn and which are rarely used.

Report the numbers you measured. If you cannot measure something, say so
instead of estimating.

## 2. Step 0 - subtract

- **Merge by user intent.** Do not map APIs one to one. "List issues",
  "filter issues by label" and "filter by author" can be one tool with
  parameters.
- **Make names and descriptions distinguishable.** Two tools whose
  descriptions read alike will be confused. State the return format.
- **Group.** Put tools into namespaces by domain, keeping each group small.
- **Decide what stays resident.** Read, edit, search and run-command style
  tools used nearly every turn should always be loaded.

## 3. Step 1 - deferred loading and tool search

Consider it when there are many tools and most are rarely used.

- Keep core high-frequency tools resident; make low-frequency tools
  searchable.
- If a search miss means a tool "does not exist", check descriptions again:
  vague descriptions break recall.
- Test tool search recall on **your own** tool set. Results on clean
  benchmarks do not transfer to messy real catalogs.
- Tools whose catalog must be fetched over the network every turn can slow
  the first token. Consider keeping them resident instead.
- When debugging, check what the model had actually seen at that moment, not
  just what the request listed.

## 4. Step 2 - programmatic tool calling

Consider it when there is a lot of data to filter or aggregate, three or more
dependent calls, or batch operations that could run in parallel.

- Actually move tools into the program. Offering a code tool next to all the
  normal tools tends to go unused.
- Keep at top level: tools that interact with the user, change session state,
  need their result read before deciding the next step (tool search, loading
  a skill), browser and publishing tools, and spawning subagents.
- Calls from inside the program must go through the same validation, hooks,
  permission prompts and UI as direct calls.
- Tool failures should return an error result, not throw, so one failure does
  not discard the whole program.
- Prefer structured tool output so the program can pick the fields it needs.
  A program that returns raw output saves nothing.
- Search the codebase for logic keyed on tool names (reminders, counters,
  analytics). It silently stops firing once a tool moves into the program.

## 5. Decide

| Bottleneck | First move |
| --- | --- |
| Too many or too similar tools | Subtract, merge, rename, group |
| Definitions take too much context | Tool search |
| Results take too much context, too many round trips | Programmatic tool calling |
| Arguments often wrong | Better descriptions and examples |

The steps stack. A clean catalog makes tool search work; working tool search
makes programmatic calling work. Run an end-to-end eval before and after each
step and look at score, request count and tokens together
(see `harness-experiment`).

## Output

A short report: measured numbers, the main bottleneck, the recommended next
step with concrete tool names, and what to measure afterwards.

---
name: evidence-first-review
description: Review an agent's finished work by reading the evidence before its summary, naming what each check proves and what it misses, pulling out the decisions it made silently, and trying to falsify the result before accepting it. Use when a MiniMax Code session, subagent or cloud agent reports a task done, before merging its PR or acting on its analysis.
---

# Evidence-First Review

"All tests pass, ready to merge" is a claim, not evidence. We read what the
agent actually ran before we read what it says about it. The bar for accepting
the work: we could defend it to the person who will maintain it, and we can
say what our checks would miss.

This skill is about owning the result. For a clean-context code review of the
diff itself, pair it with `independent-review`.

## 1. Evidence before summary

Open the transcript or tool log, not the final message. For each command that
supports "done": did it run on the final code, did it exit 0, does the output
say what the summary says? Typical gaps we find:

- tests run before the last edit;
- a filter like `-t compaction` that skipped the suite that matters;
- "fixed" with no reproduction before the fix;
- a build that passed only because a step was skipped.

## 2. For each green check, one property it proves and one it does not

| Check | Proves | Does not prove |
| --- | --- | --- |
| New unit test passes | the function returns X for this input | the caller passes that input; the test was written with the same wrong assumption |
| `pnpm typecheck` | types line up | runtime behaviour |
| E2E with a mock model | the loop wires up | anything about real model output |

If we cannot fill the right column, we do not understand the check yet.

## 3. Ask for the decisions list

Ask the agent: which defaults did you pick, what did you leave out of scope,
and where did you reinterpret the requirement because two parts clashed? These
are the choices that end up in production without anyone deciding them. Each one
is accepted, changed or sent back.

## 4. Try to break it

Ask: what would have to be true for this to be wrong? Then check that one thing
ourselves. For analysis and docs, open two of the cited sources and recompute
one number the conclusion depends on.

## 5. Make sure we understand it

- Pick a few lines of the diff at random and explain them without help.
- For a large change, ask the agent for a short report that ends in three
  questions about the change; we answer them before merging.
- For a contested call, have a fresh subagent argue the other side, then
  decide ourselves.
- Last question to a fresh context: "What did I miss?"

## 6. Decide

- **Accept**: the evidence matches, decisions are reviewed, we can name the gap.
- **Ask for more**: missing evidence or an unexplained decision.
- **Get a human review**: high stakes and we cannot say what the checks miss.

## Output

When we report the work to others, we lead with the evidence (commands and
results), then: what was checked, one thing that was not, and the key
decisions.

## References

- Addy Osmani, ["Critical thinking when agents do the work"](https://x.com/addyosmani/status/2117512471930167377)

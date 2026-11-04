---
name: review-capacity-check
description: Check whether finished agent work is piling up faster than we can stand behind it, and fix that by tightening automatic checks or running fewer parallel sessions instead of starting another one. Also checks that multi-agent chains read original sources, and which skills we are letting go. Use before launching another parallel session or subagent batch, at the end of a day with many agent PRs, or in a weekly review.
---

# Review Capacity Check

Running five MiniMax Code sessions in parallel is easy. Standing behind five
results is not. Every agent we launch costs review time later. When finished
work waits longer than it took to produce, we are not reviewing any more, we are
hoping.

## 1. Count the queue

Before starting another session, list what is already done but not yet
accepted by us: open agent PRs, finished subagent outputs, analyses nobody has
checked. For each, note the stakes (see `agent-brief`).

If more than a couple of high-stakes items are waiting, do not launch. Clear the
queue or reduce what needs us.

## 2. Reduce what needs us, not the bar

In order of preference:

1. **Let checks do more**: add a test, lint or CI step so a class of review is
   automatic (see `taste-to-checks`).
2. **Make agents prove more**: require the evidence block from `agent-brief` in
   every result, so review starts from commands and output.
3. **Run fewer at once**: fewer sessions we can defend beat more we cannot.

Skimming high-stakes work faster is not on the list.

## 3. Check the chain

In a pipeline (research agent, then writer, then reviewer), each later agent
should read the original source, not only the previous agent's summary.
Summaries drop caveats; three hops later the caveat is gone and the claim is
stronger than the data. Check that the last agent's context includes the source
files, logs or links, not just the hand-off text.

## 4. Weekly: what are we no longer practicing?

Write down one or two things the agent now always does for us (reading a stack
trace, writing a migration, sizing a query). For each, decide on purpose: fine
to let go, or keep doing it by hand now and then so we can still judge the
agent's version.

## Output

The queue with stakes, a decision (launch, clear first, or add a check), and the
weekly list if it is that day.

## References

- Addy Osmani, ["Critical thinking when agents do the work"](https://x.com/addyosmani/status/2117512471930167377)

# Jiachen's day with MiniMax Code

> **Draft.** Written from the rules in my agent instructions; I will rewrite
> it in my own words.

Most of what I hand to the agent is engineering work across several
repositories: investigating bugs, writing fixes, opening and following merge
requests. The rules below decide where I step in and where I do not.

## Plan first, then decide in one pass

For anything bigger than a small change, the agent writes a plan before it
touches code. Every open decision in the plan is numbered and carries a
recommended option, what changes for whom, and what it costs. I answer all of
them inline in one pass. Reversible details inside an approved plan the agent
decides itself and lists in its final report.

## Every claim comes with a probability and a check

A root cause, a diagnosis or "this fix will work" comes with a probability,
what was verified versus inferred, and the check that would change the
agent's mind. Checks that do not rely on the agent's own judgment come first:
a test, a script, raw logs, source code, git history.

## Reproduce before fixing

A fix starts with a test as close to end to end as possible that fails on the
unfixed code with the same symptom the user saw. Only then does the agent
change code, until the same tests pass. Local experiments run in an isolated
data directory under a temp folder, so they never touch the setup I am using.

## Delivered means ready to merge

Opening a merge request is not the end. The agent follows it until there are
no conflicts, CI is green and the reasonable AI review comments are fixed;
for the rest it writes why they were not taken. Merging, publishing and
sending messages stay with me.

## Push back early

If a task looks not worth doing, or the outcome is fixed by conditions
nobody here can change, the agent says so before starting instead of
polishing details inside it.

## Getting out of the loop

Once a week a scheduled run of `lifting-loops` reads my recent sessions and
finds the places where I keep acting as a manual step: retrying, approving,
re-explaining context. I accept or reject its proposals, and the accepted
ones land in a skill, an `AGENTS.md` or a script. Most of the rules above
started as a loop it found.

| Moment | Skill |
| --- | --- |
| After a long session, or once a week | `lifting-loops` |
| Turning notes or research into a post or a short video | `making-content` |

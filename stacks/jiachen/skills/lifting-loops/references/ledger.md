# Private file formats

This skill maintains every file under `private/`. The directory is gitignored; if the skill folder sits in a synced folder (iCloud, Dropbox), it reaches the user's other machines.

Sections: file list, config.json, ledger.md, statuses and transitions, proposals/P-NNN.md, report.md.

The templates below are in English. Write the files in the user's language; when a file already exists, keep its language and field names.

## File list

- `private/config.json`: data-source settings for this skill
- `private/state.json`: scan cursors, written only by `digest.py mark`
- `private/ledger.md`: the loop ledger
- `private/proposals/P-NNN.md`: proposals, one file each
- `private/runs/<date>-<host>/`: one batch run's digests, `run.json` and `report.md`

## config.json

```json
{
  "vault": "~/path/to/obsidian/vault",
  "vault_exclude": ["folder-a", "folder-b/subfolder"],
  "vault_full_history": ["folder-with-reviews"],
  "vault_ai_marker": "^>.*(Author:.*\\(AI\\)|\\(AI generated\\))",
  "claudeai_backup": "~/path/to/claude-export",
  "first_run_days": 90
}
```

- `vault`: root of the Obsidian vault. `null` if there is none.
- `vault_exclude`: folders written by automations, relative to the vault root. They are left out of the digest.
- `vault_full_history`: folders listed in full on the first scan, ignoring the time window. Usually monthly or yearly reviews.
- `vault_ai_marker`: a regular expression matched against the first 800 characters of a note; a match marks the note as written by an agent. Optional; the default is shown above.
- `claudeai_backup`: the claude.ai export directory, which must contain `conversations/split/index.json`. `null` if there is none.
- `first_run_days`: how many days back to scan when there is no cursor yet.

## ledger.md

```markdown
# Loop ledger

Updated: YYYY-MM-DD (session mode / batch mode · host)

## L-001 One-sentence description of the loop

- Status: observed
- Role: Retry
- First / latest: YYYY-MM-DD / YYYY-MM-DD
- Evidence count: 4 (across 3 sessions)
- Evidence:
  - YYYY-MM-DD · claude · a1b2c3d4 · "Try again"
- Counted sessions: a1b2c3d4 e5f6a7b8 c9d0e1f2
- Goal behind the goal: the outcome the user actually wants, in one sentence
- Metric: human interventions per week; outcome signal: one sentence
- Metric log: YYYY-MM-DD 3 · YYYY-MM-DD 1
- Proposal: P-002 (open)
- Artifact: path or —

## Retired

- L-000 One-sentence description · reason for retiring · YYYY-MM-DD
```

Rules:

- "Counted sessions" lists the first 8 characters of every session id ever counted, and nothing is removed from it. Check this line before merging new evidence: if the session is already there, skip it. The exception is the current session in session mode, which can keep adding evidence.
- Keep only the 5 most recent pieces of evidence per loop. Older evidence only counts toward "Evidence count".
- Each piece of evidence has the date, the source, the first 8 characters of the session id, and the user's words (at most 60 characters). When the source is the vault, use the note's relative path instead of a session id.
- Every batch run appends one number to "Metric log"; keep only the latest 8.

## Statuses and transitions

| Status | Entered when |
|---|---|
| observed | first seen |
| candidate | evidence count ≥ 3 across ≥ 2 sessions; or the user spent ≥ 10 turns on it in one session |
| proposed | a proposal is written and waits for the user's decision |
| graduated | the user accepted it and the artifact is in place |
| reopened | after graduating, 4 consecutive batch runs where the intervention count never fell below the average of the 4 weeks before graduation |
| retired | observed with no new evidence for 8 weeks; or graduated with 0 interventions for 8 weeks and a normal outcome signal |

- If the user rejects a proposal, move the loop back to candidate and record the reason in the proposal file.
- Do not propose a rejected exit again. Once ≥ 3 new pieces of evidence arrive, you may propose a different exit.
- Treat a reopened loop as a candidate; its proposal must say why the previous artifact did not work.

## proposals/P-NNN.md

```markdown
---
id: P-007
loop: L-003
status: open
exit: change an existing artifact
target: ~/path/to/repo/.agents/skills/foo/SKILL.md
created: YYYY-MM-DD
---

# One sentence on what changes

## Evidence

3–5 items, in the ledger format.

## Goal behind the goal

One sentence.

## Change

When the target is a git-tracked file, a unified diff that applies as is.
For a new file, its full text. Advice about the user's own habits does not need this section.

## Metric

- How to count interventions: which of the user's words, and which sessions, count as one
- Outcome signal: when interventions drop, what confirms the user did not just give up

## Redaction check

For each redaction rule in SKILL.md, write "pass" or what you changed.

## Decision

Filled in once the user decides: accepted / rejected with the reason / date.
```

- `status` is one of `open`, `applied`, `rejected`.
- Numbers increase globally. A new number is the highest number in `private/proposals/` plus 1.

## report.md

```markdown
# Lifting Loops weekly report · YYYY-MM-DD · host

## Needs your decision

- P-007 one sentence → [proposals/P-007.md](../../proposals/P-007.md)

## This week in numbers

N sessions (a started by hand, b scheduled), M interventions: retry r, judge j, approve g, carry c, trigger t, stand in h.

## Graduated loops

| Loop | Artifact | Weekly interventions before graduation | This week | Outcome signal |
|---|---|---|---|---|

## New and escalated

- L-012 (new) one sentence
- L-004 observed → candidate, reason

## Suggestions for you

At most 3. Only habits that the user alone can change.

## Memory tidy-up

One line per memory: keep / covered by an artifact, can delete / proposal P-NNN.

## Metric check

One sentence per metric: does the change in the number mean things really got better?
```

# Community stacks

Stacks from developers outside the MiniMax Code team: how people actually
work with MiniMax Code, or with any agent that supports `SKILL.md` skills.

Issues and discussion are welcome. For now, pull requests are accepted only
from repository collaborators. If you are not a collaborator, open an issue
to discuss first.

## What we accept

- One stack = one person's or one team's real daily practice: a `WORKFLOW.md`
  plus at least one skill or checklist you really use.
- Not accepted: prompt collections, "ideal" processes nobody runs, anything
  tied to a private system that others cannot run.

## How to submit

Collaborators follow every step. If you are not a collaborator, do step 1
only.

1. Open a **New stack** issue first: who you are, how you use agents, and what
   you plan to include.
2. Copy `templates/stack-template/` to `community/<your-id>/`.
3. Add an entry for it to
   [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)
   (`"source": "./community/<your-id>"`, the same `description` as your
   `plugin.json`).
4. Run `node scripts/check.mjs` locally and paste the output into the PR.
5. Include a short **real usage record** in the PR: the task where the agent
   used the skill, what the process looked like, and how it went. Show the
   process, not only the final result.

Full rules: [CONTRIBUTING.md](../CONTRIBUTING.md).

## Stacks

| Stack | Author | What it covers |
| --- | --- | --- |
| *None yet.* | | |

# Team stacks

Each directory here is one MiniMax Code team member's stack: the workflows
and skills they actually use to build MiniMax Code. Each stack is also a
MiniMax Code plugin package.

| Stack | Owner | What it has |
| --- | --- | --- |
| [`ronny`](ronny/) | Ronny, R&D lead | Skills and plain-text checklists |
| [`jiachen`](jiachen/) | Jiachen, engineer | Skills and a `WORKFLOW.md` |

Teammates are welcome to add their own; see below.

## Adding a team stack

1. Pick an id: lowercase letters, digits and hyphens. It becomes both the
   directory name and the plugin `name`.
2. Copy the template: `cp -R templates/stack-template stacks/<id>`.
3. Edit `.minimax-plugin/plugin.json`, write your skills and `WORKFLOW.md`.
4. Add a row to the table above, and an entry to
   [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)
   (`"source": "./stacks/<id>"`, the same `description` as `plugin.json`).
5. Run `node scripts/check.mjs` and open a PR.

When you change a stack later, raise its `version` in the same PR; see
[CONTRIBUTING.md](../CONTRIBUTING.md#changing-a-stack).

Keep it public-safe: no internal hostnames, links, project codenames,
internal metrics, credentials or customer data. Skills must work for someone
outside the team.

Stacks from outside the team go in [`community/`](../community/). Pull
requests are accepted only from repository collaborators. If you are not a
collaborator, open an issue first. See [CONTRIBUTING.md](../CONTRIBUTING.md).

# Team stacks

Each directory here is one MiniMax Code team member's stack: the workflows
and skills they actually use to build MiniMax Code. Each stack is also a
MiniMax Code plugin package.

| Stack | Owner | Status |
| --- | --- | --- |
| [`ronny`](ronny/) | Ronny, R&D lead | 15 skills, 5 checklists |
| [`jiachen`](jiachen/) | Jiachen, engineer | 2 skills |

More team members' stacks are on the way.

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

External contributors: please use [`community/`](../community/) instead.

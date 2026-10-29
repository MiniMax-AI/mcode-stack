# Contributing to MCode Stack

[中文](CONTRIBUTING_ZH.md)

Issues and discussion are welcome. For now, pull requests for code,
documentation, and stacks are accepted only from repository collaborators.
If you are not a collaborator, [open an issue](https://github.com/MiniMax-AI/mcode-stack/issues/new/choose)
to discuss first.

The steps below are for collaborators who add or change a stack.

## What we accept

- **A stack = one person's or one team's real daily practice**: a
  `WORKFLOW.md` plus at least one skill or checklist.
- **Not accepted**: pure prompt collections, "ideal" processes nobody runs,
  and anything tied to a private system that others cannot run.
- Collaborators can also improve an existing skill. Explain what went wrong
  without the change.

## How to submit a stack

Collaborators follow every step. If you are not a collaborator, do step 1
only.

1. **Open a "New stack" issue first.** In a few sentences: who you are, how
   you use agents, and which pieces you plan to include.
2. **Copy the template** to `community/<id>/`. The `id` uses only lowercase
   letters, digits and hyphens, and must equal the `name` in
   `.minimax-plugin/plugin.json`.
3. **List it in the marketplace**: add an entry to
   `.claude-plugin/marketplace.json` with `"name"` equal to the id,
   `"source": "./community/<id>"` and the same `description` as your
   `plugin.json`. Do not add `skills` or other component fields; your
   `plugin.json` defines them.
4. **Run the checks locally** and paste the output into the PR:

   ```bash
   node scripts/check.mjs
   # optional: also run the official MiniMax Code plugin validator
   git clone --depth 1 https://github.com/MiniMax-AI/minimax-code.git ../minimax-code
   MINIMAX_CODE_DIR=../minimax-code node scripts/check.mjs
   ```

5. **Include a real usage record** in the PR: the task where the agent used
   the skill, what the process looked like, and how it turned out. Show the
   process, not just the final result.

## Changing a stack

Whenever a PR changes anything inside a stack, raise `version` in its
`.minimax-plugin/plugin.json` (for example `0.2.0` to `0.2.1`). People who
installed the stack from the marketplace only get the update when the version
goes up, so CI fails a change without a bump. When the stack also has
`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or a root
`plugin.json`, keep the same `name`, `version`, `description`, and author name
in those files. Run the same check locally with
`CHECK_BASE=origin/main node scripts/check.mjs`.

## How we review

At least one maintainer reviews each PR, looking at three things:

- **Does it run?** Checks pass; after installing, it shows up in `/skills` in
  MiniMax Code; the agent loads it correctly from its `description`.
- **Is it really used?** The usage record shows the process, not only a
  conclusion. We hold ourselves to the same rule: look at how the agent got
  the result, not just the result.
- **Safety and boundaries.** No keys, tokens or internal addresses; scripts do
  nothing beyond what they describe; third-party content is credited with its
  license.

We will usually ask one question: *"If you deleted this skill, where would
your agent go wrong?"* If there is no clear answer, we may suggest merging it
into an existing skill.

## After it is merged

- The author maintains their stack under `community/`. Later changes are
  pull requests from collaborators.
- Stacks that go unmaintained or stop matching current MiniMax Code may be
  marked and later moved to an archive area.
- Stacks that are well written and widely used may be featured in the
  Engineering Notes or other official channels.

## Writing a good skill

- Frontmatter: `name` equal to the directory name, and a one-line
  `description` saying what it does and **when** to use it. Quote the value
  if it contains `: `.
- Steps the agent can actually execute, in order, with how to verify each one.
- Ask for evidence (files, commands, real output). Never let the skill invent
  numbers.
- Say what the output should look like.

## License and conduct

By submitting, you agree that your contribution is released under this
repository's [MIT License](LICENSE). Third-party material keeps its own
license: credit it and note the license in your stack's `NOTICE.md`. Be respectful and constructive in
issues and reviews.

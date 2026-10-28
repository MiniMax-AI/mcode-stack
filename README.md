# MCode Stack

[中文](README_ZH.md)

**The workflows and skills the MiniMax Code team uses to build MiniMax Code. Open source, install and use.**

This is not a prompt collection or a list of "best practices". It is what
people on the team actually use every day: how to keep AI-written code at a
high bar, how to decide whether a task should go to a subagent, how long to
wait on a long command, how to keep long sessions from going dull, and what
goes into context on every turn. Everything here installs straight into
[MiniMax Code](https://github.com/MiniMax-AI/minimax-code).

## Why

AI writes code faster every month. What separates results now is the layer
of engineering habits around the agent: when to make it stop and check its
own work, who reviews, where state lives, what counts as a real experiment.
Those habits are hard to follow from an article, so we turned them into
skills and checklists. They pair one to one with our *MCode Engineering
Notes* column: the article explains the idea, this repository makes it
runnable.

We also believe harness engineering is a craft that moves forward by
experiment. Everything here will keep changing as we learn. Take it, change
it, and send your version back.

## What's inside

```text
stacks/ronny/               Ronny's stack (MiniMax Code R&D lead), the first and most complete one
stacks/<name>/              Other team members' stacks (on the way)
notes/                      Which runnable piece goes with each Engineering Notes article
community/                  Stacks contributed by developers outside the team
templates/stack-template/   Start here to write your own stack
```

A stack usually has three kinds of things:

| Kind | What it is | How to use it |
| --- | --- | --- |
| Skill | A directory with a `SKILL.md` | Invoke it in MiniMax Code with `/<skill-name>`, or let the agent load it from its description |
| Checklist | Also a skill: the agent walks your project item by item. A plain-text copy lives in `checklists/` | Same as above, or just read it |
| Workflow | A `WORKFLOW.md` describing how this person works with MiniMax Code every day | Read it |

### First batch in `stacks/ronny`

| Skill | What it does | Notes |
| --- | --- | --- |
| `independent-review` | Review a diff from a clean context: only diff, requirement and test results | 01 |
| `subagent-split-check` | Decide whether work goes to a subagent or stays in the main loop | 01 |
| `harness-experiment` | Small eval, one change at a time, repeated runs, look at flipped tasks | 01, 02, 06 |
| `tool-budget-audit` | Measure what tools cost in context; trim, tool search or programmatic tool calling | 02 |
| `long-session-check` | Drop, summarize or write to file; compact or start fresh; memory scoping | 03 |
| `handoff-doc` | A hand-off doc so a new session can pick up the work | 01, 03 |
| `long-command-check` | Ten-point audit of long shell commands and background tasks | 04 |
| `context-tax-audit` | What gets injected into every request, and what it does to the prompt cache | 06 |
| `trajectory-review` | Look at how the agent got its result, not only whether it passed | - |

## Install

Clone the repository first:

```bash
git clone https://github.com/MiniMax-AI/mcode-stack.git ~/mcode-stack
```

### Install a single skill

MiniMax Code discovers skills in these directories (one subdirectory per
skill, containing `SKILL.md`):

- For the current project only: `.minimax/skills/`, `.claude/skills/` or
  `.agents/skills/` in the project
- For all projects: `~/.agents/skills/` (`~/.claude/skills/` and
  `~/.codex/skills/` are read too)

For example, to install the long-command checklist globally:

```bash
mkdir -p ~/.agents/skills
cp -R ~/mcode-stack/stacks/ronny/skills/long-command-check ~/.agents/skills/
```

Open a new session and type `/skills` in MiniMax Code to see it.

The skills use the common `SKILL.md` format, so most of them also work in
other agents that support skills.

### Install a whole stack as a plugin

Every stack is also a MiniMax Code plugin package. Find your local plugin
directory:

```bash
mcode plugin marketplace list
```

Copy the whole `stacks/ronny` directory into that directory, then open
`/plugins` in MiniMax Code and press `Ctrl+R` to refresh. A local plugin is
installed as soon as it is in that directory; press Space in the panel to
enable or disable it.

`mcode plugin add` installs from the official catalog only; it does not take
a GitHub URL or a local path.

## Contribute your own stack

What we most want to see is how you actually work with MiniMax Code, or with
any other agent, day to day.

1. Copy `templates/stack-template/` to `community/<your-id>/`.
2. Write a `WORKFLOW.md`: how you use the agent every day, what you hand to it
   and what you keep an eye on yourself.
3. Add at least one skill or checklist you really use.
4. Run `node scripts/check.mjs`, then open a PR with the output and a short
   record of real usage.

Details in [CONTRIBUTING.md](CONTRIBUTING.md). Using something from here in
your own agent? Tell us with an **I use this** issue.

## Relationship to MiniMax Code

MiniMax Code itself lives in
[MiniMax-AI/minimax-code](https://github.com/MiniMax-AI/minimax-code). This
repository only holds workflows and skills, no MiniMax Code source code.

## License

[MIT](LICENSE)

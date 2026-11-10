---
name: pr-description
description: Draft or check a pull request description in a fixed format (background, changes, behavior changes, out of scope, verification, rollback, not done, related) for GitHub or GitLab. Use when opening a PR, when the MCode Review summary reports missing description sections, or when the user asks for a PR description.
---

# PR description

On GitLab a PR is a merge request; the format is the same on both hosts.

Write the description in the user's language, or in the output language a prompt names. A PR opened through a CLI or an API does not get the repository's PR template, so write every section yourself. When the repository has a template (`.github/pull_request_template.md` on GitHub, `.gitlab/merge_request_templates/` on GitLab), keep its headings and checklists and fit the sections below into it.

## When it is required

MCode Review asks for the verification and rollback sections on L and XL PRs and on PRs that touch risk paths. Write all sections for every PR anyway; they cost little and answer the reviewer's first questions.

## Template

```markdown
## Background
<the problem, who hits it, how it shows up; link the ticket or discussion>

## Changes
<what changed, by mechanism, not by file list>

Behavior changes:
- <each user-visible or caller-visible change; write "None" when there is none>

## Out of scope
- <things a reviewer might expect but this PR leaves alone, and why>

## Verification
- <the test that failed before the fix and passes after it, with its name>
- <commands run and their result>

## Rollback
<how to revert, and what happens to data, config or clients written by the new version>

## Not done
- <checks not done, such as manual testing on a platform>

## Related
- <related PRs and how they interact>
```

In Chinese, keep the same sections in the same order with these headings: 背景, 改动 (with 行为变化：, and 无 when there is none), 明确不改的, 验证, 回滚方式, 未执行, 关联.

## Rules

1. Every claim must be checkable. Write "behavior unchanged" (行为不变) only after checking it, and say how.
2. List deployment prerequisites (DDL, config center changes, publish steps) under Changes and name who runs them.
3. Put UI changes' before/after screenshots or recordings under Verification.
4. Keep Not done honest; the reviewer treats missing checks as open questions, not as failures.

## Checking a description

Read the PR's diff as well as its description, then report each missing or empty section, each claim the diff does not support, each behavior change in the diff that the description leaves out, and a missing rollback plan for changes to stored data or config. Suggest the missing text; leave sections that are fine alone.

## Posting

Show the text first, and post it only when the user asks. Write it to a file, then:

- GitHub: `gh pr create --title "<title>" --body-file <file>` for a new PR, `gh pr edit <n> --body-file <file>` for an existing one.
- GitLab: `glab mr create --title "<title>" --description-file <file>`, or `glab mr update <n> --description-file <file>`. Older `glab` versions without `--description-file` take `--description "$(cat <file>)"`.

Do not change a PR's title, labels, reviewers or target branch unless the user asks.

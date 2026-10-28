---
name: engineering-small-prs
description: 'Use when planning, splitting, shrinking, or sequencing large features, refactors, migrations, or pull requests into small reviewable PRs or CLs. TRIGGER on "split this PR", "this diff is too large", "stacked PRs", "change sequence", "reviewable chunks", "migration plan", "how should I break this up?", or implementation scope too broad for one review. DO NOT TRIGGER for full code review, PR description writing, or tiny one-file edits that already form one self-contained change.'
---

# Engineering Small PRs

Small PRs are easier to review thoroughly, safer to merge, easier to roll back, and less likely to waste work if the direction changes. "Small" means conceptually focused and self-contained, not merely a low line count.

Adapted from Google Engineering Practices Documentation, especially "Small CLs." Source: <https://google.github.io/eng-practices/review/developer/small-cls.html>. License: CC-BY 3.0.

## Definition of a Good Small PR

A good PR:

- Makes one self-contained change.
- Includes the tests needed to validate that change.
- Leaves the system working after merge.
- Gives reviewers enough context in the PR, description, existing code, or earlier reviewed PRs.
- Is not so tiny that the behavior cannot be understood. A new API usually needs at least one usage in the same PR.
- Separates large refactors from behavior changes unless the cleanup is very local.

Reviewers may reasonably reject a PR solely because it is too large to review well.

## Splitting Workflow

1. Name the final outcome in one sentence.
2. List independent behavior changes, refactors, schema/config changes, tests, and docs.
3. Identify dependencies that must land earlier.
4. Choose split strategies from the section below.
5. Build a merge sequence where every PR keeps the build green.
6. Add context notes so reviewers understand how each PR fits into the larger work.
7. For risky or unavoidable large changes, get reviewer consent before sending the PR.

## Split Strategies

- Preparatory tests first: add missing tests around existing behavior before risky refactors.
- Refactor first: move, rename, extract, or simplify code without changing behavior.
- Vertical slices: deliver one small user-visible or API-visible behavior end-to-end.
- Horizontal slices: add shared interfaces, protocol definitions, or adapters only when paired with a real first usage in the same PR or a clearly linked dependent PR already under review.
- File or owner groups: split files by reviewer expertise when the changes are otherwise self-contained.
- Config separately: keep rollout configuration, experiments, or deployment wiring separate from code when rollback timing differs.
- Generated or mechanical changes separately: isolate trusted automated rewrites from hand-written logic.
- Deletions separately when useful: removing dead code can be a compact, easy-to-review PR.

## Migration Safety

For schema, data, API, or infrastructure migrations, prefer an expand/contract sequence:

1. Expand: add backward-compatible schema/API/config support without removing old behavior.
2. Dual path: write or read both paths only when needed, with observability for divergence.
3. Backfill: migrate existing data with progress tracking, retry behavior, and validation.
4. Cut over: switch traffic or callers after validation proves both paths are safe.
5. Contract: remove old schema, code paths, flags, and compatibility shims in a cleanup PR.

Each migration PR should state deployment order, rollback behavior, validation signal, and what must not happen until the next PR lands.

## Output Template

```markdown
## Goal
[Final outcome]

## Proposed PR Sequence
| # | PR | Purpose | Depends On | Tests | Reviewer Notes |
|---|----|---------|------------|-------|----------------|
| 1 | Add characterization tests for ... | Protect existing behavior before refactor | None | ... | ... |
| 2 | Extract ... without behavior change | Prepare smaller implementation | 1 | ... | ... |
| 3 | Implement ... vertical slice | User-visible behavior | 2 | ... | ... |

## Migration Safety
- Expand/contract phase:
- Backfill/validation:
- Observability:
- Rollback:

## Build Safety
- Each PR keeps:
- Rollback notes:

## Large-Change Risk
- What could not be split:
- Reviewer consent needed:
```

## Heuristics

- Prefer a PR that is smaller than you think necessary; reviewers rarely object to focused changes.
- If a PR spreads a small logical change across many files, treat it as larger than the line count suggests.
- If the reviewer needs substantial future context to understand the PR, the sequence is probably missing an earlier preparatory PR or a better description.
- If you cannot split the PR, make it extra easy to review: stronger tests, clearer description, explicit risk, and prior reviewer agreement.

## Common Mistakes

- Mixing broad formatting changes with functional logic.
- Landing a new abstraction with no real usage.
- Creating a stacked sequence where intermediate PRs break the build.
- Hiding risky behavior change inside a "refactor" PR.
- Waiting for one PR to merge before starting the next when a safe stacked workflow is available.

---

*Also published in [agentara/skills](https://github.com/agentara/skills/tree/main/skills/engineering) (MIT, Copyright (c) 2026 agentara) by the same author. The content is adapted from Google Engineering Practices under CC-BY 3.0; see the source note above. Full notices: [`NOTICE.md`](../../NOTICE.md).*

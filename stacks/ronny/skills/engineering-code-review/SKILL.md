---
name: engineering-code-review
description: 'Use when reviewing code, pull requests, patches, CLs, diffs, or proposed implementations for engineering quality, code health, design, functionality, tests, maintainability, specialist risk, or approval risk. TRIGGER on "review this PR", "code review", "LGTM?", "approve?", "is this code/diff/change safe to merge/deploy?", and local diff reviews. DO NOT TRIGGER for PR descriptions, PR splitting, author review-feedback responses, or non-code safety questions unless code review is requested.'
---

# Engineering Code Review

Use code review to protect and improve long-term code health while still allowing useful changes to land. The standard is not perfection; the standard is that the change improves the system overall and does not introduce unacceptable risk.

Adapted from Google Engineering Practices Documentation, especially the code review overview, reviewer guide, standard of review, navigation, speed, small changes, and emergency guidance. Sources: <https://google.github.io/eng-practices/>, <https://google.github.io/eng-practices/review/reviewer/standard.html>, <https://google.github.io/eng-practices/review/reviewer/navigate.html>, <https://google.github.io/eng-practices/review/reviewer/speed.html>, <https://google.github.io/eng-practices/review/developer/small-cls.html>, and <https://google.github.io/eng-practices/review/emergencies.html>. License: CC-BY 3.0.

## Review Standard

- Favor approval when the change definitely improves the code health of the touched system, even if it is not perfect.
- Do not approve changes that make the system worse unless this is a true emergency and the follow-up cleanup is explicit.
- Prefer technical facts, data, existing project standards, and durable design principles over taste.
- Treat style guides and automated formatters as authorities. Personal style preferences are nits.
- If several designs are defensible, accept the author's preference unless it harms code health.
- Ask for another qualified reviewer when the change touches specialized areas such as security, privacy, concurrency, accessibility, internationalization, infrastructure, data migration, or domain logic you cannot validate.

## Review Workflow

1. Establish scope.
   - Identify the diff, requested review scope, target branch, and whether you are doing a full or partial review.
   - If partial, state exactly which files, behaviors, or concerns you reviewed.

2. Gather review material.
   - For a GitHub PR, inspect the PR description, linked issue/design docs, changed files, existing review comments, CI status, and relevant commit history before commenting.
   - For a local review, inspect `git status --short`, the target branch or base SHA when known, and the local diff.
   - If there is no visible diff or PR context, ask for it instead of inventing a review.

3. Take the broad view first.
   - Read the description, issue, tests, and surrounding context.
   - Decide whether the change should exist in this codebase now.
   - If the direction is wrong, say so early and suggest the better path.
   - If the change is too large to review thoroughly, request a split or a reviewer-approved large-change plan before attempting a shallow full review.

4. Review the main design before details.
   - Find the core files or APIs that define the change.
   - Review architecture, ownership boundaries, data flow, compatibility, and rollback risk before naming or formatting comments.
   - Send major design concerns immediately if they invalidate the rest of the review.

5. Review every human-written line in your assigned scope.
   - Generated files, large data files, or mechanical output can be sampled when appropriate.
   - If code is too hard to understand, request simplification or clearer structure before approval.

6. Check the change against the review checklist below.

7. Check verification evidence.
   - Prefer existing CI and targeted tests when the user did not ask you to run commands.
   - Run local tests only when the environment and request make that appropriate; otherwise state which tests are missing or unverified.
   - Do not claim tests passed unless you saw the command output or CI result.

8. Make a verdict.
   - `APPROVE`: code health improves and remaining comments are non-blocking.
   - `APPROVE_WITH_COMMENTS`: remaining comments are minor, optional, or the author can be trusted to handle them without another review round.
   - `REQUEST_CHANGES`: correctness, design, maintainability, test, documentation, or risk issues remain.
   - `NEEDS_SPECIALIST`: another reviewer must cover a domain you cannot responsibly assess.

## Review Checklist

- Design: Does the change belong here? Is the abstraction appropriate for the current system?
- Functionality: Does it do what the author intends, and is that behavior good for users and future developers?
- Edge cases: Are failures, empty states, retries, idempotency, ordering, time, permissions, and concurrency considered?
- Complexity: Is it understandable quickly? Is it solving today's known problem rather than a speculative future one?
- Tests: Are unit, integration, or end-to-end tests appropriate for the risk? Would the tests fail if the code were broken?
- Test quality: Are assertions meaningful, focused, deterministic, and maintainable?
- Naming: Do names communicate purpose without being vague or noisy?
- Comments: Do comments explain why, constraints, or non-obvious algorithms instead of restating the code?
- Documentation: Are READMEs, API docs, migration notes, runbooks, or generated docs updated when behavior or usage changes?
- Style and consistency: Does the change follow project conventions without mixing unrelated formatting churn into functional work?
- Context: Does the change improve the system around it, or does it add another small piece of long-term complexity?
- Operations: Are deployment, migration, observability, rollback, feature flags, and failure handling adequate for the change?
- Security: Are authorization, authentication, secrets, injection, dependency, deserialization, and privilege-boundary risks handled?
- Privacy: Does the change avoid unnecessary collection, logging, exposure, retention, or cross-boundary movement of sensitive data?
- Accessibility: For user interfaces, are keyboard access, semantics, focus, contrast, labels, and assistive-technology behavior preserved?
- Internationalization: Are locale, timezone, encoding, text expansion, pluralization, sorting, and translated strings handled where relevant?

Escalate to a specialist when you cannot confidently assess security, privacy, accessibility, internationalization, concurrency, infrastructure, data migration, or domain-specific correctness.

## Comment Severity

- `BLOCKER`: must be fixed before approval.
- `IMPORTANT`: should be fixed before approval unless there is a written rationale.
- `QUESTION`: answer needed before final verdict.
- `NIT`: polish that must not block approval.
- `OPTIONAL`: suggestion the author may decline.
- `FYI`: learning or future consideration, not a requested change.

## Output Format

Lead with findings, highest severity first. Use file and line references when available.

```markdown
## Findings
- [BLOCKER] path/file.ext:123 - Problem. Why it matters. Required change.
- [IMPORTANT] path/file.ext:45 - Problem. Why it matters. Suggested fix.

## Open Questions
- ...

## Verdict
REQUEST_CHANGES | APPROVE_WITH_COMMENTS | APPROVE | NEEDS_SPECIALIST

## Notes
- Scope reviewed:
- Tests/commands checked:
- Follow-ups:
```

If no issues are found, say that clearly and still mention any unverified scope or residual risk.

## Common Mistakes

- Blocking approval on preference rather than code health.
- Reviewing only the changed lines when the surrounding function or module makes the change unsafe.
- Accepting complex code because the author explained it only in the review thread.
- Letting "clean it up later" pass when the change itself introduces the complexity.
- Requesting large rewrites late instead of flagging design problems early.
- Delaying the author when a quick broad response would unblock useful work.

---

*Also published in [agentara/skills](https://github.com/agentara/skills/tree/main/skills/engineering) (MIT, Copyright (c) 2026 agentara) by the same author. The content is adapted from Google Engineering Practices under CC-BY 3.0; see the source note above. Full notices: [`NOTICE.md`](../../NOTICE.md).*

---
name: engineering-review-feedback
description: 'Use when handling code review feedback as the change author, addressing reviewer comments, drafting replies, resolving disagreements, or summarizing updates. TRIGGER on "address review feedback", "respond to this review comment", "reviewer asked", "I disagree with reviewer", "what should I reply?", or "apply PR comments". If role is unclear, ask reviewer or author. DO NOT TRIGGER for reviewer comment writing, full code review, or PR descriptions unless author-response behavior is requested.'
---

# Engineering Review Feedback

Handle reviewer feedback as collaboration toward better code. The best response often changes the code, tests, or comments so future readers benefit, rather than explaining only inside the review thread.

Adapted from Google Engineering Practices Documentation, especially "How to handle reviewer comments." Source: <https://google.github.io/eng-practices/review/developer/handling-comments.html>. License: CC-BY 3.0.

## Response Workflow

1. Pause before responding if the comment feels frustrating.
2. Identify what the reviewer is asking for.
3. Classify each comment:
   - Code change required.
   - Test change required.
   - Documentation or comment change required.
   - Clarification needed.
   - Disagreement to discuss.
   - Non-blocking suggestion.
4. Prefer improving the artifact over explaining in the review tool.
5. Run the relevant verification.
6. Reply with what changed, why, and how it was tested.

If a reviewer says they do not understand the code, first try to make the code clearer. Add a code comment only when the why cannot be expressed cleanly in code.

## When You Agree

Use a short response and make the change.

```text
Done. I renamed the helper to describe normalization rather than validation and updated the two call sites.

Tested with: npm test -- user-profile.test.ts
```

## When You Need Clarification

Ask for the missing decision or constraint. Avoid defensive wording.

```text
I want to make sure I understand the concern. Are you asking for this to reject duplicate requests at the API boundary, or for the worker to make duplicate processing idempotent?
```

## When You Disagree

Disagree by comparing tradeoffs, not by rejecting the person.

```text
I chose X because it keeps the retry policy in one place and avoids a second queue state. My concern with Y is that it makes cancellation observable in two different layers.

If you think Y better serves the rollback requirement, I can switch to it. Is that the tradeoff you want prioritized?
```

If the reviewer provides better technical reasoning, accept it and adjust. If neither side can converge, move to a higher-bandwidth conversation and summarize the decision back in the review.

## When Feedback Is Not Constructive

Do not reply in kind. Extract any technical concern that can be addressed in code, tests, or docs. If the comment is hostile, vague, or repeatedly unproductive, move to a private or higher-bandwidth conversation, involve a lead when needed, and summarize only the technical decision back in the review.

## Fix the Right Place

- Confusing expression: simplify or rename it.
- Hidden invariant: encode it in types, validation, assertions, or a focused comment.
- Missing behavior confidence: add or improve tests.
- Missing context: update the PR description, code comment, README, or design doc.
- Reviewer misunderstanding caused by stale diff: rebase, remove dead code, or update the description.
- Pure preference: ask whether it is required; otherwise treat as optional.

## Summary Reply Template

```markdown
Addressed this round:
- Changed ...
- Added/updated tests for ...
- Clarified ...

Verification:
- `...`

Open:
- ...
```

## Common Mistakes

- Replying in anger or with sarcasm.
- Explaining confusing code only in the review thread.
- Treating every reviewer suggestion as mandatory without clarifying severity.
- Saying "will clean up later" when the current change introduces the complexity.
- Making broad unrelated refactors while addressing a narrow review comment.

---

*Also published in [agentara/skills](https://github.com/agentara/skills/tree/main/skills/engineering) (MIT, Copyright (c) 2026 agentara) by the same author. The content is adapted from Google Engineering Practices under CC-BY 3.0; see the source note above. Full notices: [`NOTICE.md`](../../NOTICE.md).*

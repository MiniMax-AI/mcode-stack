---
name: engineering-review-comments
description: 'Use when drafting, rewriting, classifying, or improving code review comments as a reviewer. TRIGGER on rough review notes, requests to make comments clearer or kinder, severity labels, "how should I phrase this review comment?", "write review comments", author pushback, or turning findings into PR comments. If role is unclear, ask reviewer or author. DO NOT TRIGGER for full code review, PR descriptions, or author responses unless wording is requested.'
---

# Engineering Review Comments

Review comments should improve the code and the developer's future judgment. They should be clear about severity, grounded in engineering reasoning, and directed at the code rather than the person.

Adapted from Google Engineering Practices Documentation, especially "How to write code review comments" and "Handling pushback in code reviews." Source: <https://google.github.io/eng-practices/review/reviewer/comments.html>. License: CC-BY 3.0.

## Comment Shape

Use this structure for non-trivial comments:

```text
SEVERITY: Observation about the code.

Why this matters: engineering reason, user impact, maintainability impact, or violated project rule.

Requested action: concrete fix, question, or decision the author needs to make.
```

Keep tiny comments tiny. Use the full shape when intent could be misunderstood.

## Severity Labels

- `BLOCKER`: must change before approval because correctness, maintainability, security, data, test, or operational risk is unacceptable.
- `IMPORTANT`: should change before approval; can be waived only with an explicit rationale.
- `QUESTION`: reviewer needs information before deciding.
- `NIT`: minor polish. Do not block approval.
- `OPTIONAL` or `CONSIDER`: a suggestion the author can decline.
- `FYI`: educational context or future consideration; no action expected.

## Writing Rules

- Comment on the code, design, tests, or behavior; do not characterize the author.
- Explain why when asking for anything beyond obvious style or mechanical cleanup.
- Prefer "this makes X harder because..." over "I don't like X."
- Ask for simpler code when a review-thread explanation is needed to understand ordinary behavior.
- Accept a code comment only when the code cannot reasonably express the why by itself.
- Provide direct code or a specific design only when it is faster or safer than making the author infer it.
- Otherwise describe the problem and let the author choose the implementation.
- Point out good engineering choices when useful, and say why they are good.

## Wording Patterns

Use these patterns directly when helpful:

```text
BLOCKER: This path can return success before the write is durable.

If the process crashes after this point, callers will believe the operation completed even though the data may be missing. Please either move the success response after the durable write or make the operation explicitly asynchronous and observable.
```

```text
QUESTION: What guarantees that this callback cannot run concurrently?

If it can run in parallel, `pending` can be decremented twice from the same value. If the framework serializes this callback, please add a short comment at the boundary where that guarantee comes from.
```

```text
NIT: This helper name reads as if it validates the payload, but it only normalizes whitespace. Could we rename it to `normalizePayloadText`?
```

```text
OPTIONAL: Consider extracting this branch into a named helper. The current version is correct, but a helper would make the three policy cases easier to scan.
```

## Handling Pushback

When the author disagrees:

1. Re-evaluate their argument first. They may be closer to the code or have context you missed.
2. If they are right, say so plainly and resolve the comment.
3. If you still disagree, restate their point, then explain the code-health reason for your request.
4. Distinguish mandatory requests from preferences.
5. If the thread stops making progress, move to a higher-bandwidth discussion and summarize the decision back in the review.

Do not keep arguing because you wrote the first comment. The goal is the best code, not defending the initial wording.

## Common Mistakes

- Leaving unlabeled comments that authors interpret as mandatory.
- Writing a correct critique in a tone that makes collaboration harder.
- Asking the author to explain confusing code only in the review tool.
- Turning every comment into a complete design assignment.
- Treating educational notes as blockers.

---

*Also published in [agentara/skills](https://github.com/agentara/skills/tree/main/skills/engineering) (MIT, Copyright (c) 2026 agentara) by the same author. The content is adapted from Google Engineering Practices under CC-BY 3.0; see the source note above. Full notices: [`NOTICE.md`](../../NOTICE.md).*

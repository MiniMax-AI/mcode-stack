---
name: engineering-emergency-changes
description: 'Use when a code hotfix, rollback alternative, production/security/legal fix, launch blocker, or hard external deadline claims expedited review or relaxed process. TRIGGER on "emergency change", "hotfix", "prod incident", "major security hole", "must ship today", "hard deadline", "bypass review", or "fast-track this PR" for qualification only. DO NOT TRIGGER for ordinary urgency, soft deadlines, Friday timing, manager pressure, time-zone delay, or review unless emergency status is disputed.'
---

# Engineering Emergency Changes

Emergency review is for rare cases where speed of the entire change matters more than normal review depth. It does not mean "skip engineering judgment"; it means narrow the change, verify the emergency, prioritize correctness, and schedule follow-up review.

Adapted from Google Engineering Practices Documentation, especially "Emergencies" and the reviewer speed guidance. Source: <https://google.github.io/eng-practices/review/emergencies.html>. License: CC-BY 3.0.

## Emergency Gate

Treat a change as an emergency only when it is a small targeted change and at least one condition is true:

- It prevents a major launch from failing when rollback is not the right option.
- It fixes a bug that is significantly affecting production users.
- It addresses a pressing legal or compliance issue.
- It closes a major security vulnerability.
- It satisfies a hard external deadline where missing it would cause contractual, legal, security, production-user, or clearly disastrous launch harm.

These are usually not emergencies by themselves:

- Wanting to launch sooner.
- A feature has taken a long time and the author wants it merged.
- Reviewers are asleep, away, or in another time zone.
- It is late Friday.
- A manager wants it done today for a soft deadline.
- The team wants to avoid normal review discomfort.

Most deadlines are soft. Do not sacrifice code health for a soft deadline.

## Emergency Workflow

1. State the emergency claim in one sentence.
2. Decide whether it passes the emergency gate.
3. Shrink the change to the minimum fix.
4. Confirm the change directly addresses the emergency.
5. Review for correctness, blast radius, rollback, and obvious safety issues first.
6. Run the fastest meaningful verification available.
7. Record skipped normal checks and why they were skipped.
8. Merge or release only if the emergency risk is greater than the code risk.
9. After the emergency is resolved, perform a normal-depth follow-up review.
10. File cleanup, tests, documentation, and postmortem tasks immediately so they are not lost.

## Emergency Review Checklist

- Scope: Is this the smallest change that resolves the urgent condition?
- Correctness: Does it actually fix the production, security, legal, or launch issue?
- Containment: Can it be rolled back or disabled quickly?
- Tests: What automated or manual check gives the most confidence right now?
- Observability: How will the team know whether the fix worked?
- Side effects: What users, data, jobs, APIs, or deployments can be harmed?
- Follow-up: What normal review items, tests, docs, or cleanup must happen after?

## Output Template

```markdown
## Emergency Decision
QUALIFIES | DOES_NOT_QUALIFY | NEEDS_MORE_INFO

## Reason
[Concrete reason tied to production user impact, security, legal/compliance, major launch, or hard external deadline.]

## Minimum Safe Change
- ...

## Immediate Verification
- ...

## Release / Rollback Notes
- ...

## Follow-up Required
- Normal-depth review:
- Tests:
- Cleanup:
- Documentation:
- Owner:
```

## Common Mistakes

- Treating urgency as an emergency.
- Expanding the hotfix to include nearby cleanup.
- Skipping all review instead of changing the review focus.
- Forgetting to perform a normal review after the incident is resolved.
- Letting emergency exceptions become the team's normal release process.

---

*Also published in [agentara/skills](https://github.com/agentara/skills/tree/main/skills/engineering) (MIT, Copyright (c) 2026 agentara) by the same author. The content is adapted from Google Engineering Practices under CC-BY 3.0; see the source note above. Full notices: [`NOTICE.md`](../../NOTICE.md).*

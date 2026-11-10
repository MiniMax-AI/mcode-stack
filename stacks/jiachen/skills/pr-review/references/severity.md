# Severity

Severity says how bad the problem is. Whether a finding can block is decided by evidence (see evidence-ladder.md), not by the model's confidence.

| Severity | Definition | Examples |
|---|---|---|
| P0 | Data loss or corruption, security hole, crash or startup failure, irreversible migration error, widespread 5xx, billing error. Use P0 only when the problem holds without assumptions about the input. | A background worker reused the request's context after the request ended; the context was cancelled, the worker panicked, and its recover handler crashed the process. A delete endpoint took the owner id from the request body, so any user could delete another user's files. |
| P1 | User-visible regression on a main path, broken contract with another component, error or retry semantics changed so that work hangs, existing capability removed without replacement. | A notification call was changed to `await` to satisfy a lint rule, so saving a form waited for the email provider to answer. After a model was removed from the catalog, every scheduled job that named it failed instead of falling back to the default. A default flag silently changed from true to false, against the design record. |
| P2 | Edge-case bug, maintainability risk with a concrete failure path, a fix without a regression test where a testable seam exists. | A handler loaded every row of a table and then ignored the result. A flex child without `min-w-0` let a long project name push the dialog out of the sidebar. |
| P3 | Style and naming. | Do not report. |

Rules:
- Main path versus edge case: when a whole class of valid inputs fails (every plugin of one kind, every request through one entry point, every user on one platform), that is a main-path regression for that feature, so P1. An edge case is an unusual value of an input that otherwise works: empty, huge, concurrent, malformed.
- A problem the PR did not introduce or expose is `pre_existing`; it never blocks this PR.
- If two readings of the same problem disagree on severity, report the lower one and explain the condition for the higher one.

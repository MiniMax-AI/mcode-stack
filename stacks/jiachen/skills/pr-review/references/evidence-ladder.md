# Evidence ladder

| Level | Meaning | What it allows |
|---|---|---|
| 1 | Assertion only | Do not report. |
| 2 | A concrete file:line that shows the problem | Report as P2, or as a question in `needs_human`. |
| 3 | The failure path traced step by step through the call chain | Can block once an independent verifier confirms it. |
| 4 | A script or test run that shows the failure | Can block directly. CI review passes do not run code, so do not claim level 4 there. |
| 5 | Reproduced in a running application | Same as 4. |

Write the trace in the finding body: the input or state, each step with file:line, and the wrong result. A trace that skips a step is level 2.

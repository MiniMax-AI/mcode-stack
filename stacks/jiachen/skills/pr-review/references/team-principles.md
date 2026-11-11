# Review principles

Apply these in every lens. A concrete violation in the diff is a finding; a debatable design choice goes to `needs_human`.

1. No model special-casing. Budgets, thresholds and behavior must not branch on a model name; parameterize instead.
2. Do not block operations the user triggers by hand. Protection logic belongs on automatic paths only.
3. Fix bad values at the boundary where they are read (fill a default there) instead of adding a policy at every entry point. A fix that touches more than about 10 source files suggests the boundary is wrong: raise it in `needs_human`.
4. Fold fixes into existing mechanisms and keep them stateless: no special branch for one incident, no state carried across calls.
5. Degrade instead of throwing: on unexpected input fall back to a safe default and leave a trace. Throw only when continuing would corrupt data or weaken security.
6. A bug fix comes with a test that fails on the old code and passes on the new code. If there is no seam to test, the PR should say so.
7. Fallback safety checks only need to handle normal usage. A bypass that requires deliberate construction is documented as a threat model, not blocked.

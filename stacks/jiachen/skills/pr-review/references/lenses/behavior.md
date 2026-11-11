# Lens: behavior preservation

- Defaults and exported constants changed without the description saying so, or against an ADR.
- Optional actions that used to fail open now fail closed; "skip silently" turned into "raise"; a fallback replaced by different behavior.
- Error semantics: a transient failure consuming a permanent retry budget; streaming errors treated as success; expected outcomes (conflict, duplicate, quota exceeded, downstream NON_FATAL) mapped to fatal errors or 5xx.
- Async results written back without checking they still match the current target; ordering between two channels (for example SSE and HTTP) handled for one order only.
- Concurrency and lifecycle: locks without an owner pid, released only by exit hooks; unbounded logs or queues; terminal records never cleaned up; background work that can outlive its owner.
- Merge or back-merge PRs: dropped hunks, variables computed and never used, swallowed branches. Compare with both parents.
- Data read in full and the result ignored; large objects copied element by element.

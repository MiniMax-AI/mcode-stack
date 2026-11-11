# Lens: duplication and simplification

Occam's razor in both directions: do not duplicate what exists, and do not add abstraction nobody needs.

Check, using the duplication hints in the prompt and your own searches (`git grep`):
- The diff adds parsing, classification, validation or counting logic that the repository already implements. Name the existing implementation with path:line.
- The same diff contains two implementations of one decision (for example a capability check written twice with different fields).
- One of several parallel implementations (DOM menu and native menu, send and resume, proxy path and direct path) is changed and the others are not, with no explanation.
- A fix that repeats an earlier fix found elsewhere in the repository instead of reusing it.

Severity follows the evidence:
- Copies that already disagree and cause wrong behavior are a bug: report it with the failure path and rate it with severity.md. When the copies disagree on a whole class of valid inputs, it is P1 (example: a package list shows every plugin of one kind as installable while the installer rejects them).
- A new copy that still agrees with the existing one is P2: suggest reusing the existing implementation by path:line.
- Reuse only along allowed dependencies. Before suggesting an import, check the direction: when the existing implementation lives in a layer or module the caller must not depend on (a lower layer importing an upper one, one service importing another service's internals, see the repository's boundary rules), a local copy is acceptable. Report it only when the copies already disagree, and then suggest moving the rule down into a module both may use.
- When no implementation exists yet, do not suggest creating a shared layer for two or three similar lines.
- Report one finding per duplicated decision and list every copy in the body.

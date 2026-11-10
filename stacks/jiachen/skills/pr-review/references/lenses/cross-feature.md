# Lens: cross-feature impact

- Shared components, stores and global styles: list the other features that use what the PR changed and check at least the most used ones.
- UI changes: layout regressions are hard to see in code. If the description has no before/after screenshots or recording, raise it in `needs_human`. Check list keys, merge versus replace on refresh, controls that move, flex children without `min-w-0`, magic z-index values.
- Platform: Windows paths and file modes, Electron packaging (asar), macOS-only APIs, terminal versus desktop clients reporting the same identity.
- Background work: new workers, cron jobs, consumers or topics need an owner per lane and per environment; lanes passed from the entry point down.
- Cost, latency and data leaving the machine: a new model call, network call or heavy step on a path that fans out (every sub-agent, every retry, every message) multiplies cost and waiting time; a new outbound destination for conversation or file content is data egress. Ask in `needs_human` for the limit, the progress shown while the user waits, and whether the user is told what is sent where.
- Rolling releases: server and client versions that run side by side; feature flags and their defaults.
- Intended behavior changes: who depends on the old behavior? Ask in `needs_human` when the description does not answer it.

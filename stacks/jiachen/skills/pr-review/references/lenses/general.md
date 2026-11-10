# Lens: general (S and M tiers)

One pass over the whole diff. Cover the points below in proportion to what the diff touches.

- Behavior: does any existing behavior change without the description saying so? Defaults, exported constants, error handling, retries, fail-open paths (see behavior.md).
- Contracts and data: protocol, IDL, config keys, stored formats, migrations, old clients and servers running side by side (see contracts.md).
- Security: authentication, permissions, injection, secrets, outbound URLs (see security.md).
- Other features: shared components, global styles, platform differences, background jobs (see cross-feature.md).
- Duplication: a new implementation of something the repository already has, or one of several parallel implementations changed alone (see duplication.md).
- Tests: a fix needs a regression test; a behavior change needs its test updated.

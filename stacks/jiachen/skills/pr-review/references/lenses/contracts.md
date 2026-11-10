# Lens: contracts and data

- Protocol, IDL and API changes: can old and new clients and servers run side by side during a rolling release? Readers must upgrade before writers.
- Cross-layer conversion: JSON round trips need matching field names; `omitempty` must distinguish "absent" from "empty"; enums are not cast from numbers; accepted parameters are either passed through or rejected explicitly.
- New deny-lists or allowlists: list every source of the value, including stored values, aliases, old clients and other services' defaults. Stored values should degrade, not be rejected.
- Config: code defaults must equal current production behavior; a new field must cover every config key and region; one bad field must not discard the whole config; no hard-coded environment ids or credentials.
- Stored data and migrations: version collisions, irreversible steps, behavior when an older binary reads newer data.
- Identity fields (login epoch, source message id and similar) passed end to end; isolation keys taken only from the auth context.
- Deployment prerequisites (run DDL, change the config center) written only in the PR description: ask who runs them and how they are checked.

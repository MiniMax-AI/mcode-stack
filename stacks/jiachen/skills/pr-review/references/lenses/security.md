# Lens: security and permissions

- Authentication and authorization: every entry point covered, including optional auth and early-return branches; identities and isolation keys from the auth context only.
- Injection: shell, SQL, path traversal, template and prompt injection from untrusted input; untrusted content reaching a model with tools.
- Outbound requests: user-controlled URLs go through the SSRF-safe client; no credentials in URLs or logs.
- Secrets: no keys, tokens or internal endpoints added to code, logs, fixtures or comments.
- Permission gates: new blocking checks must not stop operations the user triggers by hand (review principle 2); a bypass that needs deliberate construction is a threat-model note, not a blocker (review principle 7).
- File system: writes outside the intended directory, permissions set after the file is opened, races between check and use.

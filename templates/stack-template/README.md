# Stack template

Copy this directory to start your own stack:

```bash
cp -R templates/stack-template community/<your-id>
```

Then:

1. Rename the plugin: set `name` in `.minimax-plugin/plugin.json` to `<your-id>`.
   It must equal the directory name (lowercase letters, digits, `.`, `_`, `-`).
2. Fill in `description`, `author` and, optionally, up to three `exampleQueries`.
3. Replace `icon.png` with your own PNG, JPEG or WebP icon if you like.
4. Rename `skills/example` and write your skills. List every skill in `skills`
   in `plugin.json`.
5. Write `WORKFLOW.md`.
6. Run `node scripts/check.mjs` from the repository root.

# Repository: example

A made-up repository that shows the format of a repository's notes. A
repository keeps its own notes in `.mcode-review.md` at its root, where CI and
local reviews both read them; a file in this directory is named after the last
segment of the repository's `origin` URL instead. List the failure patterns
that the repository's past fix PRs repaired, one per item, most costly first,
each with the place to look.

1. Session refresh runs in two places: the web client refreshes on a 401 and the
   API gateway refreshes before it forwards. A change to one must keep the
   other in step, or a user gets logged out once a day.
2. Migrations under `db/migrations/` run before the new binary starts, and the
   old binary keeps serving for a few minutes. A migration that renames or drops
   a column breaks the old binary; add the new column first and drop the old one
   in a later release.
3. The settings page saves the whole settings object. A new field without a
   default in `src/settings/defaults.ts` is written back as empty and resets
   the value for every user who opens the page.
4. Background exports in `src/jobs/export/` retry on any error. A retry after
   the upload succeeded but the status write failed sends the user two emails;
   the retry must check the stored status first.
5. Prices are stored in cents and shown in dollars. A new screen or report that
   reads the stored value directly shows a hundred times the price.

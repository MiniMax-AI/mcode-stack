# MCode Review reference

Everything about MCode Review that the [stack README](../README.md) leaves
out: how it decides, how to run it locally and in CI, every setting, the
security model and development. Paths are relative to `stacks/jiachen/`.

We say PR throughout. On GitLab a PR is a merge request.

- [How it decides](#how-it-decides)
- [Threads and rounds](#threads-and-rounds)
- [Author quiz](#author-quiz-optional)
- [Local use](#local-use)
- [CI on GitHub Actions](#ci-on-github-actions)
- [CI on GitLab](#ci-on-gitlab)
- [Configuration](#configuration)
- [Security model](#security-model)
- [Keeping it tuned](#keeping-it-tuned)
- [Development](#development)

## How it decides

1. **Tier.** prepare computes the net diff against the merge base and leaves
   out mechanical files: lock files, binaries, pure renames, files with a
   `Code generated ... DO NOT EDIT.` header and the rule pack's generated
   globs. By the remaining files and bytes and whether a risk path is touched,
   the PR is S, M, L or XL.
2. **Directions.** S and M PRs get one general pass. L and XL PRs get five
   passes in parallel: behavior preservation, contracts and data, security and
   permissions, cross-feature impact, and duplication and simplification. Each
   pass loads the `pr-review` skill with its own checklist in
   [`skills/pr-review/references/lenses/`](../skills/pr-review/references/lenses/),
   plus the stack checklist when the PR touches Go code, plus your
   repository's notes. Deterministic hints from prepare (error codes and
   function names the PR adds that already exist elsewhere) go into the
   prompt.
3. **Evidence and severity.** Each finding carries a severity (P0 to P3,
   [`severity.md`](../skills/pr-review/references/severity.md)) and an evidence
   level (1 to 5,
   [`evidence-ladder.md`](../skills/pr-review/references/evidence-ladder.md)).
   P3 and anything below level 2 are dropped.
4. **Verifier.** Every P0 and P1 goes to a separate verify pass that tries to
   refute it from the code and answers confirmed, rejected or uncertain.
   Rejected findings are dropped. When the verifier proposes another severity,
   a person is asked to choose.
5. **Verdict.** [`ci/core/verdict.mjs`](../ci/core/verdict.mjs) decides. A
   finding blocks only when it is P0 or P1, introduced by this PR, and either
   level 4, or level 3 and confirmed by the verifier. Any blocking finding
   gives `request_changes`. Open questions for a person, or a direction that
   did not finish, give `needs_human`: a round where part of the change went
   unreviewed never passes. Three blocking rounds in a row give `needs_human`
   too, so the loop goes to a person instead of an agent making more changes.
   Otherwise `pass`.
6. **Rule questions.** Besides model findings, the pipeline itself asks: when
   a risk path of the rule pack is touched (with that area's questions), when
   an L, XL or risk-path PR has no verification or rollback section in its
   description, when UI files change without a screenshot, and when the same
   PR has blocked for three rounds. Each closes by itself once its condition
   clears.

## Threads and rounds

- The threads are the state: the bot reads them back each round. A person
  resolving a finding's thread dismisses it; it stops counting and is never
  reopened. A finding the bot resolved reopens if it comes back.
- The bot resolves a finding's thread only when a direction responsible for it
  reviewed that file again and did not report it, or the file left the PR. A
  direction whose model call failed proves nothing, so its findings stay.
- A direction that reaches its time limit is asked once, in the same model
  session, for the findings it has already checked. Those findings are posted,
  but the direction counts as unfinished: it closes no thread, its result is
  not reused, and the round cannot pass.
- New P0 and P1 findings always get a thread; P2 suggestions only on added
  lines, at most five new ones a round.
- The next round passes the existing threads and replies to the model, so a
  question already asked is not asked again.
- Each direction's result is kept per file by a fingerprint of that file's net
  diff. A new push re-reviews only files whose fingerprint changed; a clean
  rebase changes none. Rounds of one PR queue per direction, so a running
  review is never cancelled by a newer push.
- On GitHub, the summary is a PR comment and findings and questions are review
  threads. GitHub has no resolvable thread on a PR as a whole, so a question
  about the whole PR is opened as a file comment on its most relevant changed
  file.

## Author quiz (optional)

When a rule pack sets `"quiz": { "enabled": true }`, PRs that change enough
product code (120 lines or 4 files by default; docs, tests and generated files
excluded) or a risk path get a short multiple-choice quiz for the author: why
the change works this way, what it affects, edge cases and failure modes. The
author ticks answers in the quiz comment or replies `1A 2C`; the answer key is
in a collapsed block. Answers are public and never block a merge. A script
drops questions that read like code listings and asks the model once to
rewrite them. Answers are recorded at the next push, or at once by the
`grade` job (GitHub: when someone comments on the PR; GitLab: a manual job).
The rules are in [`skills/pr-quiz`](../skills/pr-quiz/SKILL.md).

## Local use

In a checkout, ask your agent:

- "Review the current branch with pr-review": one general pass over the net
  diff against the target branch.
- "Review the current branch with pr-review, security and permissions only":
  only the named directions, one pass each. Names: general, behavior
  preservation, contracts and data, security and permissions, cross-feature
  impact, duplication and simplification. The labels of a Chinese summary
  (综合、行为保持、契约与数据、安全与权限、跨功能影响、重复与简化) work too.
- "Review PR 123 with pr-review": fetches the PR head (`pull/123/head` on
  GitHub, `refs/merge-requests/123/head` on GitLab) when it is not checked
  out.
- "Review the current branch with pr-review, target branch dev": name the
  target when it is not the remote default branch, or the diff will include
  commits that are not part of the PR. With `gh` or `glab` installed, the
  skill reads a PR's target branch itself.
- "Draft the PR description with pr-description".

A local review uses the model and quota of your own session, posts nothing,
needs no CI variable, and applies `.mcode-review.json` and `.mcode-review.md`
from your working tree when they exist. When a CI direction could not finish,
the summary names the directions and the exact request to run locally.

## CI on GitHub Actions

1. Pick a plugin commit: a full 40-character commit of mcode-stack, for
   example the head of `main` from
   `git ls-remote https://github.com/MiniMax-AI/mcode-stack refs/heads/main`.
2. Copy [`ci/github/mcode-review.yml`](../ci/github/mcode-review.yml) from that
   commit to `.github/workflows/mcode-review.yml` and replace
   `<40-character commit of mcode-stack>` in it with the commit.
3. In Settings → Secrets and variables → Actions, add the secret
   `MCODE_REVIEW_API_KEY` and the variable `MCODE_REVIEW_BASE_URL`.
4. Open a PR. The workflow posts a comment that starts with "MCode Review".

What the workflow does:

| Job | Permissions of its token | What it does |
| --- | --- | --- |
| `prepare` | read | Tier, directions, net-diff fingerprints, duplication hints, the last round's state; decides whether this round writes a quiz. |
| `review` | read contents only, no token in the environment | One job per direction the tier uses, in parallel; finds, then verifies P0/P1. |
| `quiz` | read contents only | Writes the author quiz when prepare asked for one. |
| `publish` | write PR comments and threads, and contents | Verdict, summary comment, threads, quiz comment and answer record. GitHub resolves a review thread only for a token that may also write the repository's contents, so this job asks for that; it checks out nothing and runs no model. |
| `grade` | write PR comments | On a new or edited PR comment by a person: records quiz answers at once. Without the author quiz, drop the `issue_comment` trigger and this job. |

Notes:

- **Fork PRs** are skipped: GitHub gives no secrets to workflows of PRs from
  forks. **Draft PRs** are skipped until they are marked ready for review.
- **Bot identity.** The bot posts as `github-actions` with the workflow's
  token. To post as your own bot account or app, add a secret
  `MCODE_REVIEW_GITHUB_TOKEN` holding its token.
- **New pushes.** Each direction has its own concurrency group per PR: a newer
  push never cancels a running direction, it waits for it. GitHub keeps one
  waiting run per group, so a run still waiting when an even newer push
  arrives is cancelled.
- **Upgrades.** Copy the workflow file again from the new commit and put that
  commit in it, in one PR. prepare stops with a clear message when the
  workflow file and the plugin commit do not belong together.

## CI on GitLab

1. Pick a plugin commit, as above.
2. Copy [`ci/gitlab/review.gitlab-ci.yml`](../ci/gitlab/review.gitlab-ci.yml)
   from that commit to `.gitlab/mcode-review.gitlab-ci.yml`.
3. Paste the job in
   [`ci/gitlab/dispatch.gitlab-ci.yml`](../ci/gitlab/dispatch.gitlab-ci.yml)
   into your `.gitlab-ci.yml`, with a stage you already have, and put the
   commit in its `MCODE_REVIEW_PLUGIN_REF`.
4. Set the CI/CD variables `MCODE_REVIEW_API_KEY`, `MCODE_REVIEW_BASE_URL` and
   `MCODE_REVIEW_GITLAB_TOKEN`: a token that can read the merge request,
   post notes and resolve threads, such as a project access token with the
   `api` scope and the Developer role, with its environment scope set to
   `mcode-review`.
5. Open a merge request. The child pipeline posts a note that starts with
   "MCode Review".

Notes:

- **Draft merge requests** get a manual job, detected from the title, which
  works on every GitLab version. A rule with `when: manual` defaults to
  `allow_failure: false` and would hold the pipeline, so the rule sets
  `allow_failure: true`.
- **Target branches.** To review only merge requests into some branches, add
  a condition such as `&& $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == $CI_DEFAULT_BRANCH`
  to both rules.
- **Merge request pipelines only.** A project that runs only branch pipelines
  today gets a second pipeline per merge request that holds only the review;
  the merge request page usually shows that one. Agree on this with the
  project's owners first.
- **New pushes.** The review jobs are `interruptible: false` and share a
  `resource_group` per merge request and direction. A newer push never
  cancels a running direction; the next round waits for it, reuses its result,
  and reviews only the files changed since.
- **Upgrades.** Change `MCODE_REVIEW_PLUGIN_REF` and copy the child file from
  the same commit, in one merge request. A pipeline uses the CI config of its
  own source branch, so open merge requests keep the old version until they
  rebase.

The [`pr-review-ci`](../skills/pr-review-ci/SKILL.md) skill walks an agent
through either setup, upgrades and rollbacks.

### Variables

| Variable | Where | Required | What it is |
| --- | --- | --- | --- |
| `MCODE_REVIEW_PLUGIN_REF` | the workflow file / the dispatch job | yes | The mcode-stack commit to run, 40 characters. prepare stops on a branch or tag name, so the version never moves under running PRs. |
| `MCODE_REVIEW_API_KEY` | secret / masked variable | yes | The model API key. |
| `MCODE_REVIEW_BASE_URL` | variable | yes | An Anthropic Messages compatible endpoint, for example `https://api.minimax.io/anthropic/v1` or `https://api.minimaxi.com/anthropic/v1`. |
| `MCODE_REVIEW_GITLAB_TOKEN` | GitLab variable | GitLab only | The bot token, environment scope `mcode-review`. |
| `MCODE_REVIEW_GITHUB_TOKEN` | GitHub secret | no | A token to post as your own bot account or app instead of `github-actions`. |
| `MCODE_REVIEW_LANGUAGE` | variable | no | `en` (default) or `zh` for Simplified Chinese (`zh-CN`, `zh-Hans` and `chinese` work too). A pipeline keeps the language prepare read; replies in either language are understood. |
| `MCODE_REVIEW_PHASE` | variable | no | `shadow` (default) marks the summary as comment-only. See [Making it blocking](#making-it-blocking). |
| `MCODE_REVIEW_HTTPS_PROXY` | variable | no | A proxy for the model calls. |
| `MCODE_REVIEW_REPO_PROFILE` | the workflow file / the dispatch job | no | A rule pack bundled in `ci/config/repos/`, without `.json`. Default `default`. Your repository's own `.mcode-review.json` is merged on top. |
| `MCODE_REVIEW_MCODE_VERSION`, `MCODE_REVIEW_NPM_REGISTRY` | the workflow file / the template | no | Which `@minimax-ai/code` CLI version to install, and from where. |
| `MCODE_REVIEW_PLUGIN_ARCHIVE_URL` | variable | no | Download the plugin from a mirror instead of GitHub. |
| `MCODE_REVIEW_FEISHU_*` | variables | no | The optional Feishu card; see [Feishu card](#feishu-card). |

## Configuration

### Your repository's rules

Two optional files in your repository root:

- **`.mcode-review.json`**: a rule pack. It overrides
  [`ci/config/repos/default.json`](../ci/config/repos/default.json) key by key:
  `risk_areas` (globs, a name and the questions to ask when a PR touches
  them), `stacks` (which stack checklists apply), `ui_globs`,
  `generated_globs`, `tier_thresholds` and `quiz`. The `quiz` block overrides
  only the fields it sets, and its `non_product_globs` add to the built-in
  ones. [`example.json`](../ci/config/repos/example.json) shows every key. A
  risk area's `name` and `questions` are plain text in one language, or an
  object with one entry per language, `{ "en": ..., "zh": ... }`.
- **`.mcode-review.md`**: your repository's known failure patterns, one
  numbered list, as in
  [`example.md`](../skills/pr-review/references/repos/example.md). Every
  review direction reads it.

CI reads both from the merge base and restores them to that version before a
model runs, so a PR cannot change the rules that review it. A
`.mcode-review.json` that does not parse is reported in the prepare log, and
the bundled rule pack is used. `pr-review-tuning` proposes changes to these two
files.

### Models

[`ci/config/models.json`](../ci/config/models.json) holds the provider, the
models, a model chain per role (`lens` finds problems, `verify` checks P0 and
P1, `quiz` writes the quiz) and the timeouts in seconds. Out of the box one
model, `MiniMax-M3.1-Flash`, does everything through the Anthropic Messages
API. Code never branches on a model name; changing models means editing this
file.

- **Any model your endpoint serves.** Add an entry under `models` with its
  `api` (`anthropic-messages` or `openai-responses`), `context` and `output`
  token limits and the `efforts` it supports, and name it in the role chains.
  Each API becomes its own provider at the same `MCODE_REVIEW_BASE_URL`.
  `provider.headers` adds HTTP headers to every call.
- **Fallback chains.** A role's `chain` lists models to try in order. A fast
  failure (rate limit, connection error, a model the key cannot use) moves to
  the next one; a failure after more than half of the time budget stops, so
  the job does not overrun its timeout. Every attempt and its tokens are
  recorded.
- **A separate verifier.** The verifier is most useful when it does not share
  the finder's blind spots. With a second model available, put it first in
  `roles.verify.chain`.
- **Arms.** An optional `arms` list splits PRs between model setups to compare
  them on real traffic: `{ "id": "a+b", "weight": 3, "lens": [...], "verify": [...] }`.
  Each PR keeps its arm for every round; over many PRs the split follows the
  weights. The summary and the stored history name the arm.

### Language

Everything the bot posts is in English by default; `MCODE_REVIEW_LANGUAGE: zh`
switches the summary, threads, rule questions, the quiz and the Feishu card to
Simplified Chinese, and the model writes its findings in Chinese too. Job
logs, docs and skill instructions stay in English; the local skills answer in
your language.

### Making it blocking

The review never fails the pipeline. Findings hold a merge once every thread
must be resolved before merging: on GitHub, branch protection "Require
conversation resolution before merging"; on GitLab, the project setting "All
threads must be resolved". Turn it on when the team trusts the reviews, and
set `MCODE_REVIEW_PHASE` to `enforce` so the summary stops saying it only
comments. The setting applies to threads people write too; the quiz is a
plain comment and needs no resolving.

### Feishu card

Optional and off unless its variables are set (on GitHub: the variables and
secrets listed in the workflow file's header). With
`MCODE_REVIEW_FEISHU_APP_ID`, `MCODE_REVIEW_FEISHU_CHAT_ID` and
`MCODE_REVIEW_FEISHU_APP_SECRET`, each author quiz is also sent as a card to
that Feishu group chat, with a collapsed answer under each question, and the
card is updated as the author answers. `MCODE_REVIEW_FEISHU_EMAIL_DOMAINS`
(company email domains, comma separated) lets the card mention the author;
`MCODE_REVIEW_FEISHU_EMAIL_ALIASES` (`username=email,...`) covers authors whose
contact email cannot be worked out from their commits.

### Networks that cannot reach GitHub

- The plugin download goes to GitHub; set `MCODE_REVIEW_PLUGIN_ARCHIVE_URL` to
  a mirror of the same archive.
- The MiniMax Code CLI depends on better-sqlite3, whose install downloads a
  prebuilt binary from GitHub. Set the CI variable
  `npm_config_better_sqlite3_binary_host_mirror` to a mirror of those
  binaries.
- `MCODE_REVIEW_NPM_REGISTRY` points the install at another npm registry.

## Security model

- **Jobs that call a model hold no write token.** On GitHub, `review` and
  `quiz` get a read-only token that is not in their environment, and the
  checkout keeps no credentials. The write token goes to `publish` and
  `grade`, which run no model and only the pinned plugin code. On GitLab, the
  bot token and the Feishu secret are scoped to the `mcode-review`
  environment, which only prepare, publish and grade use.
- **What a model job can read.** The model has a shell, so it can read what
  its job holds: the model API key, and on GitLab every unscoped project and
  group variable. Git credentials are removed before the model starts.
  Everything a model job writes has every credential-looking value removed,
  but only exact copies are caught. Give the reviewer a model key of its own
  with a spend limit, and keep unrelated secrets scoped or protected.
- **Who can steer the model.** PR titles, descriptions and the replies in the
  bot's threads reach the model as untrusted data, with hidden comments and
  invisible characters removed, and the code under review can carry such text
  too. On a public repository anyone who can comment on a PR can reply in
  those threads. A model that follows injected text could put an encoded key
  in a finding or send it out over the network. At stake is what the job can
  read, never the bot's write token.
- **The PR author.** None of this guards against the PR author, who can
  change CI files in their own PR. Such a change shows in the diff and hits
  the CI risk path of the rule pack. On GitHub, PRs from forks never run the
  review.
- **Instructions under review.** Before a review, agent instruction files the
  PR changes (`AGENTS.md`, `CLAUDE.md`, `.mcode-review.json`,
  `.mcode-review.md` and similar) are restored to the merge-base version, so a
  PR cannot change the instructions that review it.
- **Output.** Model text is stripped of HTML, images and quick actions before
  the bot posts it.
- **Read-only review.** The prompts forbid editing files, running builds or
  tests, and network access during a review. The runner does not enforce
  this.

## Keeping it tuned

[`pr-review-tuning`](../skills/pr-review-tuning/SKILL.md) is the loop we run
on our own reviewer every week. It collects what the bot did on last week's
PRs, measures threads per PR, which kinds people answer or dismiss, what was
still unanswered at merge, cost per round, and which later fix PRs point back
at a PR the reviewer passed. It proposes at most three rule changes, each with
the expected effect on four goals (fewer threads per PR, fewer fixes after
merge, faster review, simpler code), backtests them on past PRs with known
bugs within a token budget you agree to, has an independent pass recompute the
numbers, and changes nothing until you approve. The first run only measures.

## Development

Run the tests from `stacks/jiachen`, on Node 22 and on the current Node:

```sh
node --test ci/test/*.test.mjs skills/pr-review-tuning/scripts/test/*.test.mjs
```

To rehearse a round without posting anything, set `MCODE_REVIEW_DRY_RUN=1`.
publish then writes the summary to `.mcode-review/out/summary.md` and a quiz
to `.mcode-review/out/quiz-note.md` instead of commenting, and a later dry run
reads them back as the previous round. The rehearsal still needs
`MCODE_REVIEW_PLUGIN_REF` set to a 40-character commit, and the review
directions still call the model. `pr-review-tuning`'s `backtest.mjs` runs such
rehearsals on past PRs with every write to GitHub or GitLab blocked.

Layout: [`ci/review.mjs`](../ci/review.mjs) is the entry point, with one
subcommand per job; `ci/core/` holds the logic, without I/O where it can
(tiering, verdict, state, threads, quiz, the GitHub and GitLab clients);
`ci/prompts/` and `ci/schema/` are what the model sees; `skills/` is shared
by CI and local use.

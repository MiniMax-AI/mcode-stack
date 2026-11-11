---
name: pr-review-ci
description: Connects a GitHub or GitLab repository to the MCode Review CI and keeps the setup current. Use when someone adds MCode Review to a repository on GitHub Actions or GitLab CI, upgrades or rolls back the pinned plugin commit, changes the repository's rule pack, language, models, shadow or enforce phase, author quiz or Feishu card, checks the security setup, or troubleshoots a review run that failed.
---

# MCode Review in CI

MCode Review runs as a GitHub Actions workflow or as a GitLab CI child pipeline. Both have the same jobs:

| Job | Calls a model | What it does |
| --- | --- | --- |
| `prepare` | no | Tier, review directions, net-diff fingerprints, duplication hints, the last round's state; decides whether this round writes a quiz. |
| `review` | yes | One job per review direction the tier uses; finds problems, then verifies P0 and P1. |
| `quiz` | yes | The optional author quiz, when prepare asks for one. |
| `publish` | no | Verdict, summary comment, threads, quiz comment and answer record, the optional Feishu card. |
| `grade` | no | Records quiz answers at once instead of at the next push. |

Every job runs one subcommand of `ci/review.mjs` from the plugin at the commit pinned in `MCODE_REVIEW_PLUGIN_REF`, a 40-character commit of `github.com/MiniMax-AI/mcode-stack`. Paths below without a repository name are relative to the plugin directory, `stacks/jiachen` in mcode-stack. On GitLab a PR is a merge request.

## Ground rules

- The repository keeps an unedited copy of the template from the pinned commit: `.github/workflows/mcode-review.yml` on GitHub; `.gitlab/mcode-review.gitlab-ci.yml` plus the dispatch job in `.gitlab-ci.yml` on GitLab. Behaviour changes go into the repository's rule pack or into the plugin, never only into the copy.
- The pin and the template copy always come from the same commit. prepare checks this (see "Template version").
- Secrets, variables, tokens and branch protection are repository settings. Tell the user what to set and where. Set them yourself with `gh` or `glab` only when the user asks you to, never print a secret, and never put one on a command line.

## Pick the plugin commit

Use a full 40-character commit, for example the head of `main`: `git ls-remote https://github.com/MiniMax-AI/mcode-stack refs/heads/main`. prepare stops on anything else, so a branch or tag name never moves the version under running PRs. A file of that commit is at `https://raw.githubusercontent.com/MiniMax-AI/mcode-stack/<commit>/stacks/jiachen/<path>`.

## Onboard a GitHub repository

You need GitHub Actions enabled, runners that reach github.com, the npm registry and the model endpoint, and admin access to the repository's settings.

1. Copy the workflow from the commit: `curl -fsSL -o .github/workflows/mcode-review.yml https://raw.githubusercontent.com/MiniMax-AI/mcode-stack/<commit>/stacks/jiachen/ci/github/mcode-review.yml`.
2. In its top-level `env`, replace `<40-character commit of mcode-stack>` in `MCODE_REVIEW_PLUGIN_REF` with the commit. Leave `MCODE_REVIEW_TEMPLATE_VERSION`, `MCODE_REVIEW_PLUGIN_PATH`, `MCODE_REVIEW_HOST` and the jobs as they are. The same block holds `MCODE_REVIEW_REPO_PROFILE` (a rule pack bundled in `ci/config/repos/`, default `default`), `MCODE_REVIEW_MCODE_VERSION` and `MCODE_REVIEW_NPM_REGISTRY`; change those only for a reason.
3. In Settings → Secrets and variables → Actions:
   - secret `MCODE_REVIEW_API_KEY`: the model API key;
   - variable `MCODE_REVIEW_BASE_URL`: an Anthropic Messages compatible endpoint, for example `https://api.minimax.io/anthropic/v1`; `docs/pr-review.md` lists the endpoint for mainland China;
   - optional variables `MCODE_REVIEW_LANGUAGE` (`en` or `zh`), `MCODE_REVIEW_PHASE` (`shadow` or `enforce`), `MCODE_REVIEW_HTTPS_PROXY` and `MCODE_REVIEW_PLUGIN_ARCHIVE_URL`;
   - optional secret `MCODE_REVIEW_GITHUB_TOKEN`: the token of a dedicated bot account or GitHub App, to post as that identity instead of `github-actions`. It needs write access to contents, pull requests and issues of this repository and nothing more; GitHub resolves review threads only for a token that may write contents. With an app token, also set the variable `MCODE_REVIEW_BOT_LOGIN` to the app's login, such as `my-app[bot]`.

   With `gh`: `gh variable set MCODE_REVIEW_BASE_URL --body <url>`. Let the user run `gh secret set MCODE_REVIEW_API_KEY` themselves; it prompts for the value, so the key never passes through you.
4. Commit the workflow on a branch of this repository and open a PR that is not a draft. A PR runs the workflow file of its own branch, so this PR gets the first review. Check it as "Verify" says.
5. `grade` starts on comments only after the workflow is on the default branch: GitHub runs comment-triggered workflows from the default branch.

## Onboard a GitLab project

You need runners that run the `node:22` image and reach github.com, the npm registry and the model endpoint, and the Maintainer role to set CI/CD variables and create a project access token.

1. Copy the child pipeline from the commit: `curl -fsSL -o .gitlab/mcode-review.gitlab-ci.yml https://raw.githubusercontent.com/MiniMax-AI/mcode-stack/<commit>/stacks/jiachen/ci/gitlab/review.gitlab-ci.yml`. Do not edit the copy.
2. Paste the dispatch job of `ci/gitlab/dispatch.gitlab-ci.yml` at the same commit into the project's `.gitlab-ci.yml`. Then:
   - set its `stage` to a stage the project already has;
   - replace `<40-character commit of mcode-stack>` in `MCODE_REVIEW_PLUGIN_REF` with the commit;
   - keep the rest as it is: `trigger:include:local` of `.gitlab/mcode-review.gitlab-ci.yml`; `forward` with `yaml_variables: true` and `pipeline_variables: false`, which keeps the variables of a manually run pipeline out of the review; and the Draft rule with `when: manual` and `allow_failure: true`;
   - to review only PRs into some branches, add a condition such as `&& $CI_MERGE_REQUEST_TARGET_BRANCH_NAME == $CI_DEFAULT_BRANCH` to both rules.
3. In Settings → CI/CD → Variables, masked where GitLab allows it:
   - `MCODE_REVIEW_API_KEY`: the model API key;
   - `MCODE_REVIEW_BASE_URL`: as on GitHub;
   - `MCODE_REVIEW_GITLAB_TOKEN`: a bot token that can read the PR, post notes and resolve threads, such as a project access token with the `api` scope and the Developer role. Set its environment scope to `mcode-review`;
   - optional: `MCODE_REVIEW_LANGUAGE`, `MCODE_REVIEW_PHASE`, `MCODE_REVIEW_HTTPS_PROXY`, `MCODE_REVIEW_NPM_REGISTRY`, `MCODE_REVIEW_MCODE_VERSION`, `MCODE_REVIEW_PLUGIN_ARCHIVE_URL` and the Feishu variables. A bundled rule pack other than `default` goes into `MCODE_REVIEW_REPO_PROFILE` in the dispatch job.
4. If the project runs only branch pipelines today, tell its owners first: the dispatch job runs in merge request pipelines, so each PR gets a second pipeline that holds only the review, and the PR page usually shows that one. Wait for their agreement.
5. Push the branch, check it and open a PR, as "Verify" says.

## Template version

`ci/github/mcode-review.yml` and `ci/gitlab/review.gitlab-ci.yml` set `MCODE_REVIEW_TEMPLATE_VERSION`, and the plugin code has the version it expects. When the copy's value differs or is missing, prepare stops with "your copy of <file> is from another plugin version; copy it again from commit <ref>". Copy the template again from the commit the message names, or pin the commit the copy came from. Never edit the version line by hand: a template from one commit with code from another can call a subcommand or need a variable the other does not have.

## Upgrade or roll back

1. Pick the new commit.
2. In one PR, set `MCODE_REVIEW_PLUGIN_REF` to it and copy the template from the same commit:
   - GitHub: download the workflow again, then put back your values in its `env` block (the pin, and the profile, CLI version and registry if you changed them).
   - GitLab: download the child pipeline again, compare the dispatch job with `ci/gitlab/dispatch.gitlab-ci.yml` at the new commit and apply its changes, and set the new pin in the dispatch job.
3. Read the diff of the copy: changed job names, variables, permissions or `needs` can affect the repository's other CI rules and branch protection.
4. The PR's own run already uses the new version. Check its summary before merging.
5. To roll back, revert that PR. To try a version without merging, open a draft PR with the change and start its review by hand (GitLab), or a non-draft PR you close afterwards (GitHub).

When open PRs pick up the change: GitHub runs a PR's workflow from the test merge of the PR into its target, so open PRs use the new version from their next push (a PR with conflicts gets no run at all). GitLab runs the CI config of the PR's source branch, so an open PR keeps its old dispatch job and template until it rebases or merges the target branch.

## Project rule pack

Two optional files in the repository root. CI reads both from the merge base; the local `pr-review` skill reads them from the working tree.

- `.mcode-review.json`: a rule pack with the keys of `ci/config/repos/*.json`, merged over `ci/config/repos/default.json` (and over the bundled profile in `MCODE_REVIEW_REPO_PROFILE` when that is set) key by key: `risk_areas` (`id`, `name`, `globs`, `questions`: the questions a person is asked when a PR touches those paths), `stacks`, `ui_globs`, `generated_globs`, `tier_thresholds` and `quiz`. A `name` or `questions` value is plain text in one language, or an object with one entry per language, `{ "en": ..., "zh": ... }`. `quiz` overrides only the fields it sets, and its `non_product_globs` add to the built-in ones. Start from `ci/config/repos/example.json`, which shows every key.
- `.mcode-review.md`: the repository's known failure patterns, one numbered list, in the format of `skills/pr-review/references/repos/example.md`. Every review direction reads it.

Notes:

- Both files count as instruction files: before a model runs they are restored to the merge-base version, so a PR cannot change the rules that review it. A PR that changes them is reviewed with the old rules; the new rules apply to PRs whose merge base contains the change.
- A `.mcode-review.json` that does not parse is reported in the prepare log, and the bundled rule pack is used instead. Check it before committing: `node -e 'JSON.parse(require("fs").readFileSync(".mcode-review.json", "utf8"))'`.
- The `pr-review-tuning` skill measures how the rules work on the repository's PRs and proposes changes to these two files.

## Language

`MCODE_REVIEW_LANGUAGE` is `en` (the default) or `zh` for Simplified Chinese; `zh-CN`, `zh-Hans` and `chinese` also mean `zh`, and any other value falls back to `en` with a line in the prepare log. It sets the language of everything the bot posts: summary, threads, rule questions, quiz and Feishu card; the model writes its findings in that language too. Job logs stay in English. A pipeline keeps the language prepare read, and replies in either language are understood.

## Models

- Out of the box every role uses `MiniMax-M3.1-Flash` through the Anthropic Messages API at `MCODE_REVIEW_BASE_URL`.
- `ci/config/models.json` holds the provider (`provider.headers` adds HTTP headers to every call), the models (`api`: `anthropic-messages` or `openai-responses`, `context` and `output` token limits, the `efforts` they support), a model chain per role (`lens` finds problems, `verify` checks P0 and P1, `quiz` writes the quiz), the timeouts in seconds, and optional `arms` that split PRs between model setups to compare them. Any model the endpoint serves can be added and named in a chain; the code never branches on a model name. A fast failure moves on to the next model of the chain. When a second model is available, putting it first in `roles.verify.chain` gives a verifier that does not share the finder's blind spots.
- The plugin is downloaded at the pinned commit, so a repository that wants other models runs its own copy of the plugin: fork mcode-stack or keep a mirror, edit `ci/config/models.json` there and commit; set `MCODE_REVIEW_PLUGIN_ARCHIVE_URL` to a tar.gz of that commit whose one top-level directory holds `stacks/jiachen` (for a GitHub fork, `https://github.com/<owner>/mcode-stack/archive/<commit>.tar.gz`); set `MCODE_REVIEW_PLUGIN_REF` to the fork's commit; and copy the template from that commit. The download sends no token, so the archive must be readable without one.

## Shadow and enforce

- `MCODE_REVIEW_PHASE` is `shadow` by default: the summary says the review only comments and does not block. The review never fails the workflow or the pipeline.
- Findings and questions hold a merge once every thread must be resolved before merging. GitHub: a branch protection rule or ruleset on the target branch with "Require conversation resolution before merging". GitLab: Settings → Merge requests → "All threads must be resolved". Turn it on when the team trusts the reviews, and set `MCODE_REVIEW_PHASE` to `enforce` so the summary stops saying it only comments.
- The setting applies to threads people write too. The quiz is a plain comment and needs no resolving. Before switching, look at threads per PR and the share unanswered at merge in the `pr-review-tuning` report.

## Author quiz (optional)

- Turn it on in `.mcode-review.json` with `"quiz": { "enabled": true }`. PRs that change enough product code (120 lines or 4 files by default; docs, tests and generated files excluded) or a risk path get a short multiple-choice quiz comment: why the change works this way, what it affects, edge cases and failure modes. Answers are public and never block a merge.
- Fields: `questions`, `min_code_lines`, `min_code_files`, `skip_source_branches` (regular expressions), `non_product_globs`, `regen_min_line_delta`, `regen_min_file_delta` and `max_per_mr` (quizzes per PR).
- Answers are recorded at the next push, or at once by `grade`: on GitHub when a person comments on the PR, on GitLab when someone starts the manual `mcode-review:grade` job.
- The question rules are in `skills/pr-quiz`.

## Feishu card (optional)

When `MCODE_REVIEW_FEISHU_APP_ID`, `MCODE_REVIEW_FEISHU_CHAT_ID` and `MCODE_REVIEW_FEISHU_APP_SECRET` are set, publish also sends each author quiz as a card to that Feishu group chat and updates it as the author answers. Without them no card is sent.

- The app is a Feishu custom app with the bot capability, added to the chat.
- To mention the PR author, set `MCODE_REVIEW_FEISHU_EMAIL_DOMAINS` to the company email domains, comma separated. publish tries, in order, the author's entry in `MCODE_REVIEW_FEISHU_EMAIL_ALIASES`, commit emails that match the author's username, then the username at each domain, until Feishu accepts one; its log names the email it used, or on a `no @` line the emails Feishu rejected. Feishu matches the contact email in its directory, which commits cannot always show: add such authors to `MCODE_REVIEW_FEISHU_EMAIL_ALIASES` as `username=email,username=email`, with the contact email, not the enterprise email. Keep the emails in that setting, not in a repository. An author is mentioned only as a member of the chat.
- GitLab: CI/CD variables; set the environment scope of `MCODE_REVIEW_FEISHU_APP_SECRET` and `MCODE_REVIEW_FEISHU_EMAIL_ALIASES` to `mcode-review`.
- GitHub: repository variables `MCODE_REVIEW_FEISHU_APP_ID`, `MCODE_REVIEW_FEISHU_CHAT_ID` and `MCODE_REVIEW_FEISHU_EMAIL_DOMAINS`, and repository secrets `MCODE_REVIEW_FEISHU_APP_SECRET` and `MCODE_REVIEW_FEISHU_EMAIL_ALIASES`; the workflow passes them to publish and grade only.

## Security model

GitHub:

- The workflow sets `permissions: {}` at the top and each job asks for its own: prepare reads code, PRs and issues; review and quiz read code only; grade writes PR comments; publish writes PR comments and threads, and contents too, because GitHub resolves and reopens review threads only for a token that may write contents. publish checks out nothing and runs no model.
- review and quiz, the jobs that call a model, get the model key and no GitHub token in their environment, and check out the code with `persist-credentials: false`. publish and grade hold the token and never call a model.
- PRs from forks are skipped, because GitHub gives their workflows no secrets. Do not switch the trigger to `pull_request_target` to review them: that runs untrusted code with the repository's secrets. Draft PRs are skipped until they are ready for review. grade ignores comments by bots.
- A PR runs the workflow file of its own branch, so anyone who can push a branch can change what the jobs do in their PR. MCode Review keeps the write token from the model, not from people with write access. Such a change shows in the diff and touches the CI risk path of the rule pack.

GitLab:

- The bot token and the Feishu secret are scoped to the `mcode-review` environment. Only prepare, publish and grade use that environment, and they never call a model.
- The jobs that call a model (`mcode-review:review`, `mcode-review:quiz`) have no environment, but GitLab gives every job the unscoped project and group variables, and a model with a shell can read them. Keep unrelated secrets environment-scoped or protected. The pipeline removes every credential-looking value from what those jobs write, and removes credentials from the git remote before a model starts.
- The environment scope keeps secrets from the model, not from the PR author, who can attach any job of their own PR to the `mcode-review` environment. Such a change shows in the diff and touches the CI risk path of the rule pack.

Both hosts:

- Before a review, agent instruction files that the PR changes (`AGENTS.md`, `CLAUDE.md`, `.mcode-review.json`, `.mcode-review.md` and similar) are restored to the merge-base version. PR titles, descriptions and replies in the bot's threads reach the model as untrusted data. On a public repository anyone who can comment on a PR can reply in those threads.
- The model has a shell and can read what its job holds, the model key included. Exact copies of credential-looking values are removed from what a model job writes; an encoded copy, or one sent over the network, is not caught: the prompts forbid network access, but the runner does not block it. Advise a model key used only by the reviewer, with a spend limit.
- Model text is stripped of HTML, images and quick actions before it is posted.

## Verify

GitHub:

1. Open a PR from a branch of this repository, not a draft and not from a fork.
2. Follow the run in the Actions tab, or with `gh run list --workflow mcode-review.yml` and `gh run view <run-id> --log`: `mcode-review:prepare` passes the template version check and logs the tier and the directions; one `mcode-review:review (<direction>)` job runs per direction; `mcode-review:publish` succeeds.
3. The PR gets a comment that starts with "MCode Review", and findings and questions appear as review threads.

GitLab:

1. Validate the CI file with the CI lint API: `POST /projects/:id/ci/lint` with the project's `.gitlab-ci.yml` as `content`, `"dry_run": true` and `"ref"` set to the pushed source branch. The answer must have `"valid": true` and no errors. `glab ci lint --dry-run --ref <branch>` and the project's pipeline editor run the same check.
2. Open a PR. The dispatch job starts a child pipeline with `mcode-review:prepare`, one `mcode-review:review` job per direction, `mcode-review:quiz`, `mcode-review:publish` and the manual `mcode-review:grade`. publish posts a note that starts with "MCode Review".

To rehearse without posting, set `MCODE_REVIEW_DRY_RUN` to `'1'` on a test branch that you never merge: in the workflow's `env` on GitHub, in the dispatch job's `variables` on GitLab. publish then posts nothing and writes the summary to `.mcode-review/out/summary.md` and a quiz to `.mcode-review/out/quiz-note.md`. GitLab keeps the summary and the verdict in the publish job's artifacts; the GitHub workflow uploads nothing from publish, so there its log line `[dry-run] summary written ...` gives the verdict. The review directions still call the model. `pr-review-tuning` rehearses rounds on past PRs the same way, with every write to GitHub or GitLab blocked.

## Troubleshooting

| What you see | Cause | What to do |
| --- | --- | --- |
| No run on a GitHub PR | The PR is from a fork, is a draft or has conflicts; the workflow is not on the PR's branch; Actions are disabled | Use a branch of the repository and mark the PR ready; resolve conflicts; check Settings → Actions |
| prepare stops on `MCODE_REVIEW_PLUGIN_REF` | The placeholder, a branch or a tag instead of a 40-character commit | Put the commit into the workflow `env` or the dispatch job |
| prepare stops with "your copy of <file> is from another plugin version" | Template copy and pin come from different commits | Copy the template again from the commit the message names |
| prepare stops on `MCODE_REVIEW_BASE_URL` | The setting is missing; on GitHub it must be a variable, not a secret | Set it as "Onboard" says |
| The plugin download fails (curl exit 22, HTTP 404) | The pin is not a commit of the archive's repository, or the runner cannot reach github.com | Fix the pin, or set `MCODE_REVIEW_PLUGIN_ARCHIVE_URL` to a fork or mirror |
| Installing the CLI fails | The npm registry, or the prebuilt binary of better-sqlite3 from GitHub, is unreachable | Set `MCODE_REVIEW_NPM_REGISTRY`, and the variable `npm_config_better_sqlite3_binary_host_mirror` to a mirror of those binaries |
| Directions fail and the summary names a request to run locally | Model key, endpoint, proxy, rate limit or time limit; read the `review` job log | Fix the setting and push again, or run the named request with `pr-review` on your own model |
| publish fails with 403 or "Resource not accessible by integration" (GitHub) | The copy's job permissions were changed, or `MCODE_REVIEW_GITHUB_TOKEN` lacks access | Copy the workflow again; give the token write access to contents, pull requests and issues |
| publish fails with 401 or 403 (GitLab) | The token is missing, expired, lacks the role or scope, or its environment scope is not `mcode-review` | Fix the token or its scope |
| A GitLab PR pipeline waits on the dispatch job | Its Draft rule lacks `allow_failure: true` | Restore the rule from `ci/gitlab/dispatch.gitlab-ci.yml` |
| No child pipeline on GitLab | A branch pipeline (the child needs a merge request pipeline), or the included file is not at `.gitlab/mcode-review.gitlab-ci.yml` | See "GitLab pitfalls" |
| grade never runs on GitHub | The workflow is not on the default branch yet, or the comment came from a bot | Merge the onboarding PR; answer as a person |
| The bot asks again what was answered, or forgets earlier rounds | Its summary comment, which carries the state, was deleted | Leave the summary comment in place; the next round starts over |

## GitLab pitfalls

- Older GitLab versions do not set `CI_MERGE_REQUEST_DRAFT`. The dispatch job detects a Draft PR from the title, which works on every version.
- A rule with `when: manual` defaults to `allow_failure: false` and holds the pipeline until someone starts the job. Write `allow_failure: true` in that rule.
- Auto-cancel judges the parent and the child pipeline separately, so `interruptible` belongs on the child's jobs, as the template sets it. The review jobs are `interruptible: false` and queue per PR and direction in a `resource_group`: a newer push never cancels a running direction, and the next round reuses its result.
- The child pipeline runs only in merge request pipelines: the template's `workflow` rule needs `CI_MERGE_REQUEST_IID` and `MCODE_REVIEW_PLUGIN_REF`.
- A top-level `include` cannot see YAML variables. `trigger:include` sees the trigger job's variables as well as project and group variables.
- A PR with conflicts runs on `refs/merge-requests/<n>/head` with the source branch's own CI config, so it keeps its old dispatch job and the version written in it until it rebases.

## GitHub pitfalls

- Each direction has its own concurrency group per PR. A newer push never cancels a running direction; GitHub keeps one waiting run per group, so a run still waiting when an even newer push arrives is cancelled, and the newest one runs.
- A comment-triggered run (`grade`) uses the workflow of the default branch, so during an upgrade PR it still runs the old version.

## Changing the pipeline itself

- Change the template in the plugin, upstream or in a fork, never only the repository's copy; then copy it again as in "Upgrade or roll back".
- Never give the jobs that call a model a write token, the GitHub token or the `mcode-review` environment.
- Do not make a job require a new variable without a default: repositories that upgrade would fail until they set it. Give it a default in the template or in `ci/review.mjs`.
- When the template and the code stop being compatible, raise the template version in both templates and in the code together.
- Run the tests from `stacks/jiachen` on Node 22 and on the current Node: `node --test ci/test/*.test.mjs`.

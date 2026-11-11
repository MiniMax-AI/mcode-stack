import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TEMPLATE_VERSION } from '../core/util.mjs';

// The GitHub Actions workflow projects copy. Read as text: the plugin has no
// YAML parser.
const text = readFileSync(new URL('../github/mcode-review.yml', import.meta.url), 'utf8');
const review = readFileSync(new URL('../review.mjs', import.meta.url), 'utf8');
const JOBS = ['prepare', 'review', 'quiz', 'publish', 'grade'];

// A job: from its key under jobs: to the next key at the same depth.
function job(name) {
  const start = text.indexOf('\n  ' + name + ':\n');
  assert.ok(start >= 0, name + ' is missing');
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n  [^\s#]/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const permissions = (name) => ((job(name).match(/\n    permissions:\n((?: {6}.+\n)+)/) || [])[1] || '').trim().split('\n').map((line) => line.trim()).sort();
const steps = (name) => job(name).split(/\n      - /).slice(1);

test('every job asks for its own permissions, and only the jobs that post may write', () => {
  assert.match(text, /\npermissions: \{\}\n/);
  assert.deepEqual(permissions('prepare'), ['contents: read', 'issues: read', 'pull-requests: read']);
  assert.deepEqual(permissions('review'), ['contents: read']);
  assert.deepEqual(permissions('quiz'), ['contents: read']);
  // GitHub resolves a review thread only for a token that may also write contents.
  assert.deepEqual(permissions('publish'), ['contents: write', 'issues: write', 'pull-requests: write']);
  assert.match(job('publish'), /resolves and reopens a review thread only for a token that may also\n    # write contents/);
  assert.deepEqual(permissions('grade'), ['contents: read', 'issues: write', 'pull-requests: write']);
});

test('the jobs that run a model hold no GitHub token and keep no git credentials; the others hold the token and no model key', () => {
  for (const name of ['review', 'quiz']) {
    assert.match(job(name), /- uses: actions\/checkout@v4\n        with:\n          fetch-depth: 0\n          persist-credentials: false\n/, name);
    assert.doesNotMatch(job(name), /github\.token|GITHUB_TOKEN|secrets\.MCODE_REVIEW_GITHUB_TOKEN/, name);
    assert.match(job(name), /\n          MCODE_REVIEW_API_KEY: \$\{\{ secrets\.MCODE_REVIEW_API_KEY \}\}\n          MCODE_REVIEW_BASE_URL: \$\{\{ vars\.MCODE_REVIEW_BASE_URL \}\}\n          MCODE_REVIEW_HTTPS_PROXY: \$\{\{ vars\.MCODE_REVIEW_HTTPS_PROXY \}\}\n/, name);
  }
  for (const name of ['prepare', 'publish', 'grade']) {
    assert.match(job(name), /\n          MCODE_REVIEW_GITHUB_TOKEN: \$\{\{ secrets\.MCODE_REVIEW_GITHUB_TOKEN \|\| github\.token \}\}\n/, name);
    assert.doesNotMatch(job(name), /MCODE_REVIEW_API_KEY/, name);
  }
  assert.match(job('prepare'), /- uses: actions\/checkout@v4\n        with:\n          fetch-depth: 0\n/);
  assert.doesNotMatch(job('publish'), /actions\/checkout/, 'publish runs no code of the PR');
  assert.match(job('grade'), /- uses: actions\/checkout@v4\n        with:\n          persist-credentials: false\n/);
});

test('artifacts keep the hidden work directory, and publish collects every result', () => {
  const uploads = text.match(/uses: actions\/upload-artifact@v4\n(?:        .+\n)+/g);
  assert.equal(uploads.length, 3);
  for (const upload of uploads) assert.match(upload, /\n          include-hidden-files: true\n/, upload);
  const plan = uploads[0];
  for (const file of ['plan.json', 'diff.patch', 'added-lines.json', 'description.md', 'repo-notes.md', 'plugin/']) assert.ok(plan.includes('            .mcode-review/' + file + '\n'), file);
  assert.match(job('review'), /name: mcode-review-out-lens-\$\{\{ matrix\.lens \}\}/);
  assert.match(job('quiz'), /name: mcode-review-out-quiz/);
  for (const name of ['review', 'quiz', 'publish']) assert.match(job(name), /- uses: actions\/download-artifact@v4\n        with:\n          name: mcode-review-plan\n          path: \.mcode-review\n/, name);
  assert.match(job('publish'), /\n          pattern: mcode-review-out-\*\n          merge-multiple: true\n          path: \.mcode-review\/out\n/);
});

test('fork PRs and drafts are skipped; grade answers people on open PRs only', () => {
  assert.match(text, /\non:\n  pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review\]\n  issue_comment:\n    types: \[created, edited\]\n/);
  const prepare = job('prepare');
  for (const condition of ["github.event_name == 'pull_request'", '!github.event.pull_request.draft', 'github.event.pull_request.head.repo.full_name == github.repository']) assert.ok(prepare.includes(condition), condition);
  const grade = job('grade');
  for (const condition of ["github.event_name == 'issue_comment'", 'github.event.issue.pull_request', "github.event.issue.state == 'open'", "github.event.sender.type != 'Bot'"]) assert.ok(grade.includes(condition), condition);
});

test('the file pins the plugin commit and its own version, which the plugin checks', () => {
  assert.match(text, /\n  MCODE_REVIEW_PLUGIN_REF: '<40-character commit of mcode-stack>'\n/);
  assert.match(text, new RegExp("\\n  MCODE_REVIEW_TEMPLATE_VERSION: '" + TEMPLATE_VERSION + "'\\n"));
  const gitlab = readFileSync(new URL('../gitlab/review.gitlab-ci.yml', import.meta.url), 'utf8');
  assert.match(gitlab, new RegExp("\\n  MCODE_REVIEW_TEMPLATE_VERSION: '" + TEMPLATE_VERSION + "'\\n"), 'the GitLab template carries the same version');
  assert.match(text, /\n  MCODE_REVIEW_PLUGIN_PATH: stacks\/jiachen\n/);
  assert.match(text, /\n  MCODE_REVIEW_HOST: github\n/);
  assert.match(text, /\n  MCODE_REVIEW_PR: \$\{\{ github\.event\.pull_request\.number \|\| github\.event\.issue\.number \}\}\n/);
  assert.match(text, /\n  MCODE_REVIEW_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n/);
  assert.match(text, /\n  MCODE_REVIEW_LANGUAGE: \$\{\{ vars\.MCODE_REVIEW_LANGUAGE \|\| 'en' \}\}\n/);
  assert.match(text, /\n  MCODE_REVIEW_PHASE: \$\{\{ vars\.MCODE_REVIEW_PHASE \|\| 'shadow' \}\}\n/);
  for (const name of ['MCODE_REVIEW_REPO_PROFILE', 'MCODE_REVIEW_MCODE_VERSION', 'MCODE_REVIEW_NPM_REGISTRY']) assert.match(text, new RegExp('\\n  ' + name + ': '), name);
});

test('directions run in parallel, only those the tier uses, and a newer push never cancels a running one', () => {
  const lens = job('review');
  assert.match(lens, /\n    needs: prepare\n    if: needs\.prepare\.outputs\.lenses != '' && needs\.prepare\.outputs\.lenses != '\[\]'\n/);
  assert.match(lens, /\n    continue-on-error: true\n    strategy:\n      fail-fast: false\n      matrix:\n        lens: \$\{\{ fromJSON\(needs\.prepare\.outputs\.lenses\) \}\}\n/);
  assert.match(lens, /\n    concurrency:\n      group: mcode-review-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ matrix\.lens \}\}\n      cancel-in-progress: false\n/);
  assert.match(lens, /\n          MCODE_REVIEW_LENS: \$\{\{ matrix\.lens \}\}\n/);
  assert.match(job('prepare'), /\n    outputs:\n      lenses: \$\{\{ steps\.prepare\.outputs\.lenses \}\}\n      quiz: \$\{\{ steps\.prepare\.outputs\.quiz \}\}\n/);
  assert.match(job('quiz'), /\n    needs: prepare\n    if: needs\.prepare\.outputs\.quiz == 'true'\n/);
  assert.match(job('quiz'), /\n    continue-on-error: true\n/);
  assert.match(job('publish'), /\n    needs: \[prepare, review, quiz\]\n    if: always\(\) && needs\.prepare\.result == 'success'\n/);
  assert.match(job('publish'), /\n    concurrency:\n      group: mcode-review-\$\{\{ github\.event\.pull_request\.number \}\}-publish\n      cancel-in-progress: false\n/);
});

test('the jobs use only official actions at a major version, download the plugin without a token, and call the subcommands review.mjs has', () => {
  const actions = new Set([...text.matchAll(/uses: (\S+)/g)].map((found) => found[1]));
  assert.deepEqual([...actions].sort(), ['actions/checkout@v4', 'actions/download-artifact@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4']);
  for (const name of ['prepare', 'grade']) {
    const download = steps(name).find((step) => step.startsWith('name: Download the plugin'));
    assert.ok(download, name);
    assert.match(download, /curl -fsSL --retry 3 -o \.mcode-review\/plugin\.tar\.gz "\$\{MCODE_REVIEW_PLUGIN_ARCHIVE_URL:-https:\/\/github\.com\/MiniMax-AI\/mcode-stack\/archive\/\$\{MCODE_REVIEW_PLUGIN_REF\}\.tar\.gz\}"/);
    assert.match(download, /mv \.mcode-review\/plugin-archive\/\*\/"\$\{MCODE_REVIEW_PLUGIN_PATH\}" \.mcode-review\/plugin/);
    assert.doesNotMatch(download, /-H |--header|Authorization|token/i);
  }
  const commands = Object.fromEntries(JOBS.map((name) => [name, [...job(name).matchAll(/node \.mcode-review\/plugin\/ci\/review\.mjs (\w+)/g)].map((found) => found[1])]));
  assert.deepEqual(commands, { prepare: ['prepare'], review: ['lens'], quiz: ['quiz'], publish: ['publish'], grade: ['grade'] });
  for (const command of Object.values(commands).flat()) assert.match(review, new RegExp('const commands = \\{[^}]*\\b' + command + '\\b'), command);
  for (const name of JOBS) assert.match(job(name), /\n    name: mcode-review:/, name);
});

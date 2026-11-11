import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ALL_LENSES } from '../core/triage.mjs';
import { TEMPLATE_VERSION } from '../core/util.mjs';

// The GitLab CI files projects copy and include. Read as text: the plugin has no
// YAML parser.
const text = readFileSync(new URL('../gitlab/review.gitlab-ci.yml', import.meta.url), 'utf8');
const dispatch = readFileSync(new URL('../gitlab/dispatch.gitlab-ci.yml', import.meta.url), 'utf8');
const review = readFileSync(new URL('../review.mjs', import.meta.url), 'utf8');
const host = readFileSync(new URL('../core/host.mjs', import.meta.url), 'utf8');

function block(name) {
  const start = text.indexOf('\n' + name + ':\n');
  assert.ok(start >= 0, name + ' is missing');
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n[^\s#]/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const JOBS = ['mcode-review:prepare', 'mcode-review:review', 'mcode-review:quiz', 'mcode-review:publish', 'mcode-review:grade'];

// A job's setting: its own value, or the one of .mcode-review:base, which every
// job extends.
function setting(job, key) {
  const pattern = new RegExp('\\n  ' + key + ': (.+)\\n');
  return (block(job).match(pattern) || block('.mcode-review:base').match(pattern) || [])[1];
}

// Projects include a copy of this template, so the checks of its job settings
// live here.
test('jobs that call a model get no secret environment; a newer push stops prepare and the quiz, not a direction, publish or grade', () => {
  for (const job of JOBS) assert.match(block(job), /\n  extends: \.mcode-review:base\n/, job);
  for (const job of ['mcode-review:review', 'mcode-review:quiz']) assert.doesNotMatch(block(job), /\n  environment:/, job + ' runs a model');
  for (const job of ['mcode-review:prepare', 'mcode-review:publish', 'mcode-review:grade']) assert.match(block(job), /\n  environment:\n    name: mcode-review\n/, job);
  assert.equal(setting('mcode-review:quiz', 'interruptible'), 'true', 'a newer push stops a quiz that is being written');
  assert.equal(setting('mcode-review:prepare', 'interruptible'), 'true');
  // A running review direction finishes: the next round of the PR waits for it
  // in the direction's resource group and reuses its result.
  assert.equal(setting('mcode-review:review', 'interruptible'), 'false');
  assert.equal(setting('mcode-review:review', 'resource_group'), "'mcode-review-$CI_MERGE_REQUEST_IID-$MCODE_REVIEW_LENS'");
  // publish and grade post to the PR before they write the state or the card;
  // a cancel in between would post the same notes again.
  for (const job of ['mcode-review:publish', 'mcode-review:grade']) assert.equal(setting(job, 'interruptible'), 'false', job);
  const matrix = block('mcode-review:review').match(/MCODE_REVIEW_LENS: \[([^\]]+)\]/);
  assert.deepEqual(matrix[1].split(',').map((lens) => lens.trim()), ALL_LENSES);
});

// The plugin is public: prepare, publish and grade download the archive of the
// pinned commit without a token, from GitHub or from MCODE_REVIEW_PLUGIN_ARCHIVE_URL.
// The jobs that call a model never download; they run the copy prepare passes on.
test('the plugin download sends no token, and jobs that call a model take the plugin from prepare instead', () => {
  const base = block('.mcode-review:base');
  assert.match(base, /curl -fsSL --retry 3 -o \.mcode-review\/plugin\.tar\.gz "\$\{MCODE_REVIEW_PLUGIN_ARCHIVE_URL:-https:\/\/github\.com\/MiniMax-AI\/mcode-stack\/archive\/\$\{MCODE_REVIEW_PLUGIN_REF\}\.tar\.gz\}"/);
  assert.match(base, /mv \.mcode-review\/plugin-archive\/\*\/"\$\{MCODE_REVIEW_PLUGIN_PATH\}" \.mcode-review\/plugin/);
  assert.doesNotMatch(text, /PRIVATE-TOKEN|--header|MCODE_REVIEW_GITLAB_TOKEN\}/, 'the download needs no credential');
  for (const job of ['mcode-review:prepare', 'mcode-review:publish', 'mcode-review:grade']) assert.doesNotMatch(block(job), /\n  before_script:/, job + ' downloads the plugin itself');
  for (const job of ['mcode-review:review', 'mcode-review:quiz']) {
    assert.match(block(job), /\n  before_script:\n    - cd "\$CI_PROJECT_DIR"\n  script:/, job + ' has no token to download with');
    assert.doesNotMatch(block(job), /MCODE_REVIEW_GITLAB_TOKEN|curl/, job);
    assert.match(block(job), /- job: mcode-review:prepare\n\s+artifacts: true\n/, job);
  }
  assert.match(block('mcode-review:prepare'), /\n    paths:\n(?:      - .+\n)*      - \.mcode-review\/plugin\/\n/);
  // The repository's notes from the merge base go to the jobs that call a model.
  assert.match(block('mcode-review:prepare'), /\n      - \.mcode-review\/repo-notes\.md\n/);
});

test('the quiz job always runs and decides from the plan; grading is a manual record of the answers', () => {
  assert.doesNotMatch(block('mcode-review:quiz'), /\n  rules:/);
  assert.match(block('mcode-review:publish'), /- job: mcode-review:quiz\n\s+artifacts: true\n  when: always\n/);
  assert.match(block('mcode-review:grade'), /\n  needs: \[\]\n  when: manual\n  allow_failure: true\n/);
  assert.doesNotMatch(text, /QUIZ_PUBLIC_KEY|QUIZ_KEY/);
});

// A project sets a few variables itself; the CI system, the workflow file and
// the template set the rest. A new variable the code requires would break every
// project that upgrades without setting it, so the required ones are pinned
// here, and the variables table of docs/pr-review.md marks the ones a project
// sets as required.
test('the code requires only the variables the docs list as required', () => {
  const required = (source, pattern) => [...new Set([...source.matchAll(pattern)].map((found) => found[1]))].sort();
  assert.deepEqual(required(review, /requiredEnv\('([A-Z0-9_]+)'\)/g), ['MCODE_REVIEW_API_KEY', 'MCODE_REVIEW_BASE_URL', 'MCODE_REVIEW_LENS']);
  // GitHub: GITHUB_REPOSITORY is set by Actions, the PR number and the token by the workflow file.
  assert.deepEqual(required(host, /(?:need|number)\('([A-Z0-9_]+)'\)/g), ['CI_API_V4_URL', 'CI_MERGE_REQUEST_IID', 'CI_PROJECT_ID', 'GITHUB_REPOSITORY', 'MCODE_REVIEW_GITHUB_TOKEN', 'MCODE_REVIEW_GITLAB_TOKEN', 'MCODE_REVIEW_PR']);
  const docs = readFileSync(new URL('../../docs/pr-review.md', import.meta.url), 'utf8');
  for (const name of ['MCODE_REVIEW_PLUGIN_REF', 'MCODE_REVIEW_API_KEY', 'MCODE_REVIEW_BASE_URL']) assert.match(docs, new RegExp('\\| \x60' + name + '\x60 \\|[^|\\n]*\\| yes \\|'), name);
  assert.match(docs, /\| \x60MCODE_REVIEW_GITLAB_TOKEN\x60 \|[^|\n]*\| GitLab only \|/);
});

test('the card uses the alias table from its CI variable', () => {
  assert.match(review, /aliases: parseEmailAliases\(env\('MCODE_REVIEW_FEISHU_EMAIL_ALIASES'\)\)/);
});

test('the template is generic: public image and registry, no host, chat, key or endpoint of one organisation', () => {
  assert.doesNotMatch(text, /oc_[0-9a-f]{8}|cli_[0-9a-f]{8}|MCowBQ|PRIVATE-TOKEN|CI_API_V4_URL|projects\/|binary_host_mirror/i);
  assert.equal(setting('.mcode-review:base', 'image'), 'node:22');
  const variables = block('variables');
  assert.match(variables, /\n  MCODE_REVIEW_MCODE_VERSION: '0\.7\.6'\n/);
  assert.match(variables, /\n  MCODE_REVIEW_NPM_REGISTRY: 'https:\/\/registry\.npmjs\.org\/'\n/);
  assert.match(variables, /\n  MCODE_REVIEW_PLUGIN_PATH: 'stacks\/jiachen'\n/);
  assert.match(variables, new RegExp("\\n  MCODE_REVIEW_TEMPLATE_VERSION: '" + TEMPLATE_VERSION + "'\\n"));
  assert.match(variables, /\n  MCODE_REVIEW_HOST: 'gitlab'\n/);
  // The model endpoint and the proxy are the project's own; no default here.
  assert.doesNotMatch(variables, /\n  (MCODE_REVIEW_BASE_URL|MCODE_REVIEW_HTTPS_PROXY|MCODE_REVIEW_API_KEY|MCODE_REVIEW_PLUGIN_REF):/);
  for (const url of text.match(/https?:\/\/[^\s'"}]+/g) || []) assert.match(url, /^https:\/\/(github\.com\/MiniMax-AI\/mcode-stack\/|registry\.npmjs\.org\/)/, url);
  assert.match(block('workflow'), /parent_pipeline/);
  const commands = [...text.matchAll(/node \.mcode-review\/plugin\/ci\/review\.mjs (\w[\w-]*)/g)].map((found) => found[1]);
  assert.deepEqual([...new Set(commands)].sort(), ['grade', 'lens', 'prepare', 'publish', 'quiz']);
  for (const command of commands) assert.match(review, new RegExp('const commands = \\{[^}]*\\b' + command + '\\b'), command);
});

// Projects paste the dispatch job into their .gitlab-ci.yml; this file is the
// one source of it.
test('the dispatch job pins the plugin commit, starts the project copy of the template, and lets a draft wait without holding the pipeline', () => {
  assert.match(dispatch, /^review:mcode-review:dispatch:\n/m);
  assert.match(dispatch, /\n  allow_failure: true\n/);
  assert.match(dispatch, /\n    MCODE_REVIEW_PLUGIN_REF: '<40-character commit of mcode-stack>'\n/);
  assert.match(dispatch, /\n      - local: '\.gitlab\/mcode-review\.gitlab-ci\.yml'\n/);
  assert.match(dispatch, /\n      yaml_variables: true\n/);
  assert.match(dispatch, /\n      pipeline_variables: false\n/);
  // A manual rule holds the pipeline unless it may fail.
  assert.ok(dispatch.includes("\n    - if: '$CI_PIPELINE_SOURCE == \"merge_request_event\" && $CI_MERGE_REQUEST_TITLE =~ /^\\s*(\\[draft\\]|\\(draft\\)|draft:)/i'\n      when: manual\n      allow_failure: true\n"));
  assert.ok(dispatch.includes("\n    - if: '$CI_PIPELINE_SOURCE == \"merge_request_event\"'\n"));
  // The template carries its own version and host; the child pipeline needs the commit.
  assert.doesNotMatch(dispatch, /MCODE_REVIEW_TEMPLATE_VERSION|MCODE_REVIEW_HOST|MCODE_REVIEW_PLUGIN_PATH/);
  assert.match(block('workflow'), /\$MCODE_REVIEW_PLUGIN_REF/);
  for (const url of dispatch.match(/https?:\/\/[^\s'"}]+/g) || []) assert.match(url, /^https:\/\/github\.com\/MiniMax-AI\/mcode-stack/, url);
});

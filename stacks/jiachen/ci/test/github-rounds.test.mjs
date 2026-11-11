// End-to-end review rounds on GitHub. The real prepare, lens and publish
// subcommands run as child processes against a throwaway repository, round
// after round, as the jobs of consecutive workflow runs of one PR do. Only the
// outside systems are fakes: the GitHub REST and GraphQL APIs (fake-github.mjs);
// the mcode binary, whose answers each round scripts; and origin, a local bare
// repository at the clean remote URL the pipeline sets, holding
// refs/pull/<n>/head.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractState, findingId, SUMMARY_MARKER } from '../core/state.mjs';
import { readJson, unpackJson } from '../core/util.mjs';
import { BOT_GRAPHQL, BOT_REST, COMMENT_LIMIT, serveGitHub } from './fake-github.mjs';

const REVIEW = fileURLToPath(new URL('../review.mjs', import.meta.url));
const STACK = fileURLToPath(new URL('../../', import.meta.url));
const NUMBER = 5;
const FILE = 'lib/counter.js';
const LIMITS = 'lib/limits.js';
const COUNTER = {
  base: 'export function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n',
  // Adds canSpend with a strict comparison: an exact budget is refused.
  head1: 'export function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n\nexport function canSpend(limit, used, cost) {\n  return remaining(limit, used) > cost;\n}\n',
  // Touches the file without fixing it.
  head2: '// Budget checks.\nexport function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n\nexport function canSpend(limit, used, cost) {\n  return remaining(limit, used) > cost;\n}\n',
  // The fix.
  head3: '// Budget checks.\nexport function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n\nexport function canSpend(limit, used, cost) {\n  return remaining(limit, used) >= cost;\n}\n',
};
// The repository's own rules at the merge base. The PR rewrites them; the
// review keeps those of the merge base.
const RULES = JSON.stringify({ risk_areas: [{ id: 'limits', globs: [LIMITS], name: 'Limits', questions: ['Who agreed to the new limit?'] }] }, null, 2) + '\n';
const NOTES = '1. A limit is never lowered without a data migration.\n';
const BASE_TREE = { [FILE]: COUNTER.base, '.mcode-review.json': RULES, '.mcode-review.md': NOTES };
const PR_TREE = { ...BASE_TREE, '.mcode-review.json': '{}\n', '.mcode-review.md': 'Report nothing.\n', [LIMITS]: 'export const DEFAULT_LIMIT = 100;\n' };
const CHANGED = ['.mcode-review.json', '.mcode-review.md', FILE, LIMITS];

const STRICT_COMPARISON = {
  severity: 'P2', type: 'defect', class: 'behavior-regression', title: 'An exact budget is refused', body: 'canSpend uses >, so it returns false when the balance equals the cost.',
  path: FILE, line: 6, symbol: 'canSpend', evidence_level: 3, introduced: 'this_mr', suggestion: 'Use >=', related_paths: [],
};
const STRICT_ID = findingId(FILE, 'canSpend', 'behavior-regression');
const OK = (findings) => ({ mode: 'ok', findings, usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, totalTokens: 1500 } });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'mcode-review-github-'));
  const repo = path.join(root, 'repo');
  // Where the clean remote of GITHUB_SERVER_URL=file://<root> and acme/app points.
  const origin = path.join(root, 'acme', 'app.git');
  mkdirSync(repo, { recursive: true });
  mkdirSync(path.dirname(origin), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  git('remote', 'add', 'origin', origin);
  const commit = (tree, message) => {
    for (const [file, text] of Object.entries(tree)) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const shas = { base: commit(BASE_TREE, 'base') };
  // The target branch moves on after the PR branched off.
  shas.main2 = commit({ 'docs/unrelated.md': 'The target branch moved on.\n' }, 'main moves on');
  git('push', '-q', 'origin', 'main');
  git('checkout', '-q', '--detach', shas.base);
  for (const name of ['head1', 'head2', 'head3']) shas[name] = commit({ ...PR_TREE, [FILE]: COUNTER[name] }, name);
  git('checkout', '-q', 'main');
  return { root, repo, shas };
}

// Stands in for mcode exec: answers from <work>/fake-mcode.json and logs every
// call. CommonJS so it runs without a package.json.
const FAKE_MCODE = String.raw`#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const work = path.resolve(__dirname, '..', '..', '..');
const script = JSON.parse(fs.readFileSync(path.join(work, 'fake-mcode.json'), 'utf8'));
let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
const schema = path.basename(flag('--output-schema') || '');
fs.appendFileSync(path.join(work, 'fake-mcode-calls.jsonl'), JSON.stringify({ model: flag('--model'), schema, prompt: input }) + '\n');
const answer = schema.startsWith('verify') ? { results: [] } : { summary: '', findings: script.findings || [], needs_human: script.needs_human || [], claims: [] };
fs.writeFileSync(flag('--output-last-message'), JSON.stringify(answer));
process.stdout.write(JSON.stringify({ type: 'exec.result', status: 'succeeded', usage: script.usage, usageSource: 'completed_responses', usageIncomplete: false }) + '\n');
`;

function installFakeMcode(repo, script) {
  const work = path.join(repo, '.mcode-review');
  const bin = path.join(work, 'npm', 'node_modules', '.bin', 'mcode');
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(bin, FAKE_MCODE);
  chmodSync(bin, 0o755);
  writeFileSync(path.join(work, 'fake-mcode.json'), JSON.stringify(script));
}

function review(command, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REVIEW, command], { cwd, env });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function setup(t) {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const github = await serveGitHub(t);
  github.db.mergeBase = fx.shas.base;
  github.db.files = CHANGED;
  // As the workflow sets them; the token only for prepare and publish (withToken).
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKSPACE: fx.repo,
    GITHUB_REPOSITORY: 'acme/app',
    GITHUB_SERVER_URL: 'file://' + fx.root,
    GITHUB_API_URL: github.url(),
    GITHUB_GRAPHQL_URL: github.url() + '/graphql',
    MCODE_REVIEW_PR: String(NUMBER),
    MCODE_REVIEW_API_KEY: 'model-key-for-tests',
    MCODE_REVIEW_BASE_URL: 'https://gateway.example/v1',
    MCODE_REVIEW_PLUGIN_REF: '0123456789abcdef0123456789abcdef01234567',
    MCODE_REVIEW_TEMPLATE_VERSION: '1',
  };
  return { ...fx, github, env, withToken: (extra = {}) => ({ ...env, MCODE_REVIEW_GITHUB_TOKEN: 'github-token-for-tests', ...extra }) };
}

// A push: the PR head ref on origin moves, and the PR API reports the new head.
// The target branch has moved on to main2 since the PR branched off at base.
function push(fx, head) {
  execFileSync('git', ['push', '-q', '-f', 'origin', fx.shas[head] + ':refs/pull/' + NUMBER + '/head'], { cwd: fx.repo });
  fx.github.db.pr = {
    number: NUMBER, title: 'feat: canSpend', body: '', html_url: 'https://github.example/acme/app/pull/' + NUMBER, draft: false, user: { login: 'dev', type: 'User' },
    head: { sha: fx.shas[head], ref: 'feat', repo: { full_name: 'acme/app' } }, base: { sha: fx.shas.main2, ref: 'main', repo: { full_name: 'acme/app' } },
  };
}

// One workflow run: prepare, the general lens, publish.
async function round(fx, { head, run, mcode, prepareEnv = {} }) {
  rmSync(path.join(fx.repo, '.mcode-review'), { recursive: true, force: true });
  push(fx, head);
  const outputs = path.join(fx.root, 'github-output-' + run);
  const runEnv = { GITHUB_RUN_ID: String(run), MCODE_REVIEW_HEAD_SHA: fx.shas[head] };
  const prepare = await review('prepare', fx.withToken({ ...runEnv, GITHUB_OUTPUT: outputs, ...prepareEnv }), fx.repo);
  assert.equal(prepare.code, 0, prepare.out);
  installFakeMcode(fx.repo, mcode);
  const lens = await review('lens', { ...fx.env, ...runEnv, MCODE_REVIEW_LENS: 'general' }, fx.repo);
  assert.equal(lens.code, 0, lens.out);
  const publish = await review('publish', fx.withToken(runEnv), fx.repo);
  assert.equal(publish.code, 0, publish.out);
  const work = path.join(fx.repo, '.mcode-review');
  const callLog = path.join(work, 'fake-mcode-calls.jsonl');
  return {
    prepare, lens, publish,
    outputs: readFileSync(outputs, 'utf8'),
    plan: readJson(path.join(work, 'plan.json')),
    calls: existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [],
  };
}

const THREAD_RE = /<!-- mcode-review:thread ([A-Za-z0-9+/=]+) -->/;
const metaOf = (thread) => unpackJson(thread.comments[0].body.match(THREAD_RE)[1]);
const threadOf = (fx, id) => fx.github.db.threads.find((thread) => metaOf(thread).id === id);
const summaries = (fx) => fx.github.db.comments.filter((comment) => comment.body.includes(SUMMARY_MARKER));
const graphqlCalls = (fx, pattern) => fx.github.db.calls.filter((call) => call.path === '/graphql' && pattern.test(call.body.query));

test('round 1 posts the summary, a line thread and file-level threads; a later round replies and resolves through GraphQL, and a returning problem reopens', async (t) => {
  const fx = await setup(t);
  const first = await round(fx, { head: 'head1', run: 101, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(first.outputs, 'lenses=["general"]\nquiz=false\n', 'the workflow starts one review job, and no quiz job');
  assert.equal(first.plan.host, 'github');
  assert.equal(first.plan.base_sha, fx.shas.base, 'the merge base, not the moved tip of the target');
  assert.deepEqual(first.plan.files.map((item) => item.path), CHANGED);
  assert.equal(first.plan.pipeline_url, 'file://' + fx.root + '/acme/app/actions/runs/101');
  assert.deepEqual(first.plan.plugin, { name: 'mcode-review', version: readJson(path.join(STACK, '.claude-plugin', 'plugin.json')).version, ref: '0123456789abcdef0123456789abcdef01234567', homepage: 'https://github.com/MiniMax-AI/mcode-stack/tree/main/stacks/jiachen' });

  // The rules of the merge base: the PR emptied .mcode-review.json and rewrote the notes.
  assert.deepEqual(first.plan.risk.map((hit) => hit.id), ['limits']);
  assert.equal(readFileSync(path.join(fx.repo, '.mcode-review', 'repo-notes.md'), 'utf8'), NOTES);
  assert.deepEqual(first.plan.instruction_files, [{ path: '.mcode-review.json', baseExists: true }, { path: '.mcode-review.md', baseExists: true }]);
  // The lens job restored them before the model ran, and the prompt points at the notes.
  assert.equal(readFileSync(path.join(fx.repo, '.mcode-review.json'), 'utf8'), RULES);
  assert.equal(readFileSync(path.join(fx.repo, '.mcode-review.md'), 'utf8'), NOTES);
  const prompt = first.calls.find((call) => call.schema === 'lens.schema.json').prompt;
  assert.match(prompt, /^You are the \*\*general\*\* reviewer \(general\) for pull request #5 on GitHub, in the MCode Review pipeline\./);
  assert.match(prompt, /Also read \x60\.mcode-review\/repo-notes\.md\x60/);
  // The model runs with a plugin of its own: the two skills CI uses, under the name the prompts give.
  const runtime = path.join(fx.repo, '.mcode-review', 'runtime-general', 'data', 'plugins', 'mcode-review');
  assert.equal(readJson(path.join(runtime, '.claude-plugin', 'plugin.json')).name, 'mcode-review');
  assert.deepEqual(readdirSync(path.join(runtime, 'skills')).sort(), ['pr-quiz', 'pr-review']);

  // One summary comment, as the bot: REST names it github-actions[bot].
  assert.equal(summaries(fx).length, 1);
  assert.equal(summaries(fx)[0].user.login, BOT_REST);
  // The finding on its line; the questions GitLab would open on the PR go on files.
  const finding = threadOf(fx, STRICT_ID);
  assert.deepEqual([finding.subjectType, finding.path, finding.line, finding.commit], ['LINE', FILE, 6, fx.shas.head1]);
  assert.equal(finding.comments[0].author.login, BOT_GRAPHQL, 'GraphQL names the bot without [bot]');
  const risk = threadOf(fx, 'NH-risk-limits');
  assert.deepEqual([risk.subjectType, risk.path], ['FILE', LIMITS], "on the question's first path");
  const description = threadOf(fx, 'NH-desc');
  assert.deepEqual([description.subjectType, description.path], ['FILE', CHANGED[0]], "a question without paths goes on the PR's first changed file");
  assert.equal(fx.github.db.threads.length, 3);
  assert.ok(summaries(fx)[0].body.includes('(https://github.example/acme/app/pull/5#discussion_r' + risk.comments[0].databaseId + ')'), 'the summary links each question to its thread');

  // Round 2: the fix. The bot replies in the finding's thread and resolves it.
  const second = await round(fx, { head: 'head3', run: 102, mcode: OK([]) });
  assert.equal(second.lens.code, 0);
  assert.equal(fx.github.db.threads.length, 3, 'the bot found its own threads: nothing posted twice');
  assert.equal(summaries(fx).length, 1, 'the summary comment is updated in place');
  assert.ok(fx.github.db.calls.some((call) => call.method === 'PATCH' && call.path === '/repos/acme/app/issues/comments/' + summaries(fx)[0].id));
  assert.equal(finding.isResolved, true);
  assert.match(finding.comments.at(-1).body, /^Not reported again in \x60[0-9a-f]{10}\x60, so it counts as fixed or no longer relevant\.$/);
  assert.ok(fx.github.db.calls.some((call) => call.method === 'POST' && call.path === '/repos/acme/app/pulls/5/comments/' + finding.comments[0].databaseId + '/replies'));
  assert.deepEqual(graphqlCalls(fx, /resolveReviewThread/).map((call) => call.body.variables.id), [finding.id]);
  assert.equal(risk.isResolved, false, 'the risk path is still touched');
  const state = extractState(summaries(fx)[0].body);
  assert.equal(state.round, 2);
  assert.deepEqual(state.history.map((entry) => [entry.pipeline, entry.tier, entry.lenses, entry.language]), [[101, 'M', ['general'], 'en'], [102, 'M', ['general'], 'en']]);

  // The author replies in the thread; then a force push brings the problem back.
  fx.github.db.replyAs(finding, 'Fixed with >=.', 'dev');
  await round(fx, { head: 'head1', run: 103, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(finding.isResolved, false, 'a thread the bot closed reopens');
  assert.match(finding.comments.at(-1).body, /^This problem is back in \x60[0-9a-f]{10}\x60\.$/);
  assert.deepEqual(graphqlCalls(fx, /unresolveReviewThread/).map((call) => call.body.variables.id), [finding.id]);
  assert.ok(graphqlCalls(fx, /node\(id/).length > 0, 'the third comment of a thread came from the next page');
  assert.ok(graphqlCalls(fx, /reviewThreads/).some((call) => call.body.variables.after), 'threads came in more than one page');
  assert.equal(fx.github.db.threads.length, 3);
});

test('a thread a person resolved is dismissed: never reopened, and the finding stops counting', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', run: 201, mcode: OK([STRICT_COMPARISON]) });
  const finding = threadOf(fx, STRICT_ID);
  fx.github.db.replyAs(finding, 'Intended: an exact budget means the account is empty.', 'alice');
  fx.github.db.resolveAs(finding, 'alice');
  await round(fx, { head: 'head2', run: 202, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(finding.isResolved, true);
  assert.deepEqual(finding.resolvedBy, { login: 'alice' });
  assert.equal(graphqlCalls(fx, /unresolveReviewThread/).length, 0);
  const body = summaries(fx)[0].body;
  assert.match(body, /### Dismissed\n- F-[0-9a-f]{6}: An exact budget is refused \(@alice closed the thread: Intended: an exact budget means the account is empty\.\)/);
  assert.doesNotMatch(body, /### Suggestions/);
});

test('the summary stays within the comment limit of GitHub: the stored state gives way first', async (t) => {
  const fx = await setup(t);
  // Forty findings with long bodies that do not compress.
  const findings = Array.from({ length: 40 }, (_, index) => ({ ...STRICT_COMPARISON, symbol: 'site' + index, title: 'Problem ' + index, body: randomBytes(2000).toString('hex') }));
  const result = await round(fx, { head: 'head1', run: 301, mcode: OK(findings) });
  const [summary] = summaries(fx);
  assert.ok(summary.body.length <= COMMENT_LIMIT, String(summary.body.length));
  assert.match(result.publish.out, /longer than a GitHub comment may be \(65,536 characters\); the stored state leaves out .*the long texts of the findings/);
  const state = extractState(summary.body);
  assert.equal(state.lenses.general.findings.length, 40, 'every finding id is kept for the next round');
  assert.equal(state.lenses.general.findings[0].body, undefined);
  assert.equal(state.history.length, 1);
});

test('prepare reads candidate rules from MCODE_REVIEW_PROFILE_FILE and MCODE_REVIEW_NOTES_FILE; a rule pack that does not parse leaves the bundled one', async (t) => {
  const fx = await setup(t);
  push(fx, 'head1');
  const work = path.join(fx.repo, '.mcode-review');
  const run = { GITHUB_RUN_ID: '401', MCODE_REVIEW_HEAD_SHA: fx.shas.head1 };
  const profileFile = path.join(fx.root, 'candidate.json');
  const notesFile = path.join(fx.root, 'candidate.md');
  writeFileSync(profileFile, JSON.stringify({ risk_areas: [{ id: 'counter', globs: [FILE], name: 'Counter', questions: ['Is the budget check right?'] }] }));
  writeFileSync(notesFile, '1. Candidate note.\n');
  const candidate = await review('prepare', fx.withToken({ ...run, MCODE_REVIEW_PROFILE_FILE: profileFile, MCODE_REVIEW_NOTES_FILE: notesFile }), fx.repo);
  assert.equal(candidate.code, 0, candidate.out);
  assert.deepEqual(readJson(path.join(work, 'plan.json')).risk.map((hit) => hit.id), ['counter']);
  assert.equal(readFileSync(path.join(work, 'repo-notes.md'), 'utf8'), '1. Candidate note.\n');
  writeFileSync(profileFile, '{ "risk_areas": [');
  const broken = await review('prepare', fx.withToken({ ...run, MCODE_REVIEW_PROFILE_FILE: profileFile }), fx.repo);
  assert.equal(broken.code, 0, broken.out);
  assert.match(broken.out, /candidate\.json does not parse \(.+\); using the bundled rule pack/);
  const plan = readJson(path.join(work, 'plan.json'));
  assert.deepEqual([plan.repo_profile, plan.risk], ['default', []]);
  assert.equal(readFileSync(path.join(work, 'repo-notes.md'), 'utf8'), NOTES, 'the notes still come from the merge base');
});

test('prepare stops when the workflow file is from another plugin version, says what to do, and posts nothing', async (t) => {
  const fx = await setup(t);
  push(fx, 'head1');
  for (const [version, said] of [[undefined, 'missing'], ['0', "'0'"]]) {
    const env = fx.withToken({ GITHUB_RUN_ID: '501', MCODE_REVIEW_HEAD_SHA: fx.shas.head1 });
    if (version === undefined) delete env.MCODE_REVIEW_TEMPLATE_VERSION;
    else env.MCODE_REVIEW_TEMPLATE_VERSION = version;
    const result = await review('prepare', env, fx.repo);
    assert.notEqual(result.code, 0);
    assert.ok(result.out.includes("your copy of stacks/jiachen/ci/github/mcode-review.yml is from another plugin version; copy it again from commit 0123456789abcdef0123456789abcdef01234567. Its MCODE_REVIEW_TEMPLATE_VERSION is " + said + "; this plugin needs '1'."), result.out);
    assert.doesNotMatch(result.out, /\n\s+at /, 'no stack trace');
  }
  assert.deepEqual(fx.github.db.calls, [], 'nothing was read or posted');
});

test('a run that a newer push overtook tells the workflow to start no review job', async (t) => {
  const fx = await setup(t);
  push(fx, 'head2');
  const outputs = path.join(fx.root, 'github-output');
  const result = await review('prepare', fx.withToken({ GITHUB_RUN_ID: '601', MCODE_REVIEW_HEAD_SHA: fx.shas.head1, GITHUB_OUTPUT: outputs }), fx.repo);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /PR head moved to [0-9a-f]{40}; this pipeline is superseded/);
  assert.equal(readFileSync(outputs, 'utf8'), 'lenses=[]\nquiz=false\n');
  assert.equal(readJson(path.join(fx.repo, '.mcode-review', 'plan.json')).superseded, true);
});

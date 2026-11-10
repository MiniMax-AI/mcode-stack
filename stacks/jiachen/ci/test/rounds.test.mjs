// End-to-end review rounds. The real prepare, lens and publish subcommands run
// as child processes against a throwaway git repository, round after round, the
// way consecutive pipelines of one PR do. Only the outside systems are fakes:
// the GitLab API, served from this process; the mcode binary, whose answers each
// round scripts; and origin, a local bare repository that holds the PR head ref.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pickArm } from '../core/arms.mjs';
import { providerIdFor } from '../core/mcode.mjs';
import { extractState, findingId, SUMMARY_MARKER } from '../core/state.mjs';
import { readThreadIndex } from '../core/threads.mjs';
import { readJson } from '../core/util.mjs';

const REVIEW = fileURLToPath(new URL('../review.mjs', import.meta.url));
const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODELS = new URL('../config/models.json', import.meta.url);
const BOT = 1000;
const AUTHOR = 7;
const IID = 5;
const FILE = 'lib/counter.js';
// Added by head1 and never touched again, so a later round can reuse its review.
const LIMITS = 'lib/limits.js';
const LIMITS_VERSIONS = { head2b: 'export const DEFAULT_LIMIT = 200;\n' };

const VERSIONS = {
  base: 'export function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n',
  // Adds canSpend with a strict comparison: an exact budget is refused.
  head1: 'export function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n\nexport function canSpend(limit, used, cost) {\n  return remaining(limit, used) > cost;\n}\n',
  // Touches the same file without fixing it.
  head2: '// Budget checks.\nexport function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n\nexport function canSpend(limit, used, cost) {\n  return remaining(limit, used) > cost;\n}\n',
  // The same counter.js as head2; only lib/limits.js changes.
  head2b: '// Budget checks.\nexport function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n\nexport function canSpend(limit, used, cost) {\n  return remaining(limit, used) > cost;\n}\n',
  // The fix.
  head3: '// Budget checks.\nexport function remaining(limit, used) {\n  return Math.max(0, limit - used);\n}\n\nexport function canSpend(limit, used, cost) {\n  return remaining(limit, used) >= cost;\n}\n',
};

const STRICT_COMPARISON = {
  severity: 'P2', type: 'defect', class: 'behavior-regression', title: 'An exact budget is refused', body: 'canSpend uses >, so it returns false when the balance equals the cost.',
  path: FILE, line: 6, symbol: 'canSpend', evidence_level: 3, introduced: 'this_mr', suggestion: 'Use >=', related_paths: [],
};
// The same finding as a model writes it when the prompt asks for Simplified Chinese.
const STRICT_COMPARISON_ZH = { ...STRICT_COMPARISON, title: '余额恰好够用时被拒绝', body: 'canSpend 用了 >，余额等于成本时返回 false。', suggestion: '改回 >=' };
const STRICT_ID = findingId(FILE, 'canSpend', 'behavior-regression');

function fixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'mcode-review-rounds-'));
  const repo = path.join(root, 'repo');
  const origin = path.join(root, 'origin.git');
  mkdirSync(path.join(repo, 'lib'), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  git('remote', 'add', 'origin', origin);
  const shas = {};
  for (const [name, content] of Object.entries(VERSIONS)) {
    writeFileSync(path.join(repo, FILE), content);
    if (name !== 'base') writeFileSync(path.join(repo, LIMITS), LIMITS_VERSIONS[name] || 'export const DEFAULT_LIMIT = 100;\n');
    git('add', 'lib');
    git('commit', '-q', '-m', name);
    shas[name] = git('rev-parse', 'HEAD');
  }
  git('push', '-q', 'origin', 'main');
  return { root, repo, shas };
}

// The parts of the GitLab API the review uses, with notes and discussions kept
// in memory across rounds.
function fakeGitLab() {
  const db = { mr: null, notes: [], discussions: [], calls: [], mrPipelines: [], children: {}, jobs: [], artifacts: {}, artifactReads: [] };
  let seq = 1000;
  const note = (body, extra = {}) => ({ id: ++seq, body, author: { id: BOT, username: 'review-bot' }, system: false, resolvable: false, resolved: false, resolved_by: null, created_at: new Date().toISOString(), ...extra });
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const body = raw ? JSON.parse(raw) : null;
      db.calls.push({ method: req.method, path: url.pathname, search: url.search, body });
      const reply = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const route = url.pathname.replace(/^\/api\/v4/, '');
      const list = (items) => reply(200, Number(url.searchParams.get('page') || '1') === 1 ? items : []);
      const thread = (id) => db.discussions.find((discussion) => discussion.id === id);
      let match;
      if (route === '/user') return reply(200, { id: BOT, username: 'review-bot' });
      if ((match = route.match(/^\/projects\/[^/]+\/pipelines\/(\d+)\/bridges$/))) {
        const child = db.children[match[1]];
        return reply(200, child ? [{ name: 'review:mcode-review:dispatch', downstream_pipeline: { id: child } }] : []);
      }
      if ((match = route.match(/^\/projects\/[^/]+\/pipelines\/(\d+)\/jobs$/))) return reply(200, db.jobs.filter((job) => job.pipeline === Number(match[1])));
      if ((match = route.match(/^\/projects\/[^/]+\/jobs\/(\d+)\/artifacts\/(.+)$/))) {
        db.artifactReads.push({ job: Number(match[1]), jobToken: req.headers['job-token'] || null, privateToken: req.headers['private-token'] || null });
        const content = db.artifacts[match[1] + ':' + decodeURIComponent(match[2])];
        return content ? reply(200, content) : reply(404, { message: '404 Not found' });
      }
      const scoped = route.match(/^\/projects\/[^/]+\/merge_requests\/\d+(\/.*)?$/);
      if (!scoped) return reply(404, { message: 'not faked: ' + route });
      const rest = scoped[1] || '';
      if (req.method === 'GET' && rest === '') return reply(200, db.mr);
      if (req.method === 'GET' && rest === '/pipelines') return reply(200, db.mrPipelines);
      if (req.method === 'GET' && rest === '/notes') return list(db.notes);
      if (req.method === 'POST' && rest === '/notes') {
        const created = note(body.body);
        db.notes.push(created);
        return reply(201, created);
      }
      if (req.method === 'PUT' && (match = rest.match(/^\/notes\/(\d+)$/))) {
        const existing = db.notes.find((item) => item.id === Number(match[1]));
        existing.body = body.body;
        return reply(200, existing);
      }
      if (req.method === 'GET' && rest === '/discussions') return list(db.discussions);
      if (req.method === 'POST' && rest === '/discussions') {
        const discussion = { id: 'd' + (++seq), notes: [note(body.body, { resolvable: true })] };
        db.discussions.push(discussion);
        return reply(201, discussion);
      }
      if (req.method === 'POST' && (match = rest.match(/^\/discussions\/([^/]+)\/notes$/))) {
        const discussion = thread(match[1]);
        const created = note(body.body, { resolvable: true, resolved: discussion.notes[0].resolved, resolved_by: discussion.notes[0].resolved_by });
        discussion.notes.push(created);
        return reply(201, created);
      }
      if (req.method === 'PUT' && (match = rest.match(/^\/discussions\/([^/]+)$/))) {
        const discussion = thread(match[1]);
        const resolved = url.searchParams.get('resolved') === 'true';
        for (const item of discussion.notes) Object.assign(item, { resolved, resolved_by: resolved ? { id: BOT, username: 'review-bot' } : null });
        return reply(200, discussion);
      }
      if (req.method === 'GET' && (match = rest.match(/^\/discussions\/([^/]+)$/))) return reply(200, thread(match[1]));
      return reply(404, { message: 'not faked: ' + req.method + ' ' + route });
    });
  });
  return { db, server };
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
const session = flag('--session');
fs.appendFileSync(path.join(work, 'fake-mcode-calls.jsonl'), JSON.stringify({ model: flag('--model'), schema, session, prompt: input }) + '\n');
if (script.mode === 'fail') {
  process.stdout.write(JSON.stringify({ type: 'exec.result', status: 'failed', error: { message: 'BYOK provider custom_provider:mcode-review upstream error: API error (529): 529 no eligible account' }, usageSource: 'unavailable', usageIncomplete: true }) + '\n');
  process.exit(4);
}
// mcode's answer when the reply is not the JSON the schema asks for: the run
// fails, and only a call that continues its session answers properly.
if (script.mode === 'invalid-json-once' && !session) {
  process.stdout.write(JSON.stringify({ type: 'exec.result', status: 'failed', sessionId: 'session-1', error: { category: 'runtime', code: 'STRUCTURED_OUTPUT_INVALID', message: script.errorMessage || 'Structured output was not valid JSON.', retryable: true }, usage: script.usage, usageSource: 'completed_responses', usageIncomplete: false }) + '\n');
  process.exit(4);
}
// mcode's answer when the run reaches its timeout: the session keeps the work,
// and only a call that continues it answers.
if (script.mode === 'timeout-once' && !session) {
  process.stdout.write(JSON.stringify({ type: 'exec.result', status: 'timeout', sessionId: 'session-1', error: { category: 'runtime', code: 'TIMEOUT', message: 'The run timed out. Increase --timeout or retry.' }, usage: script.usage, usageSource: 'completed_responses', usageIncomplete: true }) + '\n');
  process.exit(4);
}
const answer = schema.startsWith('verify') ? { results: [] } : { summary: '', findings: script.findings || [], needs_human: script.needs_human || [], claims: script.claims || [] };
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

function review(command, env, cwd, script = REVIEW) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, command], { cwd, env });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function setup(t) {
  const { root, repo, shas } = fixtureRepo();
  const gitlab = fakeGitLab();
  await new Promise((resolve) => gitlab.server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    gitlab.server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    CI_PROJECT_DIR: repo,
    CI_API_V4_URL: 'http://127.0.0.1:' + gitlab.server.address().port + '/api/v4',
    CI_PROJECT_ID: '1',
    CI_MERGE_REQUEST_IID: String(IID),
    MCODE_REVIEW_GITLAB_TOKEN: 'gitlab-token-for-tests',
    MCODE_REVIEW_API_KEY: 'model-key-for-tests',
    MCODE_REVIEW_BASE_URL: 'https://gateway.example/v1',
    MCODE_REVIEW_LENS: 'general',
    MCODE_REVIEW_PLUGIN_REF: '0123456789abcdef0123456789abcdef01234567',
    MCODE_REVIEW_TEMPLATE_VERSION: '1',
    MCODE_REVIEW_HOST: 'gitlab',
    CI_JOB_TOKEN: 'job-token-for-tests',
  };
  return { repo, shas, gitlab, env };
}

// What a push changes outside the pipeline: the PR head ref on origin moves, and
// the merge request API reports the new head.
function push(fx, head) {
  execFileSync('git', ['push', '-q', '-f', 'origin', fx.shas[head] + ':refs/merge-requests/' + IID + '/head'], { cwd: fx.repo });
  fx.gitlab.db.mr = {
    iid: IID, sha: fx.shas[head], title: 'feat: canSpend', description: '', web_url: 'https://gitlab.example/g/p/-/merge_requests/' + IID,
    author: { id: AUTHOR, username: 'dev' }, source_branch: 'feat', target_branch: 'main', draft: false,
    diff_refs: { base_sha: fx.shas.base, start_sha: fx.shas.base, head_sha: fx.shas[head] },
  };
}

// A lens job of an earlier round that finished but never published, as the
// GitLab API lists it, with its result file as an artifact.
function finishedLensJob(fx, { parent, child, job, output }) {
  fx.gitlab.db.mrPipelines.unshift({ id: parent });
  fx.gitlab.db.children[parent] = child;
  fx.gitlab.db.jobs.push({ id: job, name: 'mcode-review:review: [general]', status: 'success', pipeline: child });
  fx.gitlab.db.artifacts[job + ':.mcode-review/out/lens-general.json'] = output;
}

// One pipeline: prepare, the lens (unless its job died without output), publish.
// A push can land between the steps, as it does in CI.
// script: the review.mjs to run, by default this plugin's (see pluginWithModels).
// prepareEnv: variables only prepare sees; laterEnv: only the jobs after it.
async function round(fx, { head, pipeline, mcode, lens = true, pushBeforeLens, pushBeforePublish, script = REVIEW, prepareEnv = {}, laterEnv = {} }) {
  rmSync(path.join(fx.repo, '.mcode-review'), { recursive: true, force: true });
  push(fx, head);
  const env = { ...fx.env, CI_PIPELINE_ID: String(pipeline), CI_COMMIT_SHA: fx.shas[head], ...laterEnv };
  const prepare = await review('prepare', { ...env, ...prepareEnv }, fx.repo, script);
  assert.equal(prepare.code, 0, prepare.out);
  installFakeMcode(fx.repo, mcode);
  if (pushBeforeLens) push(fx, pushBeforeLens);
  const lensRun = lens ? await review('lens', env, fx.repo, script) : null;
  if (pushBeforePublish) push(fx, pushBeforePublish);
  const publish = await review('publish', env, fx.repo, script);
  assert.equal(publish.code, 0, publish.out);
  const lensOutput = path.join(fx.repo, '.mcode-review', 'out', 'lens-general.json');
  const callLog = path.join(fx.repo, '.mcode-review', 'fake-mcode-calls.jsonl');
  const calls = existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const plan = JSON.parse(readFileSync(path.join(fx.repo, '.mcode-review', 'plan.json'), 'utf8'));
  return { prepare, lens: lensRun, publish, calls, plan, lensOutput: existsSync(lensOutput) ? JSON.parse(readFileSync(lensOutput, 'utf8')) : null };
}

// A copy of the plugin with another models.json, for settings the shipped
// config leaves off. Returns the copy's review.mjs.
function pluginWithModels(t, models) {
  const root = mkdtempSync(path.join(tmpdir(), 'mcode-review-plugin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const part of ['.claude-plugin', 'ci', 'skills']) cpSync(path.join(PLUGIN_ROOT, part), path.join(root, part), { recursive: true, filter: (src) => !src.slice(PLUGIN_ROOT.length).split(path.sep).includes('test') });
  writeFileSync(path.join(root, 'ci', 'config', 'models.json'), JSON.stringify(models, null, 2));
  return path.join(root, 'ci', 'review.mjs');
}

const threads = (fx) => readThreadIndex(fx.gitlab.db.discussions, BOT);
const summaryBody = (fx) => fx.gitlab.db.notes.find((item) => item.body.includes(SUMMARY_MARKER))?.body || '';
const OK = (findings, usage = { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, totalTokens: 1500 }) => ({ mode: 'ok', findings, usage });

test('a lens whose model call failed leaves the findings it could not re-check open', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(threads(fx).get(STRICT_ID)?.resolved, false, 'round 1 opens a thread for the finding');

  await round(fx, { head: 'head2', pipeline: 102, mcode: { mode: 'fail' } });
  const thread = threads(fx).get(STRICT_ID);
  assert.equal(thread.resolved, false, 'nothing re-checked the finding, so its thread must stay open');
  assert.ok(extractState(summaryBody(fx)).lenses.general.findings.some((finding) => finding.id === STRICT_ID));
});

test('a lens job that left no output leaves the findings open too', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  await round(fx, { head: 'head2', pipeline: 102, mcode: OK([]), lens: false });
  assert.equal(threads(fx).get(STRICT_ID).resolved, false);
});

test('a lens that ran on the changed file and did not report the finding again closes it', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  await round(fx, { head: 'head3', pipeline: 102, mcode: OK([]) });
  const thread = threads(fx).get(STRICT_ID);
  assert.equal(thread.resolved, true);
  assert.equal(thread.resolvedByBot, true);
  const discussion = fx.gitlab.db.discussions.find((item) => item.id === thread.discussionId);
  assert.match(discussion.notes.at(-1).body, /^Not reported again in \x60[0-9a-f]{10}\x60, so it counts as fixed or no longer relevant\.$/);
});

test('a failed model call fails the lens job, so the pipeline shows it', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: { mode: 'fail' } });
  assert.notEqual(result.lens.code, 0, result.lens.out);
  assert.match(result.lens.out, /continue locally: install the pr-review skill .*ask MiniMax Code: Review the current branch with pr-review, target branch main/);
  assert.equal(result.lensOutput.status, 'failed', 'the result file is still written for publish');
});

test('an answer that is not valid JSON is asked for again in the same session instead of failing the lens', async (t) => {
  const fx = await setup(t);
  const config = readJson(MODELS);
  const first = (pickArm(config.arms, IID)?.lens || config.roles.lens.chain)[0];
  const model = 'custom_provider:' + providerIdFor(config, first) + '/' + first;
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: { mode: 'invalid-json-once', findings: [STRICT_COMPARISON], usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, totalTokens: 1500 } } });
  assert.equal(result.lens.code, 0, result.lens.out);
  assert.equal(result.lensOutput.status, 'complete');
  assert.deepEqual(result.lensOutput.findings.map((finding) => finding.id), [STRICT_ID]);
  const hunts = result.calls.filter((call) => call.schema === 'lens.schema.json');
  assert.deepEqual(hunts.map((call) => [call.model, call.session]), [[model, ''], [model, 'session-1']], 'the same model is asked again in its own session');
  assert.deepEqual(result.lensOutput.stats.hunt.attempts.map((attempt) => [attempt.ok, Boolean(attempt.repair)]), [[false, false], [true, true]]);
  assert.match(result.lens.out, /Asking again in the same session/);
});

// mcode validates the answer against the schema but does not show the schema to
// the model, so the prompt carries it, with the time the pass has.
test('the lens prompt carries the answer schema and the time the pass has', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  const [hunt] = result.calls.filter((call) => call.schema === 'lens.schema.json');
  assert.ok(hunt.prompt.includes(JSON.stringify(readJson(new URL('../schema/lens.schema.json', import.meta.url)))), 'the whole schema');
  assert.match(hunt.prompt, /You have about \d+ minutes for this pass/);
});

// A model that runs out of time has usually done most of the review, and its
// session keeps it. Asked once in that session, it answers from what it has
// checked. That answer is posted, but nobody knows which files the model got
// to: it closes no thread, is not kept for reuse, and the round is unfinished.
test('a lens that ran out of time posts what it found, closes nothing and leaves the round unfinished', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(threads(fx).get(STRICT_ID)?.resolved, false);
  const before = extractState(summaryBody(fx));
  // head3 fixes the problem: a finished pass that did not report it would close its thread.
  const result = await round(fx, { head: 'head3', pipeline: 102, mcode: { mode: 'timeout-once', findings: [] } });
  assert.notEqual(result.lens.code, 0, 'the job fails, as it is allowed to, so the pipeline shows the gap');
  assert.equal(result.lensOutput.status, 'partial');
  const hunts = result.calls.filter((call) => call.schema === 'lens.schema.json');
  assert.deepEqual(hunts.map((call) => call.session), ['', 'session-1'], 'asked once more in its own session');
  assert.match(hunts[1].prompt, /^Your time for this task is up/);
  assert.ok(hunts[1].prompt.includes('"required"'), 'the request carries the schema');
  assert.deepEqual(result.lensOutput.stats.hunt.attempts.map((attempt) => [attempt.ok, Boolean(attempt.salvage)]), [[false, false], [true, true]]);
  assert.equal(threads(fx).get(STRICT_ID).resolved, false, 'a partial pass closes no thread');
  const state = extractState(summaryBody(fx));
  assert.equal(state.lenses.general.head_sha, fx.shas.head1, 'the last finished review stays the one to reuse');
  assert.equal(state.round, before.round, 'an unfinished round does not count');
  assert.notEqual(state.last_verdict, 'pass');
  assert.match(summaryBody(fx), /ran out of time/);
});

test('the findings of a pass that ran out of time get threads', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: { mode: 'timeout-once', findings: [STRICT_COMPARISON] } });
  assert.equal(result.lensOutput.status, 'partial');
  assert.equal(threads(fx).get(STRICT_ID)?.resolved, false);
  assert.equal(extractState(summaryBody(fx)).lenses.general, undefined, 'nothing to reuse next round');
});

// A model fixes what it is told about. A model that was shown only the start of
// a long validation message fixed its findings on the second try but not its
// needs_human item, whose schema errors came after the first few hundred
// characters of the message.
test('the repair request quotes the whole validation message, not just its start', async (t) => {
  const fx = await setup(t);
  const errors = Array.from({ length: 30 }, (_, i) => "data/findings/" + i + " must have required property 'evidence_level'");
  const message = 'Structured output did not match --output-schema: ' + [...errors, "data/needs_human/0 must have required property 'kind'"].join('; ');
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: { mode: 'invalid-json-once', errorMessage: message, findings: [STRICT_COMPARISON] } });
  const repair = result.calls.find((call) => call.schema === 'lens.schema.json' && call.session);
  assert.ok(repair, 'the model is asked again in its session');
  assert.ok(message.length > 1500);
  assert.ok(repair.prompt.includes(message), 'the whole message reaches the model');
  assert.equal(result.lensOutput.status, 'complete');
});

test('an unexpected value in one field keeps the rest of the answer', async (t) => {
  const fx = await setup(t);
  const odd = { ...STRICT_COMPARISON, severity: 'p1', class: 'made-up-class', type: 'bug' };
  const needsHuman = [{ kind: 'release_plan', title: 'Release order', why: 'Two services ship together', questions: ['Which ships first?'], paths: [] }];
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: { mode: 'ok', findings: [odd], needs_human: needsHuman, claims: [{ claim: 'Behavior unchanged', status: 'partly', evidence: 'e' }] } });
  assert.equal(result.lens.code, 0, result.lens.out);
  const [finding] = result.lensOutput.findings;
  assert.equal(finding.severity, 'P1', 'a lower-case severity is still that severity');
  assert.equal(finding.class, 'other');
  assert.equal(finding.type, 'defect');
  assert.equal(finding.id, findingId(FILE, 'canSpend', 'other'));
  assert.equal(result.lensOutput.needs_human[0].kind, 'other');
  assert.equal(result.lensOutput.claims[0].status, 'unverified');
  assert.match(result.lens.out, /unexpected class "made-up-class" in the model answer; using other/);
});

// "Found late" means the lens had already reviewed that code and missed the
// problem. A round whose model calls all failed reviewed nothing, so it is no
// baseline: otherwise, when a repository's first rounds fail, its first real
// finding is folded away as an old issue, without a thread.
test('a finding is not called found late when its lens never finished reviewing the earlier version', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: { mode: 'fail' } });
  await round(fx, { head: 'head2', pipeline: 102, mcode: OK([STRICT_COMPARISON]) });
  assert.doesNotMatch(summaryBody(fx), /Old issues/);
  assert.equal(threads(fx).get(STRICT_ID)?.resolved, false, 'the finding gets its own thread');
});

test('a finding on a line its lens already reviewed is found late', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: OK([]) });
  await round(fx, { head: 'head2', pipeline: 102, mcode: OK([STRICT_COMPARISON]) });
  assert.match(summaryBody(fx), new RegExp('Old issues: 1, [\\s\\S]*' + STRICT_ID));
  assert.equal(threads(fx).has(STRICT_ID), false, 'an old P2 is listed in the summary, not opened as a thread');
});

test('token usage of every model call is recorded and shown in the summary', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON], { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, totalTokens: 1500 }) });
  assert.deepEqual(result.lensOutput.stats.hunt.usage, { input: 1200, output: 300, cache_read: 800 });
  assert.match(summaryBody(fx), /\| Tokens \| input 1,200, output 300, cache read 800 \|/);
  const history = extractState(summaryBody(fx)).history.at(-1);
  assert.deepEqual(history.usage, { input: 1200, output: 300, cache_read: 800 });
});

test('without arms every PR is reviewed by the first model of the lens chain, and no arm is recorded', async (t) => {
  const fx = await setup(t);
  const config = readJson(MODELS);
  assert.equal(pickArm(config.arms, IID), null, 'the shipped config has no arms');
  const first = config.roles.lens.chain[0];
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(result.calls[0].model, 'custom_provider:' + providerIdFor(config, first) + '/' + first);
  assert.equal(result.lensOutput.arm, null);
  assert.doesNotMatch(summaryBody(fx), /Model arm/);
  assert.equal(extractState(summaryBody(fx)).history.at(-1).arm, undefined);
});

test('each PR is reviewed by the model arm its number picks, and the summary and history say which', async (t) => {
  const fx = await setup(t);
  const shipped = readJson(MODELS);
  const one = Object.keys(shipped.models)[0];
  const models = {
    ...shipped,
    models: { ...shipped.models, 'model-b': { api: 'openai-responses', context: 200000, output: 64000, efforts: ['high'] } },
    arms: [
      { id: 'one+b', weight: 1, lens: [one, 'model-b'], verify: ['model-b', one] },
      { id: 'b+one', weight: 1, lens: ['model-b', one], verify: [one, 'model-b'] },
    ],
  };
  const script = pluginWithModels(t, models);
  const arm = pickArm(models.arms, IID);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]), script });
  assert.equal(result.calls[0].model, 'custom_provider:' + providerIdFor(models, arm.lens[0]) + '/' + arm.lens[0]);
  assert.equal(result.lensOutput.arm, arm.id);
  assert.ok(summaryBody(fx).includes('| Model arm | ' + arm.id + ': finds with ' + arm.lens[0] + ', checks with ' + arm.verify[0] + ' |'));
  assert.equal(extractState(summaryBody(fx)).history.at(-1).arm, arm.id);
});

test('an unfinished review is said in the summary, not opened as a thread', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: { mode: 'fail' } });
  assert.equal(threads(fx).has('NH-incomplete'), false);
  assert.match(summaryBody(fx), /⚠️ 1 direction did not finish this round: general \(/);
  assert.match(summaryBody(fx), /ask MiniMax Code "Review the current branch with pr-review, target branch main"/);
  assert.doesNotMatch(summaryBody(fx), /✅ Pass/, 'a review that did not run cannot pass');
});

test('a round that a newer push overtook skips its lens without calling a model', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]), pushBeforeLens: 'head2' });
  assert.equal(result.lens.code, 0, result.lens.out);
  assert.equal(result.lensOutput.status, 'superseded');
  assert.match(result.lens.out, /PR head moved past/);
  assert.deepEqual(result.calls, [], 'no model was called');
  assert.match(result.publish.out, /not publishing/);
});

test("a new round reuses what an overtaken round's lens finished and reviews only the files changed since", async (t) => {
  const fx = await setup(t);
  // Round 1's lens finishes, but a push lands before its publish: nothing is published.
  const first = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]), pushBeforePublish: 'head2' });
  assert.equal(first.lensOutput.status, 'complete');
  assert.equal(summaryBody(fx), '', 'round 1 published nothing');
  finishedLensJob(fx, { parent: 1001, child: 101, job: 9001, output: first.lensOutput });

  const second = await round(fx, { head: 'head2', pipeline: 102, mcode: OK([STRICT_COMPARISON]) });
  assert.deepEqual(second.lensOutput.reused_from, [9001]);
  assert.deepEqual(second.lensOutput.review_files, [FILE], 'only the file changed since round 1 is reviewed');
  assert.equal(second.lensOutput.reused_files, 1);
  assert.deepEqual(fx.gitlab.db.artifactReads.map((read) => [read.job, read.jobToken, read.privateToken]), [[9001, 'job-token-for-tests', null]], 'the lens job reads with the CI job token');
  assert.equal(threads(fx).get(STRICT_ID)?.resolved, false);
});

test('a finding closes when a later round that never published reviewed its file again and did not report it', async (t) => {
  const fx = await setup(t);
  await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(threads(fx).get(STRICT_ID).resolved, false);
  // Round 2 reviews lib/counter.js again and no longer reports the finding, but a push overtakes it before publish.
  const second = await round(fx, { head: 'head2', pipeline: 102, mcode: OK([]), pushBeforePublish: 'head2b' });
  assert.deepEqual(second.lensOutput.review_files, [FILE]);
  finishedLensJob(fx, { parent: 1002, child: 102, job: 9002, output: second.lensOutput });
  // Round 3 changed only lib/limits.js; lib/counter.js keeps round 2's result.
  const third = await round(fx, { head: 'head2b', pipeline: 103, mcode: OK([]) });
  assert.deepEqual(third.lensOutput.review_files, [LIMITS]);
  assert.deepEqual(third.lensOutput.reused_from, [9002]);
  const thread = threads(fx).get(STRICT_ID);
  assert.equal(thread.resolved, true, 'round 2 reviewed the file again after the finding was published');
  assert.equal(thread.resolvedByBot, true);
});

// English is the default: everything above runs without MCODE_REVIEW_LANGUAGE.
test('the summary, threads and prompts are in English by default', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON]) });
  assert.equal(result.plan.language, 'en');
  assert.match(summaryBody(fx), /^<!-- mcode-review:summary -->\n## MCode Review: ✅ Pass \(shadow phase: comments only, does not block merging\)\n\n0 blocking, 0 for a person, 1 suggestion\.\n/);
  assert.match(fx.gitlab.db.discussions[0].notes[0].body, /^\*\*\[P2·defect\] An exact budget is refused\*\* \(general, F-[0-9a-f]{6}\)\n/);
  const prompt = result.calls.find((call) => call.schema === 'lens.schema.json').prompt;
  assert.match(prompt, /You are the \*\*general\*\* reviewer \(general\)/);
  assert.match(prompt, /needs_human text, claims\) in English\./);
  assert.doesNotMatch(summaryBody(fx).replace(/<!--[\s\S]*?-->/g, ''), /[\u3400-\u9fff]/);
});

// prepare resolves the language once; the later jobs of the pipeline read it
// from the plan, even when their own variable says otherwise.
test('MCODE_REVIEW_LANGUAGE zh: every job of the pipeline posts in Chinese, as prepare decided', async (t) => {
  const fx = await setup(t);
  const zh = { prepareEnv: { MCODE_REVIEW_LANGUAGE: 'zh-CN' }, laterEnv: { MCODE_REVIEW_LANGUAGE: 'en' } };
  const first = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([STRICT_COMPARISON_ZH]), ...zh });
  assert.equal(first.plan.language, 'zh');
  assert.match(summaryBody(fx), /^<!-- mcode-review:summary -->\n## MCode Review：✅ 通过（影子期：只评论，不阻塞合入）\n\n0 个阻塞、0 个需人工确认、1 个建议。\n\n审查对象 \x60[0-9a-f]{10}\x60，第 1 轮，S 档。/);
  assert.match(summaryBody(fx), /\| token \| 输入 1,200，输出 300，缓存读取 800 \|/);
  const thread = threads(fx).get(STRICT_ID);
  const discussion = () => fx.gitlab.db.discussions.find((item) => item.id === thread.discussionId);
  assert.match(discussion().notes[0].body, /^\*\*\[P2·缺陷\] 余额恰好够用时被拒绝\*\*（综合，F-[0-9a-f]{6}）\n\ncanSpend 用了 >/);
  assert.match(discussion().notes[0].body, /<sub>证据等级 3。不同意的话，在这里回复理由并 resolve，之后不会再重开。<\/sub>/);
  const prompt = first.calls.find((call) => call.schema === 'lens.schema.json').prompt;
  assert.match(prompt, /You are the \*\*general\*\* reviewer \(综合\)/);
  assert.match(prompt, /needs_human text, claims\) in Simplified Chinese\./);
  // The fix: the bot closes the thread with a Chinese reply.
  await round(fx, { head: 'head3', pipeline: 102, mcode: OK([]), ...zh });
  assert.equal(threads(fx).get(STRICT_ID).resolved, true);
  assert.match(discussion().notes.at(-1).body, /^在 \x60[0-9a-f]{10}\x60 上没有再报出，判定为已修复或不再适用。$/);
});

test('an unknown MCODE_REVIEW_LANGUAGE falls back to English and says so once in the log', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, { head: 'head1', pipeline: 101, mcode: OK([]), prepareEnv: { MCODE_REVIEW_LANGUAGE: 'klingon' } });
  assert.equal(result.plan.language, 'en');
  assert.equal(result.prepare.out.match(/MCODE_REVIEW_LANGUAGE is "klingon", which is not en or zh; using en/g)?.length, 1, result.prepare.out);
  assert.match(summaryBody(fx), /## MCode Review: ✅ Pass/);
});

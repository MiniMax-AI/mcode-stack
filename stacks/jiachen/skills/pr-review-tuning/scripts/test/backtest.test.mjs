import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { backtest, usageOf } from '../backtest.mjs';
import { allowed } from '../lib/guard.mjs';

const FAKE_REVIEW = fileURLToPath(new URL('./fixtures/backtest/fake-review.mjs', import.meta.url));

function repos() {
  const root = mkdtempSync(path.join(tmpdir(), 'backtest-'));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '--bare', origin]);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'remote', 'add', 'origin', origin);
  writeFileSync(path.join(repo, 'a.js'), 'export const a = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  const heads = {};
  for (const number of [1, 2, 3]) {
    writeFileSync(path.join(repo, 'a.js'), 'export const a = ' + (number + 1) + ';\n');
    git(repo, 'commit', '-q', '-am', 'pr ' + number);
    heads[number] = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'push', '-q', 'origin', heads[number] + ':refs/pull/' + number + '/head');
    git(repo, 'reset', '-q', '--hard', 'HEAD~1');
  }
  const plugin = path.join(root, 'plugin');
  mkdirSync(path.join(plugin, 'ci', 'github'), { recursive: true });
  writeFileSync(path.join(plugin, 'ci', 'github', 'mcode-review.yml'), "env:\n  MCODE_REVIEW_TEMPLATE_VERSION: '7'\n  MCODE_REVIEW_MCODE_VERSION: '0.7.6'\n");
  const mcode = path.join(root, 'mcode');
  writeFileSync(mcode, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const cases = path.join(root, 'cases.jsonl');
  writeFileSync(cases, [
    { number: 1, expect: 'catch', truth: 'an empty list skips the minimum check', fix: 9, files: ['a.js'] },
    { number: 2, expect: 'clean', truth: '', fix: null, files: [] },
    { number: 3, expect: 'clean', truth: '', fix: null, files: [] },
  ].map((item) => JSON.stringify(item)).join('\n') + '\n');
  const profile = path.join(root, 'candidate.json');
  writeFileSync(profile, '{}');
  return { root, repo, heads, plugin, mcode, cases, profile };
}

async function fakeApi() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, body }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + server.address().port, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('the guard lets reads and GraphQL queries through, nothing else', () => {
  assert.equal(allowed('GET', 'https://api.github.com/repos/a/b'), true);
  assert.equal(allowed('HEAD', 'https://x/y'), true);
  assert.equal(allowed('POST', 'https://api.github.com/graphql', JSON.stringify({ query: 'query { viewer { login } }' })), true);
  assert.equal(allowed('POST', 'https://api.github.com/graphql', JSON.stringify({ query: '  mutation { x }' })), false);
  assert.equal(allowed('POST', 'https://api.github.com/graphql', JSON.stringify({ query: '# note\nmutation { x }' })), false);
  assert.equal(allowed('POST', 'https://api.github.com/graphql', 'not json'), false);
  assert.equal(allowed('POST', 'https://api.github.com/repos/a/b/issues/1/comments', '{}'), false);
  assert.equal(allowed('PUT', 'https://gitlab.example/api/v4/projects/1/merge_requests/1/discussions/x?resolved=true'), false);
  assert.equal(allowed('PATCH', 'https://api.github.com/repos/a/b/issues/comments/1', '{}'), false);
});

test('usage counts every attempt of the finding and the checking pass', () => {
  assert.equal(usageOf({ stats: { hunt: { attempts: [{ usage: { input: 1, output: 2, cache_read: 3 } }, { usage: { input: 4 } }] }, verify: { attempts: [{ usage: { output: 10 } }] } } }), 20);
  assert.equal(usageOf(null), 0);
});

test('each case runs in its own clone; only prepare and publish read the host, only lens gets the model key; the budget stops new cases', async (t) => {
  const fx = repos();
  const api = await fakeApi();
  t.after(api.close);
  process.env.MCODE_REVIEW_API_KEY = 'model-key-for-tests';
  process.env.BACKTEST_TEST_SECRET = 'must-not-reach-the-phases';
  t.after(() => { delete process.env.MCODE_REVIEW_API_KEY; delete process.env.BACKTEST_TEST_SECRET; });
  const out = path.join(fx.root, 'out');
  const card = await backtest({ host: 'github', project: 'acme/app', repo: fx.repo, cases: fx.cases, plugin: fx.plugin, profile: fx.profile, lang: 'zh', budget: 1000, out, apiUrl: api.url, token: 'host-token-for-tests', review: FAKE_REVIEW, mcodeBin: fx.mcode });
  assert.deepEqual(card.cases.map((item) => item.skipped || item.verdict), ['needs_human', 'needs_human', 'budget'], '600 tokens a case: the third would start past the budget');
  assert.equal(card.spent, 1200);
  const [first] = card.cases;
  assert.equal(first.tokens, 600);
  assert.deepEqual(first.flags, { failed: false, partial: false, repaired: true, salvaged: false });
  assert.equal(first.findings[0].where, 'a.js:1');
  assert.deepEqual(first.questions, ['Does this ship behind a flag?']);
  assert.equal(first.tier, 'M');

  const envOf = (number, phase) => JSON.parse(readFileSync(path.join(out, String(number), 'repo', '.mcode-review', 'env-' + phase + '.json'), 'utf8'));
  for (const phase of ['prepare', 'publish']) {
    const env = envOf(1, phase);
    assert.equal(env.hasApiKey, false, phase + ' gets no model key');
    assert.equal(env.hasGithubToken, true, phase + ' reads the host');
    assert.match(env.nodeOptions, /--import .*guard\.mjs/);
    assert.deepEqual([env.write, env.query, env.mutation], ['blocked', 'sent', 'blocked'], phase + ': only the query reached the server');
    assert.equal(env.dryRun, '1');
  }
  const lens = envOf(1, 'lens');
  assert.equal(lens.hasApiKey, true);
  assert.equal(lens.hasGithubToken, false, 'the model job never holds the host token');
  assert.equal(lens.nodeOptions, '');
  for (const phase of ['prepare', 'lens', 'publish']) {
    const env = envOf(2, phase);
    assert.deepEqual(env.stray, [], 'unrelated environment variables stay out');
    assert.equal(env.pr, '2');
    assert.equal(env.headSha, fx.heads[2], 'the PR head from refs/pull/2/head');
    assert.equal(env.lang, 'zh');
    assert.equal(env.templateVersion, '7');
    assert.ok(env.profile.endsWith('candidate.json'));
  }
  assert.ok(!api.seen.some((hit) => hit.method !== 'POST' || !/"query"\s*:\s*"query/.test(hit.body)) && api.seen.length === 4, 'the server saw the four queries and nothing else');

  const clone = path.join(out, '1', 'repo');
  const refs = execFileSync('git', ['for-each-ref', '--format=%(refname)'], { cwd: clone, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(refs, ['refs/mcode-backtest/head'], 'no branch of the source is visible in the clone');
  assert.ok(existsSync(path.join(out, '1', 'summary.md')) && existsSync(path.join(out, '1', 'lens-general.json')) && existsSync(path.join(out, '1', 'plan.json')));
  const md = readFileSync(path.join(out, 'scorecard.md'), 'utf8');
  assert.match(md, /\| 1 \| catch \| M \| general \| needs_human \| 1 \| 1 \| 600 \|/);
  assert.match(md, /\| 3 \| clean \| \| \| skipped \(budget\)/);
  assert.match(md, /Truth: an empty list skips the minimum check \(a\.js\)/);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: fx.repo, encoding: 'utf8' }), '', 'the source repository is untouched');
});

test('the output directory may not be inside the repository', async () => {
  const fx = repos();
  await assert.rejects(backtest({ host: 'github', project: 'acme/app', repo: fx.repo, cases: fx.cases, plugin: fx.plugin, budget: 10, out: path.join(fx.repo, 'bt'), token: 't', review: FAKE_REVIEW, mcodeBin: fx.mcode }), /--out must be outside --repo/);
  await assert.rejects(backtest({ host: 'github', project: 'acme/app', repo: fx.repo, cases: fx.cases, plugin: fx.plugin, budget: 0, out: path.join(fx.root, 'o'), token: 't' }), /--budget/);
});

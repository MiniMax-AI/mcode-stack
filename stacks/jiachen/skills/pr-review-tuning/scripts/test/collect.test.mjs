import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { collect } from '../collect.mjs';
import { findFixes, normLogin, shortText } from '../lib/common.mjs';

const METRICS = fileURLToPath(new URL('../metrics.mjs', import.meta.url));
const pack = (value) => gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
const summaryBody = (state) => '## MCode Review: 🔧 Changes requested (shadow phase: comments only, does not block merging)\n\n<!-- mcode-review:summary -->\n\n<!-- mcode-review:state ' + pack(state) + ' -->';
const threadBody = (meta) => '**[' + (meta.severity || 'question') + '] ' + meta.title + '**\n\nbody\n\n<!-- mcode-review:thread ' + pack(meta) + ' -->';
const STATE = {
  v: 1, round: 2, last_verdict: 'request_changes',
  lenses: { general: { findings: [{ id: 'F-aaa111', severity: 'P1', type: 'defect', class: 'retry-semantics', path: 'src/a.ts', title: 'A retry charges twice', lens: 'general' }] } },
  history: [{ sha: 's1', verdict: 'request_changes', round: 1, model_called: true, at: '2026-01-05T10:00:00Z', tier: 'M', lenses: ['general'], language: 'en', usage: { input: 10, output: 2, cache_read: 5 } }],
};

async function serve(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      const reply = routes(req.method, new URL(req.url, 'http://x'), body);
      if (reply === undefined) { res.writeHead(404); res.end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: 'http://127.0.0.1:' + server.address().port, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('fixes: phrases in English and Chinese, # on GitHub and ! on GitLab, never the PR itself', () => {
  assert.deepEqual(findFixes('Fixes #12, regression from #34; reverts acme/app#56; 修复 #78；由 !90 引入', { host: 'github', self: 12 }), [34, 56, 78]);
  assert.deepEqual(findFixes('由 !90 引入，修复 !91，see #5, introduced by !7', { host: 'gitlab' }), [7, 90, 91]);
  assert.deepEqual(findFixes('Add a button, see #3', { host: 'github' }), []);
  assert.equal(normLogin('GitHub-Actions[bot]'), 'github-actions');
  assert.equal(shortText('ok <!-- mcode-review:reply x -->\n<b>done</b>'), 'ok done');
});

test('GitHub: PRs of the window with the bot state, its threads, the quiz, files and fixes', async (t) => {
  const pr = (number, updated, extra = {}) => ({ number, title: 'PR ' + number, body: '', html_url: 'https://github.example/acme/app/pull/' + number, user: { login: 'Alice' }, state: 'closed', merged_at: '2026-01-06T09:00:00Z', created_at: '2026-01-05T09:00:00Z', updated_at: updated, head: { ref: 'feat/' + number }, base: { ref: 'main' }, draft: false, ...extra });
  const threadPages = [
    { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [{ id: 'T1', isResolved: true, resolvedBy: { login: 'github-actions' }, comments: { nodes: [{ databaseId: 1, body: threadBody({ id: 'F-aaa111', kind: 'finding', title: 'A retry charges twice', path: 'src/a.ts', line: 3, severity: 'P1', lens: 'general' }), createdAt: '2026-01-05T10:00:00Z', author: { login: 'github-actions' } }] } }] },
    { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
      { id: 'T2', isResolved: true, resolvedBy: { login: 'Alice' }, comments: { nodes: [
        { databaseId: 2, body: threadBody({ id: 'NH-risk-auth', kind: 'risk_path', source: 'condition', title: 'Risk path changed: auth', paths: ['src/auth.ts'] }), createdAt: '2026-01-05T10:00:00Z', author: { login: 'github-actions' } },
        { databaseId: 3, body: 'Checked, not affected.', createdAt: '2026-01-05T11:00:00Z', author: { login: 'Alice' } }] } },
      { id: 'T3', isResolved: false, resolvedBy: null, comments: { nodes: [{ databaseId: 4, body: 'a human thread', createdAt: '2026-01-05T12:00:00Z', author: { login: 'bob' } }] } }] },
  ];
  const server = await serve((method, url, body) => {
    const p = url.pathname;
    if (method === 'GET' && p === '/repos/acme/app/pulls') return url.searchParams.get('page') === '1'
      ? [pr(12, '2026-01-07T00:00:00Z', { body: 'Fixes #11, regression from #7; see #99' }), pr(11, '2026-01-06T00:00:00Z')]
      : [pr(10, '2025-12-01T00:00:00Z')];
    if (method === 'GET' && p === '/repos/acme/app/pulls/11') return pr(11, '2026-01-06T00:00:00Z');
    if (method === 'GET' && p === '/repos/acme/app/issues/12/comments') return url.searchParams.get('page') === '1' ? [
      { id: 100, user: { login: 'github-actions[bot]' }, body: summaryBody(STATE), created_at: '2026-01-05T10:00:00Z' },
      { id: 101, user: { login: 'github-actions[bot]' }, body: '### Author quiz\n<!-- mcode-author-quiz-meta: {"v":2} -->', created_at: '2026-01-05T10:01:00Z' },
      { id: 102, user: { login: 'github-actions[bot]' }, body: 'record <!-- mcode-author-quiz-meta-response: {"answers":[]} -->', created_at: '2026-01-05T12:00:00Z' },
    ] : [];
    if (method === 'GET' && /^\/repos\/acme\/app\/issues\/\d+\/comments$/.test(p)) return [];
    if (method === 'GET' && p === '/repos/acme/app/pulls/12/files') return url.searchParams.get('page') === '1' ? [{ filename: 'src/a.ts' }, { filename: 'src/auth.ts' }] : [];
    if (method === 'GET' && /\/files$/.test(p)) return [];
    if (method === 'POST' && p === '/graphql') {
      const { variables } = JSON.parse(body);
      if (variables.number !== 12) return { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } };
      return { data: { repository: { pullRequest: { reviewThreads: variables.cursor ? threadPages[1] : threadPages[0] } } } };
    }
    return undefined;
  });
  t.after(server.close);
  const out = mkdtempSync(path.join(tmpdir(), 'collect-gh-'));
  const { records } = await collect({ host: 'github', project: 'acme/app', since: '2026-01-05T00:00:00Z', until: '2026-01-12T00:00:00Z', out, apiUrl: server.url, graphqlUrl: server.url + '/graphql', token: 't', pageSize: 2 });
  assert.deepEqual(records.map((record) => record.number), [11, 12], 'PR 10 was last updated before the window');
  assert.ok(!server.seen.some((hit) => hit.url.includes('page=3')), 'the listing stops at the first page older than the window');
  const [unreviewed, reviewed] = records;
  assert.equal(unreviewed.summary, null);
  assert.deepEqual(unreviewed.threads, []);
  assert.equal(reviewed.author, 'alice');
  assert.equal(reviewed.state, 'merged');
  assert.deepEqual(reviewed.summary, { verdict: 'request_changes', tier: 'M', round: 2, phase: 'shadow' });
  assert.deepEqual(reviewed.history[0].usage, { input: 10, output: 2, cache_read: 5 });
  assert.equal(reviewed.history[0].tier, 'M');
  assert.equal(reviewed.threads.length, 2, 'the human thread is not the bot\'s');
  const [finding, question] = reviewed.threads;
  assert.deepEqual({ id: finding.id, kind: finding.kind, source: finding.source, type: finding.type, class: finding.class, resolved_by: finding.resolved_by, resolved_by_bot: finding.resolved_by_bot }, { id: 'F-aaa111', kind: 'finding', source: 'model', type: 'defect', class: 'retry-semantics', resolved_by: 'github-actions', resolved_by_bot: true });
  assert.deepEqual({ kind: question.kind, source: question.source, path: question.path, resolved_by: question.resolved_by, resolved_by_bot: question.resolved_by_bot, human_replies: question.human_replies, texts: question.human_reply_texts }, { kind: 'risk_path', source: 'condition', path: 'src/auth.ts', resolved_by: 'alice', resolved_by_bot: false, human_replies: 1, texts: ['Checked, not affected.'] });
  assert.deepEqual(reviewed.quiz, { posted: 1, answered: true });
  assert.deepEqual(reviewed.fixes, [11], '#7 is an issue, and "see #99" names no fix');
  assert.deepEqual(reviewed.files, ['src/a.ts', 'src/auth.ts']);
  assert.ok(server.seen.every((hit) => hit.method === 'GET' || (hit.method === 'POST' && !/^\s*\{?\s*"query"\s*:\s*"\s*mutation/.test(hit.body))), 'reads only');
  const lines = readFileSync(path.join(out, 'prs.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const metrics = spawnSync(process.execPath, [METRICS, '--in', path.join(out, 'prs.jsonl'), '--out', out], { encoding: 'utf8' });
  assert.equal(metrics.status, 0, metrics.stderr);
});

test('GitLab: merge requests with notes, discussions and changes; only !refs count as fixes', async (t) => {
  const server = await serve((method, url) => {
    const p = url.pathname;
    if (p === '/api/v4/projects/acme%2Fapp/merge_requests') return url.searchParams.get('page') === '1' ? [{ iid: 5, title: 'Fix the cart', description: '由 !3 引入，修复 #8', web_url: 'https://gitlab.example/acme/app/-/merge_requests/5', author: { username: 'Carol' }, state: 'merged', created_at: '2026-01-05T09:00:00Z', merged_at: '2026-01-06T09:00:00Z', source_branch: 'fix/cart', target_branch: 'main', draft: false }] : [];
    if (p === '/api/v4/projects/acme%2Fapp/merge_requests/5/notes') return url.searchParams.get('page') === '1' ? [
      { id: 1, author: { username: 'review-bot' }, body: summaryBody(STATE), created_at: '2026-01-05T10:00:00Z', system: false },
      { id: 2, author: { username: 'carol' }, body: 'changed the description', created_at: '2026-01-05T10:30:00Z', system: true },
    ] : [];
    if (p === '/api/v4/projects/acme%2Fapp/merge_requests/5/discussions') return url.searchParams.get('page') === '1' ? [
      { id: 'd1', notes: [
        { id: 10, author: { username: 'review-bot' }, body: threadBody({ id: 'F-aaa111', kind: 'finding', title: 'A retry charges twice', path: 'src/a.ts', line: 3, severity: 'P1', lens: 'general' }), created_at: '2026-01-05T10:00:00Z', system: false, resolvable: true, resolved: true, resolved_by: { username: 'review-bot' } },
        { id: 11, author: { username: 'carol' }, body: 'Fixed in abc1234.', created_at: '2026-01-05T11:00:00Z', system: false, resolvable: true, resolved: true },
      ] },
      { id: 'd2', notes: [{ id: 12, author: { username: 'dave' }, body: 'a human question', created_at: '2026-01-05T12:00:00Z', system: false, resolvable: true, resolved: false }] },
    ] : [];
    if (p === '/api/v4/projects/acme%2Fapp/merge_requests/5/changes') return { changes: [{ new_path: 'lib/cart.go' }] };
    return undefined;
  });
  t.after(server.close);
  const out = mkdtempSync(path.join(tmpdir(), 'collect-gl-'));
  const { records } = await collect({ host: 'gitlab', project: 'acme/app', since: '2026-01-05T00:00:00Z', until: '2026-01-12T00:00:00Z', out, apiUrl: server.url + '/api/v4', token: 't' });
  assert.equal(records.length, 1);
  const [mr] = records;
  assert.equal(mr.author, 'carol');
  assert.equal(mr.summary.verdict, 'request_changes');
  assert.equal(mr.threads.length, 1);
  assert.deepEqual({ resolved_by_bot: mr.threads[0].resolved_by_bot, human_replies: mr.threads[0].human_replies, texts: mr.threads[0].human_reply_texts }, { resolved_by_bot: true, human_replies: 1, texts: ['Fixed in abc1234.'] });
  assert.deepEqual(mr.fixes, [3]);
  assert.deepEqual(mr.files, ['lib/cart.go']);
  assert.equal(mr.quiz, null);
  assert.ok(server.seen.every((hit) => hit.method === 'GET'));
});

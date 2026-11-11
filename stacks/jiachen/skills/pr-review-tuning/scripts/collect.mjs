#!/usr/bin/env node
// Collects what MCode Review did on a repository's PRs in a time window.
//
//   node collect.mjs --host github|gitlab --project <owner/name or group/name> --since <iso> --until <iso>
//                    --out <dir> [--api-url <url>] [--graphql-url <url>] [--token <token>]
//
// Reads only: GET requests and GraphQL queries. Writes <dir>/prs.jsonl, one record
// per PR whose last update falls in the window (the format metrics.mjs reads), and
// <dir>/raw/<number>.json with what each record was built from.
// Token: --token, GITHUB_TOKEN / GH_TOKEN or GITLAB_TOKEN, else `gh auth token` /
// `glab config get token`. --api-url points at GitHub Enterprise
// (https://host/api/v3) or a self-managed GitLab (https://host/api/v4).
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { findFixes, normLogin, QUIZ_META_RE, QUIZ_RESPONSE_RE, Reader, resolveToken, shortText, stateOf, SUMMARY_MARKER, threadMetaOf } from './lib/common.mjs';

const SHADOW_RE = /shadow phase|影子期/i;

// ---------------------------------------------------------------- one record

// pr: { number, url, title, body, author, state, created_at, merged_at,
//       source_branch, target_branch, draft }
// comments: PR-level comments [{ id, author, body, created_at }]
// threads: [{ id, resolved, resolved_by, comments: [{ author, body, created_at }] }]
export function buildRecord({ host, project, pr, comments, threads, files, isPullRequest = () => true }) {
  const summaries = comments.filter((comment) => String(comment.body || '').includes(SUMMARY_MARKER));
  const summaryComment = summaries.at(-1) || null;
  const bot = summaryComment ? normLogin(summaryComment.author) : null;
  const state = summaryComment ? stateOf(summaryComment.body) : null;
  const findingInfo = new Map();
  for (const entry of Object.values(state?.lenses || {})) {
    for (const finding of entry?.findings || []) findingInfo.set(finding.id, finding);
  }
  const history = (state?.history || []).map((item) => ({
    sha: item.sha || null, verdict: item.verdict || null, round: item.round ?? null, model_called: Boolean(item.model_called),
    at: item.at || null, arm: item.arm || null, tier: item.tier || null, lenses: item.lenses || null, language: item.language || null,
    usage: item.usage ? { input: Number(item.usage.input) || 0, output: Number(item.usage.output) || 0, cache_read: Number(item.usage.cache_read) || 0 } : null,
  }));
  const summary = state ? {
    verdict: state.last_verdict || history.at(-1)?.verdict || null,
    tier: history.at(-1)?.tier || null,
    round: state.round ?? null,
    phase: SHADOW_RE.test(summaryComment.body) ? 'shadow' : 'enforce',
  } : null;
  const botThreads = [];
  for (const thread of threads) {
    const first = thread.comments[0];
    if (!first || !bot || normLogin(first.author) !== bot) continue;
    const meta = threadMetaOf(first.body);
    if (!meta?.id) continue;
    const isFinding = meta.kind === 'finding';
    const info = isFinding ? findingInfo.get(meta.id) : null;
    const human = thread.comments.slice(1).filter((comment) => normLogin(comment.author) !== bot);
    const resolvedBy = thread.resolved ? normLogin(thread.resolved_by) : null;
    botThreads.push({
      id: meta.id,
      kind: meta.kind || null,
      source: meta.source || (isFinding ? 'model' : null),
      severity: meta.severity || info?.severity || null,
      type: info?.type || null,
      class: info?.class || null,
      lens: meta.lens || info?.lens || '',
      title: meta.title || info?.title || '',
      path: meta.path || (meta.paths || [])[0] || info?.path || null,
      created_at: first.created_at || null,
      resolved: Boolean(thread.resolved),
      resolved_by_bot: Boolean(thread.resolved && resolvedBy && resolvedBy === bot),
      resolved_by: resolvedBy,
      human_replies: human.length,
      first_human_reply_at: human[0]?.created_at || null,
      human_reply_texts: human.slice(0, 3).map((comment) => shortText(comment.body)).filter(Boolean),
    });
  }
  const botComments = bot ? comments.filter((comment) => normLogin(comment.author) === bot) : [];
  const quizzes = botComments.filter((comment) => QUIZ_META_RE.test(comment.body || '')).length;
  const answered = botComments.some((comment) => QUIZ_RESPONSE_RE.test(comment.body || ''));
  return {
    host, project, number: pr.number, url: pr.url, title: pr.title, author: normLogin(pr.author), state: pr.state,
    created_at: pr.created_at, merged_at: pr.merged_at || null, source_branch: pr.source_branch, target_branch: pr.target_branch, draft: Boolean(pr.draft),
    summary, history, threads: botThreads,
    quiz: quizzes ? { posted: quizzes, answered } : null,
    fixes: findFixes(pr.title + '\n' + (pr.body || ''), { host, self: pr.number }).filter((number) => isPullRequest(number)),
    files,
  };
}

// ---------------------------------------------------------------- GitHub

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id isResolved resolvedBy { login } comments(first: 100) { nodes { databaseId body createdAt author { login } } } } } } } }`;

// GitHub.com serves GraphQL at api.github.com/graphql, GitHub Enterprise at
// <host>/api/graphql next to <host>/api/v3.
export function githubGraphqlUrl(apiUrl, override) {
  if (override) return override;
  if (/\/api\/v3\/?$/.test(apiUrl)) return apiUrl.replace(/\/api\/v3\/?$/, '/api/graphql');
  return apiUrl.replace(/\/$/, '') + '/graphql';
}

async function collectGithub({ reader, apiUrl, graphqlUrl, project, since, until, pageSize }) {
  const [owner, name] = project.split('/');
  const repo = apiUrl + '/repos/' + owner + '/' + name;
  const inWindow = (pr) => pr.updated_at >= since && pr.updated_at < until;
  const listed = await reader.pages(repo + '/pulls?state=all&sort=updated&direction=desc', { pageSize, until: (batch) => batch.at(-1).updated_at < since });
  const prCache = new Map();
  const isPull = async (number) => {
    if (!prCache.has(number)) prCache.set(number, Boolean(await reader.request(repo + '/pulls/' + number)));
    return prCache.get(number);
  };
  const out = [];
  for (const pr of listed.filter(inWindow)) {
    const comments = (await reader.pages(repo + '/issues/' + pr.number + '/comments', { pageSize })).map((c) => ({ id: c.id, author: c.user?.login, body: c.body || '', created_at: c.created_at }));
    const threads = [];
    let cursor = null;
    for (let page = 0; page < 20; page += 1) {
      const data = await reader.request(githubGraphqlUrl(apiUrl, graphqlUrl), { method: 'POST', body: { query: THREADS_QUERY, variables: { owner, name, number: pr.number, cursor } } });
      const block = data?.data?.repository?.pullRequest?.reviewThreads;
      for (const node of block?.nodes || []) {
        threads.push({ id: node.id, resolved: Boolean(node.isResolved), resolved_by: node.resolvedBy?.login || null, comments: (node.comments?.nodes || []).map((c) => ({ id: c.databaseId, author: c.author?.login || null, body: c.body || '', created_at: c.createdAt })) });
      }
      if (!block?.pageInfo?.hasNextPage) break;
      cursor = block.pageInfo.endCursor;
    }
    const files = (await reader.pages(repo + '/pulls/' + pr.number + '/files', { pageSize, maxPages: 30 })).map((file) => file.filename);
    const base = { number: pr.number, url: pr.html_url, title: pr.title || '', body: pr.body || '', author: pr.user?.login, state: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open', created_at: pr.created_at, merged_at: pr.merged_at, source_branch: pr.head?.ref, target_branch: pr.base?.ref, draft: pr.draft };
    const candidates = findFixes(base.title + '\n' + base.body, { host: 'github', self: pr.number });
    for (const number of candidates) await isPull(number);
    out.push({ raw: { pr: base, comments, threads, files }, isPullRequest: (number) => prCache.get(number) === true });
  }
  return out;
}

// ---------------------------------------------------------------- GitLab

async function collectGitlab({ reader, apiUrl, project, since, until, pageSize }) {
  const base = apiUrl + '/projects/' + encodeURIComponent(project);
  const listed = await reader.pages(base + '/merge_requests?state=all&order_by=updated_at&sort=desc&updated_after=' + encodeURIComponent(since) + '&updated_before=' + encodeURIComponent(until), { pageSize });
  const out = [];
  for (const mr of listed) {
    const notes = (await reader.pages(base + '/merge_requests/' + mr.iid + '/notes?sort=asc&order_by=created_at', { pageSize })).filter((n) => !n.system);
    const discussions = await reader.pages(base + '/merge_requests/' + mr.iid + '/discussions', { pageSize });
    const threads = discussions.map((d) => {
      const list = (d.notes || []).filter((n) => !n.system);
      const resolvable = list.filter((n) => n.resolvable);
      const resolved = resolvable.length > 0 && resolvable.every((n) => n.resolved);
      const by = resolved ? (list[0]?.resolved_by || resolvable.find((n) => n.resolved_by)?.resolved_by) : null;
      return { id: d.id, resolved, resolved_by: by?.username || null, comments: list.map((n) => ({ id: n.id, author: n.author?.username, body: n.body || '', created_at: n.created_at })) };
    });
    let changes = await reader.request(base + '/merge_requests/' + mr.iid + '/changes').catch(() => null);
    let files = (changes?.changes || []).map((c) => c.new_path);
    if (!changes) files = (await reader.pages(base + '/merge_requests/' + mr.iid + '/diffs', { pageSize, maxPages: 30 }).catch(() => [])).map((c) => c.new_path);
    const pr = { number: mr.iid, url: mr.web_url, title: mr.title || '', body: mr.description || '', author: mr.author?.username, state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed', created_at: mr.created_at, merged_at: mr.merged_at, source_branch: mr.source_branch, target_branch: mr.target_branch, draft: Boolean(mr.draft || mr.work_in_progress) };
    out.push({ raw: { pr, comments: notes.map((n) => ({ id: n.id, author: n.author?.username, body: n.body || '', created_at: n.created_at })), threads, files }, isPullRequest: () => true });
  }
  return out;
}

// ---------------------------------------------------------------- main

export async function collect({ host, project, since, until, out, apiUrl, graphqlUrl, token, pageSize = 100 }) {
  if (!['github', 'gitlab'].includes(host)) throw new Error('--host must be github or gitlab');
  if (!project || !since || !until || !out) throw new Error('--project, --since, --until and --out are required');
  const api = (apiUrl || (host === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4')).replace(/\/$/, '');
  const auth = resolveToken({ host, token, apiUrl: api });
  if (!auth) throw new Error('no token: pass --token or set ' + (host === 'github' ? 'GITHUB_TOKEN' : 'GITLAB_TOKEN'));
  const headers = host === 'github' ? { Authorization: 'Bearer ' + auth, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } : { 'PRIVATE-TOKEN': auth };
  const reader = new Reader({ headers });
  const sinceIso = new Date(since).toISOString();
  const untilIso = new Date(until).toISOString();
  const items = host === 'github'
    ? await collectGithub({ reader, apiUrl: api, graphqlUrl, project, since: sinceIso, until: untilIso, pageSize })
    : await collectGitlab({ reader, apiUrl: api, project, since: sinceIso, until: untilIso, pageSize });
  mkdirSync(path.join(out, 'raw'), { recursive: true });
  const records = [];
  for (const item of items) {
    writeFileSync(path.join(out, 'raw', item.raw.pr.number + '.json'), JSON.stringify(item.raw, null, 1) + '\n');
    records.push(buildRecord({ host, project, ...item.raw, isPullRequest: item.isPullRequest }));
  }
  records.sort((a, b) => a.number - b.number);
  writeFileSync(path.join(out, 'prs.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
  return { records, calls: reader.calls };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const { values } = parseArgs({ options: { host: { type: 'string' }, project: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' }, out: { type: 'string' }, 'api-url': { type: 'string' }, 'graphql-url': { type: 'string' }, token: { type: 'string' }, 'page-size': { type: 'string' } } });
  collect({ host: values.host, project: values.project, since: values.since, until: values.until, out: values.out, apiUrl: values['api-url'], graphqlUrl: values['graphql-url'], token: values.token, pageSize: Number(values['page-size']) || 100 })
    .then(({ records, calls }) => {
      const reviewed = records.filter((record) => record.summary).length;
      const threads = records.reduce((sum, record) => sum + record.threads.length, 0);
      console.log('collected ' + records.length + ' PRs (' + reviewed + ' reviewed by the bot, ' + threads + ' bot threads) with ' + calls + ' requests into ' + path.join(values.out, 'prs.jsonl'));
    })
    .catch((error) => {
      console.error('collect.mjs: ' + error.message);
      process.exit(1);
    });
}

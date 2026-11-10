#!/usr/bin/env node
// Stand-in for the plugin's ci/review.mjs in backtest tests. It records the
// environment each phase gets, tries writes that the guard must stop, and writes
// the files the real subcommands write, with token usage.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const phase = process.argv[2];
const work = path.join(process.cwd(), '.mcode-review');
mkdirSync(path.join(work, 'out'), { recursive: true });
const env = process.env;
const record = {
  hasApiKey: Boolean(env.MCODE_REVIEW_API_KEY), hasGithubToken: Boolean(env.MCODE_REVIEW_GITHUB_TOKEN), hasGitlabToken: Boolean(env.MCODE_REVIEW_GITLAB_TOKEN),
  nodeOptions: env.NODE_OPTIONS || '', dryRun: env.MCODE_REVIEW_DRY_RUN, host: env.MCODE_REVIEW_HOST, pr: env.MCODE_REVIEW_PR || env.CI_MERGE_REQUEST_IID,
  headSha: env.MCODE_REVIEW_HEAD_SHA || env.CI_COMMIT_SHA, profile: env.MCODE_REVIEW_PROFILE_FILE || '', lang: env.MCODE_REVIEW_LANGUAGE, templateVersion: env.MCODE_REVIEW_TEMPLATE_VERSION,
  stray: Object.keys(env).filter((key) => key.startsWith('BACKTEST_TEST_')),
};
const api = env.GITHUB_API_URL || env.CI_API_V4_URL;
if (phase === 'prepare' || phase === 'publish') {
  const attempt = async (url, init) => { try { await fetch(url, init); return 'sent'; } catch (error) { return /backtest guard/.test(error.message) ? 'blocked' : 'error'; } };
  record.write = await attempt(api + '/repos/acme/app/issues/' + record.pr + '/comments', { method: 'POST', body: '{}' });
  record.query = await attempt(api + '/graphql', { method: 'POST', body: JSON.stringify({ query: 'query { viewer { login } }' }) });
  record.mutation = await attempt(api + '/graphql', { method: 'POST', body: JSON.stringify({ query: 'mutation { resolveReviewThread(input: {threadId: "x"}) { clientMutationId } }' }) });
}
writeFileSync(path.join(work, 'env-' + phase + '.json'), JSON.stringify(record));
if (phase === 'prepare') writeFileSync(path.join(work, 'plan.json'), JSON.stringify({ tier: 'M', lenses: ['general'], superseded: false }));
if (phase === 'lens') {
  writeFileSync(path.join(work, 'out', 'lens-' + env.MCODE_REVIEW_LENS + '.json'), JSON.stringify({
    status: 'complete', lens: env.MCODE_REVIEW_LENS,
    findings: [{ severity: 'P2', type: 'defect', title: 'An empty list skips the check', path: 'a.js', line: 1, lens: env.MCODE_REVIEW_LENS, evidence_level: 2, verifier: 'not_required' }],
    needs_human: [{ title: 'Does this ship behind a flag?' }],
    stats: { hunt: { attempts: [{ ok: false, usage: { input: 100, output: 50, cache_read: 50 } }, { ok: true, repair: true, usage: { input: 300, output: 50, cache_read: 50 } }] } },
  }));
}
if (phase === 'publish') {
  writeFileSync(path.join(work, 'out', 'summary.md'), '## MCode Review: dry run\n');
  writeFileSync(path.join(work, 'out', 'verdict.json'), JSON.stringify({ verdict: 'needs_human' }));
}

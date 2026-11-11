#!/usr/bin/env node
// Replays the MCode Review CI on past PRs with given rules, without writing to
// GitHub or GitLab, and writes a scorecard for an agent to judge.
//
//   node backtest.mjs --host github|gitlab --project <owner/name or group/name> --repo <local clone>
//                     --cases <cases.jsonl> --plugin <stack dir> [--profile <.mcode-review.json>]
//                     [--notes <.mcode-review.md>] [--lang en|zh] --budget <tokens> --out <dir>
//                     [--api-url <url>] [--token <token>]
//
// Per case: an isolated clone of --repo at the PR head (fetched from --repo's
// origin), then the plugin's ci/review.mjs prepare, lens for each direction the
// plan names, and publish as a dry run. prepare and publish get the host token and
// a guard that lets only reads through; lens gets the model variables
// (MCODE_REVIEW_API_KEY, MCODE_REVIEW_BASE_URL, MCODE_REVIEW_HTTPS_PROXY) from this
// environment and no host token. Once the cases used --budget tokens (input +
// output + cache reads), no new case starts; a running case always finishes.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveToken } from './lib/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, 'lib', 'guard.mjs');
const DUMMY_REF = '0123456789abcdef0123456789abcdef01234567';
const PASS_ENV = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'];
const MODEL_ENV = ['MCODE_REVIEW_API_KEY', 'MCODE_REVIEW_BASE_URL', 'MCODE_REVIEW_HTTPS_PROXY'];

function git(cwd, args, { allowFail = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.status !== 0 && !allowFail) throw new Error('git ' + args.join(' ') + ': ' + String(result.stderr).trim().slice(0, 400));
  return result.status === 0 ? String(result.stdout).trim() : '';
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function templateValue(plugin, name, fallback) {
  const file = path.join(plugin, 'ci', 'github', 'mcode-review.yml');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const match = text.match(new RegExp(name + ":\\s*'?([\\w.-]+)'?"));
  return match ? match[1] : fallback;
}

export function readCases(file) {
  return readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

// Tokens of one lens or quiz result: every attempt of the finding and the
// checking pass, failed attempts included.
export function usageOf(result) {
  let total = 0;
  const stats = result?.stats || {};
  for (const part of [stats.hunt, stats.verify, stats]) {
    for (const attempt of part?.attempts || []) {
      const usage = attempt.usage || {};
      total += (Number(usage.input) || 0) + (Number(usage.output) || 0) + (Number(usage.cache_read) || 0);
    }
  }
  return total;
}

function flagsOf(results) {
  const attempts = results.flatMap((result) => [...(result?.stats?.hunt?.attempts || []), ...(result?.stats?.verify?.attempts || [])]);
  return {
    failed: results.some((result) => result?.status === 'failed'),
    partial: results.some((result) => result?.status === 'partial'),
    repaired: attempts.some((attempt) => attempt.repair),
    salvaged: attempts.some((attempt) => attempt.salvage),
  };
}

function baseEnv() {
  const env = {};
  for (const key of PASS_ENV) if (process.env[key]) env[key] = process.env[key];
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

// The variables the CI code reads to know the host, the project and the PR.
export function hostEnv({ host, project, apiUrl, clone, number, headSha, run }) {
  if (host === 'github') {
    const server = apiUrl === 'https://api.github.com' ? 'https://github.com' : apiUrl.replace(/\/api\/v3\/?$/, '');
    return {
      MCODE_REVIEW_HOST: 'github', GITHUB_WORKSPACE: clone, GITHUB_REPOSITORY: project, GITHUB_API_URL: apiUrl,
      GITHUB_GRAPHQL_URL: apiUrl === 'https://api.github.com' ? 'https://api.github.com/graphql' : server + '/api/graphql',
      GITHUB_SERVER_URL: server, GITHUB_RUN_ID: String(run), MCODE_REVIEW_PR: String(number), MCODE_REVIEW_HEAD_SHA: headSha,
    };
  }
  const server = apiUrl.replace(/\/api\/v4\/?$/, '');
  return {
    MCODE_REVIEW_HOST: 'gitlab', CI_PROJECT_DIR: clone, CI_API_V4_URL: apiUrl, CI_PROJECT_ID: project, CI_PROJECT_PATH: project,
    CI_SERVER_URL: server, CI_MERGE_REQUEST_IID: String(number), CI_PIPELINE_ID: String(run), CI_COMMIT_SHA: headSha,
  };
}

// One subcommand of review.mjs as a child process, its output in a log file.
function runPhase({ review, phase, cwd, env, log }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [review, phase], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      writeFileSync(log, Buffer.concat(chunks).toString('utf8') + '\n[exit ' + code + ' after ' + Math.round((Date.now() - started) / 1000) + 's]\n');
      resolve(code);
    });
  });
}

// An isolated clone of the source at the PR head. Local refs are removed, so the
// model sees no later branches; objects come from the source (and, for a partial
// clone, from its remote on demand).
function prepareClone({ repo, dir, host, number, remote }) {
  git(path.dirname(dir), ['clone', '-q', '--shared', '--no-checkout', repo, dir]);
  for (const ref of git(dir, ['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean)) git(dir, ['update-ref', '--no-deref', '-d', ref], { allowFail: true });
  if (remote) git(dir, ['remote', 'set-url', 'origin', remote]);
  const filter = git(repo, ['config', '--get', 'remote.origin.partialclonefilter'], { allowFail: true });
  if (filter) {
    git(dir, ['config', 'core.repositoryformatversion', '1']);
    git(dir, ['config', 'extensions.partialClone', 'origin']);
    git(dir, ['config', 'remote.origin.promisor', 'true']);
    git(dir, ['config', 'remote.origin.partialclonefilter', filter]);
  }
  const ref = host === 'github' ? 'refs/pull/' + number + '/head' : 'refs/merge-requests/' + number + '/head';
  git(dir, ['fetch', '-q', 'origin', '+' + ref + ':refs/mcode-backtest/head']);
  return git(dir, ['rev-parse', 'refs/mcode-backtest/head']);
}

function installMcode({ out, version, bin }) {
  if (bin) return bin;
  const prefix = path.join(out, 'npm');
  const installed = path.join(prefix, 'node_modules', '.bin', 'mcode');
  if (existsSync(installed)) return installed;
  mkdirSync(prefix, { recursive: true });
  const result = spawnSync('npm', ['install', '--no-fund', '--no-audit', '--loglevel=error', '--prefix', prefix, '@minimax-ai/code@' + version], { encoding: 'utf8' });
  if (result.status !== 0 || !existsSync(installed)) throw new Error('npm install @minimax-ai/code@' + version + ' failed: ' + String(result.stderr).slice(-400));
  return installed;
}

function inside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function backtest(options) {
  const { host, project, repo, cases: casesFile, plugin, profile, notes, lang = 'en', budget, out, apiUrl, token, review: reviewOverride, mcodeBin } = options;
  if (!['github', 'gitlab'].includes(host)) throw new Error('--host must be github or gitlab');
  for (const [name, value] of Object.entries({ project, repo, cases: casesFile, plugin, out })) if (!value) throw new Error('--' + name + ' is required');
  if (!(Number(budget) > 0)) throw new Error('--budget must be a positive number of tokens');
  const repoDir = realpathSync(repo);
  mkdirSync(out, { recursive: true });
  const outDir = realpathSync(out);
  if (inside(outDir, repoDir)) throw new Error('--out must be outside --repo, so the clones never land in your repository');
  const api = (apiUrl || (host === 'github' ? 'https://api.github.com' : 'https://gitlab.com/api/v4')).replace(/\/$/, '');
  const auth = resolveToken({ host, token, apiUrl: api });
  if (!auth) throw new Error('no token to read ' + host + ': pass --token or set ' + (host === 'github' ? 'GITHUB_TOKEN' : 'GITLAB_TOKEN'));
  const pluginDir = realpathSync(plugin);
  const review = reviewOverride ? realpathSync(reviewOverride) : path.join(pluginDir, 'ci', 'review.mjs');
  const templateVersion = templateValue(pluginDir, 'MCODE_REVIEW_TEMPLATE_VERSION', '1');
  const mcode = installMcode({ out: outDir, version: process.env.MCODE_REVIEW_MCODE_VERSION || templateValue(pluginDir, 'MCODE_REVIEW_MCODE_VERSION', '0.7.6'), bin: mcodeBin });
  const remote = git(repoDir, ['remote', 'get-url', 'origin'], { allowFail: true }) || repoDir;
  const cases = readCases(casesFile);
  const results = [];
  let spent = 0;
  for (const [index, item] of cases.entries()) {
    const caseDir = path.join(outDir, String(item.number));
    if (spent >= Number(budget)) {
      results.push({ ...item, skipped: 'budget' });
      continue;
    }
    mkdirSync(path.join(caseDir, 'logs'), { recursive: true });
    const started = Date.now();
    const record = { ...item, tier: null, lenses: [], verdict: null, findings: [], questions: [], tokens: 0, minutes: 0, flags: {} };
    try {
      const clone = path.join(caseDir, 'repo');
      const headSha = prepareClone({ repo: repoDir, dir: clone, host, number: item.number, remote });
      mkdirSync(path.join(clone, '.mcode-review', 'npm', 'node_modules', '.bin'), { recursive: true });
      symlinkSync(mcode, path.join(clone, '.mcode-review', 'npm', 'node_modules', '.bin', 'mcode'));
      const common = {
        ...baseEnv(), ...hostEnv({ host, project, apiUrl: api, clone, number: item.number, headSha, run: index + 1 }),
        MCODE_REVIEW_DRY_RUN: '1', MCODE_REVIEW_TEMPLATE_VERSION: templateVersion, MCODE_REVIEW_PLUGIN_REF: DUMMY_REF, MCODE_REVIEW_LANGUAGE: lang,
        ...(profile ? { MCODE_REVIEW_PROFILE_FILE: realpathSync(profile) } : {}),
        ...(notes ? { MCODE_REVIEW_NOTES_FILE: realpathSync(notes) } : {}),
      };
      const reading = { ...common, NODE_OPTIONS: '--import ' + GUARD, [host === 'github' ? 'MCODE_REVIEW_GITHUB_TOKEN' : 'MCODE_REVIEW_GITLAB_TOKEN']: auth };
      await runPhase({ review, phase: 'prepare', cwd: clone, env: reading, log: path.join(caseDir, 'logs', 'prepare.log') });
      const plan = readJson(path.join(clone, '.mcode-review', 'plan.json'));
      if (!plan) throw new Error('prepare wrote no plan (see logs/prepare.log)');
      record.tier = plan.tier || null;
      record.lenses = plan.superseded ? [] : plan.lenses || [];
      const model = {};
      for (const key of MODEL_ENV) if (process.env[key]) model[key] = process.env[key];
      for (const lens of record.lenses) await runPhase({ review, phase: 'lens', cwd: clone, env: { ...common, ...model, MCODE_REVIEW_LENS: lens }, log: path.join(caseDir, 'logs', 'lens-' + lens + '.log') });
      await runPhase({ review, phase: 'publish', cwd: clone, env: reading, log: path.join(caseDir, 'logs', 'publish.log') });
      const work = path.join(clone, '.mcode-review');
      cpSync(path.join(work, 'plan.json'), path.join(caseDir, 'plan.json'));
      const lensResults = [];
      for (const name of existsSync(path.join(work, 'out')) ? readdirSync(path.join(work, 'out')) : []) {
        if (/^(lens-.*|quiz|verdict)\.json$|^summary\.md$/.test(name)) cpSync(path.join(work, 'out', name), path.join(caseDir, name));
        if (/^lens-.*\.json$/.test(name) || name === 'quiz.json') lensResults.push(readJson(path.join(work, 'out', name)));
      }
      record.tokens = lensResults.reduce((sum, result) => sum + usageOf(result), 0);
      record.flags = flagsOf(lensResults);
      record.verdict = readJson(path.join(caseDir, 'verdict.json'))?.verdict || null;
      for (const result of lensResults) {
        for (const finding of result?.findings || []) record.findings.push({ severity: finding.severity, type: finding.type, title: finding.title, where: finding.path + ':' + finding.line, lens: finding.lens, evidence: finding.evidence_level, verifier: finding.verifier });
        for (const question of result?.needs_human || []) record.questions.push(question.title);
      }
    } catch (error) {
      record.error = String(error.message).slice(0, 500);
    }
    record.minutes = Math.round((Date.now() - started) / 600) / 100;
    spent += record.tokens;
    results.push(record);
  }
  const scorecard = { host, project, plugin: pluginDir, profile: profile || null, notes: notes || null, lang, budget: Number(budget), spent, cases: results };
  writeFileSync(path.join(outDir, 'scorecard.json'), JSON.stringify(scorecard, null, 2) + '\n');
  writeFileSync(path.join(outDir, 'scorecard.md'), renderScorecard(scorecard));
  return scorecard;
}

export function renderScorecard(card) {
  const lines = ['# Backtest scorecard', '', 'Plugin `' + card.plugin + '`, rules ' + (card.profile ? '`' + card.profile + '`' : 'of each case') + (card.notes ? ' and `' + card.notes + '`' : '') + ', language ' + card.lang + '. Budget ' + card.budget + ' tokens, used ' + card.spent + '.', ''];
  lines.push('| PR | Expect | Tier | Directions | Verdict | Findings | Questions | Tokens | Minutes | Flags |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const item of card.cases) {
    if (item.skipped) {
      lines.push('| ' + item.number + ' | ' + (item.expect || '') + ' | | | skipped (' + item.skipped + ') | | | | | |');
      continue;
    }
    const flags = Object.entries(item.flags || {}).filter(([, on]) => on).map(([name]) => name).concat(item.error ? ['error'] : []).join(', ');
    lines.push('| ' + item.number + ' | ' + (item.expect || '') + ' | ' + (item.tier || '') + ' | ' + item.lenses.join(', ') + ' | ' + (item.verdict || '') + ' | ' + item.findings.length + ' | ' + item.questions.length + ' | ' + item.tokens + ' | ' + item.minutes + ' | ' + flags + ' |');
  }
  for (const item of card.cases.filter((entry) => !entry.skipped)) {
    lines.push('', '## PR ' + item.number + (item.expect ? ' (expect ' + item.expect + ')' : ''), '');
    if (item.truth) lines.push('Truth: ' + item.truth + (item.files?.length ? ' (' + item.files.join(', ') + ')' : ''), '');
    if (item.error) lines.push('Error: ' + item.error, '');
    for (const finding of item.findings) lines.push('- [' + finding.severity + '·' + finding.type + '] ' + finding.title + ' (' + finding.where + ', ' + finding.lens + ', evidence ' + finding.evidence + ', verifier ' + finding.verifier + ')');
    for (const question of item.questions) lines.push('- [question] ' + question);
    if (!item.findings.length && !item.questions.length) lines.push('- nothing reported');
  }
  return lines.join('\n') + '\n';
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const { values } = parseArgs({ options: {
    host: { type: 'string' }, project: { type: 'string' }, repo: { type: 'string' }, cases: { type: 'string' }, plugin: { type: 'string' },
    profile: { type: 'string' }, notes: { type: 'string' }, lang: { type: 'string' }, budget: { type: 'string' }, out: { type: 'string' },
    'api-url': { type: 'string' }, token: { type: 'string' }, review: { type: 'string' }, 'mcode-bin': { type: 'string' },
  } });
  backtest({ ...values, apiUrl: values['api-url'], mcodeBin: values['mcode-bin'], budget: Number(values.budget) })
    .then((card) => {
      const ran = card.cases.filter((item) => !item.skipped).length;
      console.log('backtest: ' + ran + ' of ' + card.cases.length + ' cases ran, ' + card.spent + ' tokens; scorecard in ' + path.join(values.out, 'scorecard.md'));
    })
    .catch((error) => {
      console.error('backtest.mjs: ' + error.message);
      process.exit(1);
    });
}

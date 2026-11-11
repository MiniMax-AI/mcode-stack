#!/usr/bin/env node
// MCode Review CI entry, the same on GitHub Actions and GitLab CI. Subcommands
// run in separate jobs:
//   prepare  (API token, no model)  plan, fingerprints, reuse, duplication hints,
//                                   whether this round writes an author quiz
//   lens     (model key only)       one review direction: find, then verify
//   quiz     (model key only)       the author quiz, when prepare asked for one
//   publish  (API token, no model)  verdict, summary comment, review threads,
//                                   quiz comment and answer record, Feishu card
//   grade    (API token)            record the author's answers right away
// core/host.mjs reads the host's environment. The GitHub and GitLab clients
// offer the same operations in the same shapes, so nothing below depends on the
// host but the few places that say so.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickArm } from './core/arms.mjs';
import { deliverFirstAccepted, sendCard, tenantToken, updateCard } from './core/feishu.mjs';
import { resolveLanguage, t } from './core/i18n.mjs';
import { addedLines, checkoutDetached, ensureCommit, fileDiff, fingerprint, nameStatus, numstat, restoreInstructionFiles, scrubRemoteCredentials } from './core/git.mjs';
import { commentLink, hostContext } from './core/host.mjs';
import { addUsage, installMcode, prepareRuntime, providerIdFor, readSchemaText, runWithFallback, writeRuntimeConfig } from './core/mcode.mjs';
import { MIN_QUESTIONS, normalizeQuiz, quizConfig, quizScope, rewriteRequest } from './core/quiz.mjs';
import { authorEmails, parseEmailAliases, quizCard, renderCard } from './core/quiz-card.mjs';
import { findLatestResponse, findPublishedQuiz, findSubmission, isLegacyQuiz, parseQuizMeta, quizRound, readQuiz, renderQuizNote, renderRecordNote, submissionChanged, summarizeSubmission } from './core/quiz-note.mjs';
import { lensLabel, localReviewAsk, renderInlineFinding, renderNeedsHumanReply, renderNeedsHumanThread, renderSummary } from './core/render.mjs';
import { applyRulePack, readRulePack } from './core/rules.mjs';
import { askedForPrompt, closedQuestions, findingMeta, openQuestions, planFindingThreads, planQuestionThreads, questionMeta, readThreadIndex, renderAsked, replyMarker, threadMarker } from './core/threads.mjs';
import { emptyState, extractState, findingId, fitSummary, planReuse, SUMMARY_MARKER } from './core/state.mjs';
import { classifyTier, descriptionCheck, instructionChanges, isGeneratedText, isMechanical, lensesForTier, mergeProfiles, rankFiles, riskHits, siblingSites, stackRefs, stacksFor, uiEvidenceMissing } from './core/triage.mjs';
import { ConfigError, credentialValues, env, log, pluginRefProblem, readJson, redactSecrets, requiredEnv, run, sanitizeUntrusted, sha256, shortSha, templateVersionProblem, writeJson, writeText } from './core/util.mjs';
import { computeVerdict, dedupeSpots, isBlocking, markFoundLate, mergeFindings, mergeNeedsHuman, nextRound } from './core/verdict.mjs';
import { CLAIM_STATUSES, FINDING_CLASSES, FINDING_TYPES, INTRODUCED, MAINTAINABILITY_CLASSES, matchValue, NEEDS_HUMAN_KINDS, SEVERITIES, VERIFY_VERDICTS } from './core/vocab.mjs';

// The stack this file belongs to: CI code, and skills shared with local use.
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CI_ROOT = path.join(PLUGIN_ROOT, 'ci');
// The plugin the model jobs load: the skills CI uses, under the name the
// prompts give it.
const RUNTIME_PLUGIN = { name: 'mcode-review', description: 'MCode Review: the PR review and author quiz skills of the CI pipeline.' };
const RUNTIME_SKILLS = ['pr-review', 'pr-quiz'];
const HOMEPAGE = 'https://github.com/MiniMax-AI/mcode-stack/tree/main/stacks/jiachen';
const DEFAULT_PLUGIN_PATH = 'stacks/jiachen';
const MAX_PATCH_BYTES = 6 * 1024 * 1024;
const DRY_RUN = env('MCODE_REVIEW_DRY_RUN') === '1';

// The host, and the work files in its checkout; set when a command starts.
let HOST;
let PROJECT_DIR;
let WORK;
let OUT;
let PLAN_FILE;
let ADDED_FILE;
let DIFF_FILE;
let DESCRIPTION_FILE;
let NOTES_FILE;
let QUIZ_OUT;

function init() {
  HOST = hostContext();
  PROJECT_DIR = HOST.projectDir;
  WORK = path.join(PROJECT_DIR, '.mcode-review');
  OUT = path.join(WORK, 'out');
  PLAN_FILE = path.join(WORK, 'plan.json');
  ADDED_FILE = path.join(WORK, 'added-lines.json');
  DIFF_FILE = path.join(WORK, 'diff.patch');
  DESCRIPTION_FILE = path.join(WORK, 'description.md');
  // The repository's notes on its known failure patterns, from the merge base.
  NOTES_FILE = path.join(WORK, 'repo-notes.md');
  QUIZ_OUT = path.join(OUT, 'quiz.json');
}

const lensOut = (lens) => path.join(OUT, 'lens-' + lens + '.json');
const modelsConfig = () => readJson(path.join(CI_ROOT, 'config', 'models.json'));

function pluginInfo() {
  const manifest = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), null) || readJson(path.join(PLUGIN_ROOT, '.minimax-plugin', 'plugin.json'), {});
  return { name: RUNTIME_PLUGIN.name, version: manifest.version || '0.0.0', ref: env('MCODE_REVIEW_PLUGIN_REF', 'local'), homepage: manifest.homepage || HOMEPAGE };
}

function loadProfile(name) {
  const base = readJson(path.join(CI_ROOT, 'config', 'repos', 'default.json'), {});
  const repo = name && name !== 'default' ? readJson(path.join(CI_ROOT, 'config', 'repos', name + '.json'), {}) : {};
  return mergeProfiles(base, repo);
}

// The bundled profile with the repository's own rule pack over it. CI reads the
// rule pack from the merge base (base); grade, which has no merge base, from
// the checkout.
function projectRules(base) {
  const rules = readRulePack({ cwd: PROJECT_DIR, base, profileFile: env('MCODE_REVIEW_PROFILE_FILE'), notesFile: env('MCODE_REVIEW_NOTES_FILE'), warn: log });
  return { rules, profile: applyRulePack(loadProfile(env('MCODE_REVIEW_REPO_PROFILE', 'default')), rules.profile) };
}

// The host's API, with the token of prepare, publish and grade.
const api = () => HOST.client();

function readPlan() {
  return readJson(PLAN_FILE, null);
}

// The first bytes of a file at a commit, enough to see a generated-code header.
function fileHead(sha, file) {
  const result = run('git', ['cat-file', '-p', sha + ':' + file], { cwd: PROJECT_DIR, allowFail: true });
  return result.code === 0 ? String(result.stdout).slice(0, 2048) : '';
}

function baseHasFile(base, file) {
  return run('git', ['cat-file', '-e', base + ':' + file], { cwd: PROJECT_DIR, allowFail: true }).code === 0;
}

function findSummary(notes, botId) {
  return notes.find((note) => note.author?.id === botId && String(note.body || '').includes(SUMMARY_MARKER)) || null;
}

// A dry run posts nothing, so it keeps the summary (and the state in it) in the
// work directory: consecutive dry runs then behave like consecutive rounds.
function priorSummary(notes, botId) {
  if (!DRY_RUN) return findSummary(notes, botId);
  const file = path.join(OUT, 'summary.md');
  return existsSync(file) ? { id: null, body: readFileSync(file, 'utf8') } : null;
}

function readTextFile(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

// The same for the quiz note: a dry run keeps it in the work directory, and
// the next dry run reads it as the newest comment on the PR.
function withDryRunQuiz(notes, botId) {
  const file = path.join(OUT, 'quiz-note.md');
  if (!DRY_RUN || !existsSync(file)) return notes;
  return [...notes, { id: Number.MAX_SAFE_INTEGER, author: { id: botId }, body: readFileSync(file, 'utf8'), updated_at: '' }];
}

// The output language of a pipeline: prepare resolves MCODE_REVIEW_LANGUAGE once
// and keeps it in the plan, so every job of one pipeline posts in one language.
const planLanguage = (plan) => resolveLanguage(plan?.language);

// The schema of an answer, for the prompt: mcode validates the final answer
// against --output-schema but does not show the schema to the model.
const schemaFor = (name) => readSchemaText(path.join(CI_ROOT, 'schema', name));
const minutesOf = (seconds) => Math.max(1, Math.round(seconds / 60));

function template(name, values) {
  const text = readFileSync(path.join(CI_ROOT, 'prompts', name), 'utf8');
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (values[key] === undefined ? '' : String(values[key])));
}

// ---------------------------------------------------------------- prepare

const REUSABLE_LENS_JOB = new Set(['success', 'running', 'pending', 'waiting_for_resource', 'created']);

// GitLab only. Lens jobs of the rounds since the last published one, newest
// first: finished, running or queued. A lens job reuses their results when it
// starts. One that was still running has finished by then: both hold the
// lens's resource group.
async function laterLensJobs(gl, iid, prior, currentPipelineId) {
  const found = [];
  const pipelines = await gl.mergeRequestPipelines(iid).catch(() => []);
  for (const pipeline of (pipelines || []).slice(0, 6)) {
    const bridges = await gl.bridges(pipeline.id).catch(() => []);
    for (const bridge of bridges || []) {
      const child = bridge.downstream_pipeline?.id;
      if (!child || child === currentPipelineId) continue;
      if (prior.pipeline_id && child <= prior.pipeline_id) continue;
      for (const job of (await gl.jobs(child).catch(() => [])) || []) {
        const lens = (String(job.name).match(/^mcode-review:review: \[([\w-]+)\]$/) || [])[1];
        if (lens && REUSABLE_LENS_JOB.has(job.status)) found.push({ id: job.id, lens, pipeline: child });
      }
    }
  }
  return found.sort((a, b) => b.pipeline - a.pipeline || b.id - a.id);
}

// Per lens, the lines the latest pushes added since that lens last finished a
// review (state.lenses keeps the head of each lens's last finished review). A
// finding first reported now, outside those lines, was in code its lens had
// already reviewed: it was found late, not caused by the latest push. A lens
// that never finished a review, for example because its model calls failed,
// has no baseline, so nothing it reports counts as found late.
function sinceLastReview(prior, head, files, lenses) {
  const delta = { lenses: {} };
  const added = new Map();
  for (const lens of lenses) {
    const last = prior.lenses?.[lens];
    if (!last?.head_sha || last.head_sha === head) continue;
    if (!added.has(last.head_sha)) {
      try {
        ensureCommit(last.head_sha, PROJECT_DIR);
        added.set(last.head_sha, new Map());
      } catch (error) {
        log('the head lens ' + lens + ' last reviewed (' + last.head_sha + ') is not available; its new findings are not split by round: ' + String(error.message).slice(0, 200));
        added.set(last.head_sha, null);
      }
    }
    const cache = added.get(last.head_sha);
    if (!cache) continue;
    const lines = {};
    for (const file of files) {
      if (file.mechanical || last.files?.[file.path] === file.fp) continue;
      if (!cache.has(file.path)) cache.set(file.path, [...addedLines(fileDiff(last.head_sha, head, file.path, null, PROJECT_DIR))]);
      lines[file.path] = cache.get(file.path);
    }
    delta.lenses[lens] = { since: last.head_sha, lines };
  }
  return delta;
}

// GitHub Actions reads a step's outputs from the file in GITHUB_OUTPUT: the
// workflow starts one review job per lens the tier uses, and the quiz job only
// when this round writes a quiz.
function stepOutputs({ lenses, quiz }) {
  const file = env('GITHUB_OUTPUT');
  if (file) appendFileSync(file, 'lenses=' + JSON.stringify(lenses) + '\nquiz=' + (quiz ? 'true' : 'false') + '\n');
}

async function prepare() {
  const ref = env('MCODE_REVIEW_PLUGIN_REF');
  const refProblem = pluginRefProblem(ref);
  if (refProblem) throw new ConfigError(refProblem);
  const templateProblem = templateVersionProblem(env('MCODE_REVIEW_TEMPLATE_VERSION'), { file: path.posix.join(env('MCODE_REVIEW_PLUGIN_PATH', DEFAULT_PLUGIN_PATH), HOST.templateFile), ref: ref.trim() });
  if (templateProblem) throw new ConfigError(templateProblem);
  const language = resolveLanguage(env('MCODE_REVIEW_LANGUAGE'), log);
  const gl = api();
  const iid = HOST.number();
  const ciHead = HOST.headSha;
  const mr = await gl.mergeRequest(iid);
  const plan = {
    schema: 1,
    created_at: new Date().toISOString(),
    host: HOST.host,
    pipeline_id: HOST.pipelineId,
    pipeline_url: HOST.pipelineUrl,
    plugin: pluginInfo(),
    phase: env('MCODE_REVIEW_PHASE', 'shadow'),
    language,
    clean_remote: HOST.cleanRemote,
  };
  if (ciHead && mr.sha && mr.sha !== ciHead) {
    writeJson(PLAN_FILE, { ...plan, superseded: true, reason: 'PR head is ' + mr.sha + ', this pipeline is for ' + ciHead });
    stepOutputs({ lenses: [], quiz: false });
    log('PR head moved to ' + mr.sha + '; this pipeline is superseded');
    return;
  }
  const head = mr.sha || ciHead;
  const base = mr.diff_refs.base_sha;
  ensureCommit(head, PROJECT_DIR);
  ensureCommit(base, PROJECT_DIR);
  checkoutDetached(head, PROJECT_DIR);

  // The repository's own rules, as they are at the merge base.
  const { rules, profile } = projectRules(base);
  if (rules.notes) writeText(NOTES_FILE, rules.notes);
  else rmSync(NOTES_FILE, { force: true });
  const stats = numstat(base, head, PROJECT_DIR);
  const files = nameStatus(base, head, PROJECT_DIR).map((file) => ({ ...file, ...(stats.get(file.path) || { additions: 0, deletions: 0, binary: false }) }));
  const diffs = new Map();
  const added = {};
  let diffBytes = 0;
  let patch = '';
  for (const file of files) {
    const diff = fileDiff(base, head, file.path, file.oldPath, PROJECT_DIR);
    diffs.set(file.path, diff);
    file.fp = fingerprint(diff);
    file.generated = file.status !== 'D' && !file.binary && isGeneratedText(fileHead(head, file.path));
    file.mechanical = isMechanical(file, profile);
    added[file.path] = [...addedLines(diff)];
    if (!file.mechanical) diffBytes += Buffer.byteLength(diff);
    if (Buffer.byteLength(patch) < MAX_PATCH_BYTES) patch += diff;
  }
  writeText(DIFF_FILE, patch);
  writeJson(ADDED_FILE, added);

  const reviewable = files.filter((file) => !file.mechanical);
  const hits = riskHits(files, profile, language);
  const tier = classifyTier(reviewable, diffBytes, hits, profile.tier_thresholds);
  const lenses = lensesForTier(tier);

  const bot = await gl.currentUser();
  const notes = await gl.notes(iid);
  const summary = priorSummary(notes, bot.id);
  const prior = (summary && extractState(summary.body)) || emptyState();
  const quizSettings = quizConfig(profile);
  const scope = quizScope({ files, profile, sourceBranch: mr.source_branch, lang: language });
  const quizPlan = quizRound({ notes: withDryRunQuiz(notes, bot.id), authorId: mr.author?.id, scope, config: quizSettings, legacy: isLegacyQuiz(prior.quiz) });
  const threads = readThreadIndex(await gl.discussions(iid).catch(() => []), bot.id);
  // What each lens may reuse: its last published review, and on GitLab the lens
  // jobs of later rounds that never published. The lens job decides when it
  // starts.
  const laterJobs = HOST.host === 'gitlab' ? await laterLensJobs(gl, iid, prior, plan.pipeline_id) : [];
  const reuse = Object.fromEntries(lenses.map((lens) => [lens, {
    published: prior.lenses?.[lens] ? { ...prior.lenses[lens], lens, status: 'complete' } : null,
    jobs: laterJobs.filter((job) => job.lens === lens).map((job) => job.id),
  }]));

  const arm = pickArm(modelsConfig().arms, iid);
  const reviewableDiffs = new Map(reviewable.map((file) => [file.path, diffs.get(file.path)]));
  const delta = sinceLastReview(prior, head, files, lenses);
  writeText(DESCRIPTION_FILE, sanitizeUntrusted(mr.description));
  writeJson(PLAN_FILE, {
    ...plan,
    superseded: false,
    mr: { iid, title: sanitizeUntrusted(mr.title), web_url: mr.web_url, author: { id: mr.author?.id, username: mr.author?.username }, source_branch: mr.source_branch, target_branch: mr.target_branch, draft: Boolean(mr.draft) },
    head_sha: head,
    base_sha: base,
    start_sha: mr.diff_refs.start_sha,
    repo_profile: profile.name,
    rule_pack: rules.sources,
    repo_notes: Boolean(rules.notes),
    stacks: stacksFor(reviewable, profile),
    tier,
    lenses,
    files: files.map(({ path: file, oldPath, status, score, additions, deletions, binary, fp, mechanical }) => ({ path: file, oldPath, status, score, additions, deletions, binary, fp, mechanical })),
    focus: rankFiles(reviewable, hits).slice(0, 60),
    risk: hits,
    description: descriptionCheck(mr.description, tier === 'L' || tier === 'XL' || hits.length > 0, language),
    ui_evidence_missing: uiEvidenceMissing(files, mr.description, profile),
    siblings: siblingSites(reviewableDiffs, PROJECT_DIR),
    instruction_files: instructionChanges(files, (file) => baseHasFile(base, file)),
    quiz: {
      enabled: quizSettings.enabled,
      needed: scope.needed,
      reason: scope.reason,
      why: scope.why || '',
      generate: quizPlan.generate,
      decision: quizPlan.why,
      count: quizSettings.questions,
      current: quizPlan.current,
      answered: quizPlan.answered,
      quizzes: quizPlan.quizzes,
      scope: { code_lines: scope.code_lines, code_files: scope.code_files, files_hash: scope.files_hash, file_keys: scope.file_keys },
      files: scope.files,
    },
    reuse,
    models: arm ? { arm: arm.id, lens: arm.lens, verify: arm.verify } : null,
    delta,
    asked: askedForPrompt(threads, mr.author?.id),
    prior: { round: prior.round || 0, consecutive_blocking: prior.consecutive_blocking || 0, head_sha: prior.head_sha || null, pipeline_id: prior.pipeline_id || null, later_jobs: laterJobs.length },
  });
  stepOutputs({ lenses, quiz: quizPlan.generate });
  log('prepared: tier ' + tier + ', ' + files.length + ' files, lenses ' + lenses.join(',') + ', language ' + language + '; quiz: ' + (quizPlan.generate ? 'write one' : 'none') + ' (' + quizPlan.why + ')' + (rules.sources.profile ? '; rule pack ' + rules.sources.profile : '') + (rules.sources.notes ? '; notes ' + rules.sources.notes : ''));
}

// ---------------------------------------------------------------- model jobs

function setupModelRuntime(plan, label) {
  ensureCommit(plan.head_sha, PROJECT_DIR);
  ensureCommit(plan.base_sha, PROJECT_DIR);
  checkoutDetached(plan.head_sha, PROJECT_DIR);
  scrubRemoteCredentials(PROJECT_DIR, plan.clean_remote);
  restoreInstructionFiles(plan.instruction_files || [], plan.base_sha, PROJECT_DIR);
  // Keep the pipeline's own files out of the model's searches.
  const exclude = path.resolve(PROJECT_DIR, run('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: PROJECT_DIR }).stdout.trim());
  mkdirSync(path.dirname(exclude), { recursive: true });
  if (!readTextFile(exclude).split('\n').includes('/.mcode-review/')) appendFileSync(exclude, '\n/.mcode-review/\n');
  const bin = installMcode({ prefix: path.join(WORK, 'npm'), version: env('MCODE_REVIEW_MCODE_VERSION', '0.7.6'), registry: env('MCODE_REVIEW_NPM_REGISTRY', 'https://registry.npmjs.org/') });
  const runtime = prepareRuntime({ root: path.join(WORK, 'runtime-' + label), pluginDir: PLUGIN_ROOT, plugin: { ...RUNTIME_PLUGIN, version: pluginInfo().version }, skills: RUNTIME_SKILLS });
  const config = modelsConfig();
  const configFile = path.join(runtime.root, 'config.json');
  writeRuntimeConfig({ file: configFile, apiKey: requiredEnv('MCODE_REVIEW_API_KEY'), baseUrl: requiredEnv('MCODE_REVIEW_BASE_URL'), modelsConfig: config });
  return { bin, runtime, configFile, config, proxy: env('MCODE_REVIEW_HTTPS_PROXY') };
}

// The PR's model arm decides the chain for finding and checking; without an arm
// the role chain from models.json applies. validate: see runWithFallback.
function callModel(rt, role, prompt, schemaName, outName, timeoutSec, chain, validate) {
  const spec = rt.config.roles[role];
  return runWithFallback({
    chain: chain?.length ? chain : spec.chain,
    validate,
    effort: spec.effort,
    bin: rt.bin,
    cwd: PROJECT_DIR,
    configFile: rt.configFile,
    providerId: (model) => providerIdFor(rt.config, model),
    prompt,
    schema: path.join(CI_ROOT, 'schema', schemaName),
    out: path.join(WORK, outName),
    timeoutSec,
    runtime: rt.runtime,
    proxy: rt.proxy,
  });
}

function fileList(plan, paths, lang) {
  const byPath = new Map(plan.files.map((file) => [file.path, file]));
  return paths.map((file) => {
    const info = byPath.get(file) || {};
    return '- ' + file + (info.oldPath && info.oldPath !== file ? t(lang, 'prompt.renamed', { old: info.oldPath }) : '') + ' [' + (info.status || '?') + ' +' + (info.additions || 0) + ' -' + (info.deletions || 0) + ']';
  }).join('\n') || '- (none)';
}

function renderSiblings(plan) {
  if (!plan.siblings?.length) return '(none)';
  return plan.siblings.map((item) => '- ' + item.kind + ' ' + item.symbol + ': added by this PR in ' + item.added_in.length + ' file(s) (' + item.added_in.join(', ') + '); present in ' + item.files + ' files: ' + item.sites.map((site) => site.path + ':' + site.line).join(', ')).join('\n');
}

function renderRecheck(findings) {
  if (!findings.length) return '(none)';
  return findings.map((finding) => '- ' + finding.id + ' [' + finding.severity + '] class=' + finding.class + ' symbol=' + (finding.symbol || '-') + ' at ' + finding.path + ':' + finding.line + ': ' + finding.title).join('\n');
}

// The schemas describe the allowed values without enforcing them (see
// core/vocab.mjs): an unexpected value falls back to a default here, and the log
// says so once per field and value.
const reportedValues = new Set();
function pickValue(value, allowed, fallback, what) {
  const found = matchValue(value, allowed);
  if (found) return found;
  const key = what + '=' + String(value ?? '');
  if (value !== undefined && value !== null && value !== '' && !reportedValues.has(key)) {
    reportedValues.add(key);
    log('unexpected ' + what + ' ' + JSON.stringify(String(value)).slice(0, 80) + ' in the model answer; using ' + (fallback === null ? 'nothing' : fallback));
  }
  return fallback;
}

function normalizeFindings(raw, lens, plan) {
  const known = new Set(plan.files.map((file) => file.path));
  return (raw || []).slice(0, 40).map((item) => {
    const severity = pickValue(item.severity, SEVERITIES, 'P2', 'severity');
    const file = String(item.path || '').replace(/^\.?\//, '');
    const level = Math.max(1, Math.min(5, Number(item.evidence_level) || 1));
    const cls = pickValue(item.class, FINDING_CLASSES, 'other', 'class');
    return {
      id: findingId(file, item.symbol, cls),
      lens,
      severity,
      type: pickValue(item.type, FINDING_TYPES, MAINTAINABILITY_CLASSES.includes(cls) ? 'maintainability' : 'defect', 'type'),
      class: cls,
      title: String(item.title || '').slice(0, 300),
      body: String(item.body || '').slice(0, 4000),
      path: file,
      line: Number.isInteger(item.line) ? item.line : 0,
      symbol: String(item.symbol || '').slice(0, 120),
      evidence_level: level,
      introduced: pickValue(item.introduced, INTRODUCED, 'unknown', 'introduced'),
      suggestion: String(item.suggestion || '').slice(0, 1500),
      related_paths: (item.related_paths || []).map(String).slice(0, 10),
      in_diff: known.has(file),
      verifier: severity === 'P0' || severity === 'P1' ? 'pending' : 'not_required',
    };
  }).filter((finding) => finding.severity !== 'P3' && finding.evidence_level >= 2);
}

function normalizeNeedsHuman(raw, lens) {
  return (raw || []).slice(0, 2).map((item) => {
    const paths = (item.paths || []).map(String).slice(0, 20);
    const kind = pickValue(item.kind, NEEDS_HUMAN_KINDS, 'other', 'needs_human kind');
    const title = String(item.title || '').slice(0, 200);
    const questions = (item.questions || []).map(String).slice(0, 4);
    return {
      id: 'NH-' + kind.replace(/_/g, '-') + '-' + sha256([kind, title, ...questions].join('|')).slice(0, 6),
      kind,
      title,
      why: String(item.why || '').slice(0, 800),
      questions,
      paths,
      lens,
    };
  });
}

const modelJobSecrets = () => credentialValues();

// The PR head right now, read with the job's own git credentials: jobs that run
// a model get no API token. If it cannot be read, the round goes on.
function prHeadMoved(plan) {
  const result = run('git', ['ls-remote', 'origin', HOST.headRef(plan.mr.iid)], { cwd: PROJECT_DIR, allowFail: true, timeoutMs: 30000 });
  const head = result.code === 0 ? String(result.stdout).split(/\s/)[0] : '';
  return Boolean(head) && head !== plan.head_sha;
}

// Which files this lens reviews now and which keep an earlier result. Sources,
// newest first: on GitLab, lens results of later rounds that never published,
// read with the CI job token; then the last published review.
async function planLens(plan, lensName) {
  const reuse = plan.reuse?.[lensName] || {};
  const results = [];
  const gl = reuse.jobs?.length ? HOST.jobClient() : null;
  if (gl) {
    for (const id of reuse.jobs) {
      const buffer = await gl.artifactFile(id, '.mcode-review/out/lens-' + lensName + '.json').catch((error) => {
        log('could not read the ' + lensName + ' result of job ' + id + ': ' + String(error.message).slice(0, 200));
        return null;
      });
      if (!buffer) continue;
      try {
        const data = JSON.parse(buffer.toString('utf8'));
        if (data.status === 'complete') results.push({ ...data, lens: lensName, job: id });
      } catch {
        // an unreadable result is not reused
      }
    }
  }
  const current = plan.files.filter((file) => !file.mechanical).map((file) => ({ path: file.path, fp: file.fp }));
  const sources = [...results, reuse.published].filter(Boolean);
  const planned = planReuse(lensName, current, sources);
  if (results.length) log('lens ' + lensName + ': reusing the results of job ' + results.map((item) => item.job).join(', '));
  // Files a model reviewed again since the last publish: the ones this round
  // reviews, and the ones it keeps from a later round that had reviewed them.
  // Publish closes a finding only on such a file.
  const fp = new Map(current.map((file) => [file.path, file.fp]));
  const fresh = new Set(planned.reviewFiles);
  for (const file of planned.reusedFiles) {
    const source = sources.find((item) => item.files?.[file] === fp.get(file));
    if (source && source !== reuse.published && (source.fresh_files || []).includes(file)) fresh.add(file);
  }
  return { review_files: planned.reviewFiles, reused_files: planned.reusedFiles, reused_findings: planned.reusedFindings, recheck: planned.recheck, sources: results.map((item) => item.job), fresh_files: [...fresh] };
}

async function lens() {
  const lensName = requiredEnv('MCODE_REVIEW_LENS');
  const save = (value) => writeJson(lensOut(lensName), redactSecrets(value, modelJobSecrets()));
  const plan = readPlan();
  if (!plan || plan.superseded) return log('no plan or superseded; skipping lens ' + lensName);
  if (!plan.lenses.includes(lensName)) return log('lens ' + lensName + ' is not used for tier ' + plan.tier + '; skipping');
  // Rounds of one PR queue per lens. When this one gets its turn, a newer push
  // may have overtaken it: then the newest round reviews and this one stops here.
  if (prHeadMoved(plan)) {
    save({ lens: lensName, head_sha: plan.head_sha, status: 'superseded' });
    return log('PR head moved past ' + shortSha(plan.head_sha) + '; skipping lens ' + lensName);
  }
  const lensPlan = await planLens(plan, lensName);
  const result = {
    lens: lensName,
    head_sha: plan.head_sha,
    status: 'complete',
    files: Object.fromEntries(plan.files.filter((file) => !file.mechanical).map((file) => [file.path, file.fp])),
    findings: [],
    needs_human: [],
    claims: [],
    rejected: [],
    model_called: false,
    arm: plan.models?.arm || null,
    reused_files: lensPlan.reused_files.length,
    review_files: lensPlan.review_files,
    fresh_files: lensPlan.fresh_files,
    reused_from: lensPlan.sources,
    stats: {},
  };
  if (!lensPlan.review_files.length) {
    result.findings = lensPlan.reused_findings;
    save(result);
    return log('lens ' + lensName + ': every file unchanged since the last review; reused previous results');
  }
  const rt = setupModelRuntime(plan, lensName);
  const timeouts = rt.config.timeouts;
  const lang = planLanguage(plan);
  const lensTimeout = timeouts.lens[plan.tier] || 1500;
  const prompt = template('lens.md', {
    pr_ref: HOST.ref(plan.mr.iid),
    host_name: HOST.name,
    lens: lensName,
    minutes: minutesOf(lensTimeout),
    output_schema: schemaFor('lens.schema.json'),
    lens_label: lensLabel(lensName, lang),
    output_language: t(lang, 'language.name'),
    repo: plan.repo_profile,
    stack_refs: stackRefs(plan.stacks),
    repo_notes: plan.repo_notes && existsSync(NOTES_FILE) ? '\n\nAlso read `' + path.relative(PROJECT_DIR, NOTES_FILE) + '`: the failure patterns this repository has seen before, from its .mcode-review.md at the merge base.' : '',
    tier: plan.tier,
    head: plan.head_sha,
    base: plan.base_sha,
    diff_path: path.relative(PROJECT_DIR, DIFF_FILE),
    files: fileList(plan, lensPlan.review_files, lang),
    reused_note: lensPlan.reused_files.length ? lensPlan.reused_files.length + ' other changed files are unchanged since the last completed review and keep their previous results; do not review them unless a file in your scope depends on them.' : '',
    focus: plan.focus.filter((file) => lensPlan.review_files.includes(file)).slice(0, 25).join(', ') || '(no ranking)',
    recheck: renderRecheck(lensPlan.recheck),
    siblings: renderSiblings(plan),
    asked: renderAsked(plan.asked),
    risk: plan.risk.map((hit) => hit.name + ': ' + hit.paths.slice(0, 5).join(', ')).join('\n') || '(none)',
    title: plan.mr.title,
    description: readFileSync(DESCRIPTION_FILE, 'utf8').slice(0, 20000),
  });
  const hunt = callModel(rt, 'lens', prompt, 'lens.schema.json', 'raw-lens-' + lensName + '.json', lensTimeout, plan.models?.lens);
  if (!hunt.ok) {
    result.status = 'failed';
    result.error = hunt.errors.join(' | ').slice(0, 1500);
    // Nobody re-checked the findings on changed files: keep them as they were.
    result.findings = mergeFindings([lensPlan.reused_findings, lensPlan.recheck.map((finding) => ({ ...finding, carried: true }))]);
    result.stats.hunt = { usage: hunt.usage, attempts: hunt.attempts };
    save(result);
    log('lens ' + lensName + ' failed: ' + result.error);
    log('to continue locally: install the pr-review skill (' + (plan.plugin?.homepage || HOMEPAGE) + ') and, on the PR branch, ask MiniMax Code: ' + localReviewAsk([lensName], plan.mr?.target_branch, 'en'));
    // Fail the job (it is allowed to fail) so the pipeline shows the gap.
    process.exitCode = 1;
    return;
  }
  result.model_called = true;
  result.stats.hunt = { model: hunt.model, seconds: Math.round(hunt.durationMs / 1000), usage: hunt.usage, attempts: hunt.attempts };
  // The model ran out of time and answered from what it had checked. Its
  // findings are posted and counted, but nobody knows which files it got to:
  // the result closes no thread, is never reused, and the round is incomplete.
  const partial = Boolean(hunt.salvaged);
  if (partial) {
    result.status = 'partial';
    result.error = t(lang, 'lens_status.partial_reason');
    result.fresh_files = [];
  }
  const candidates = normalizeFindings(hunt.data.findings, lensName, plan);
  const pending = candidates.filter((finding) => finding.verifier === 'pending');
  if (pending.length) {
    const verifyPrompt = template('verify.md', {
      pr_ref: HOST.ref(plan.mr.iid),
      host_name: HOST.name,
      minutes: minutesOf(timeouts.verify || 600),
      output_schema: schemaFor('verify.schema.json'),
      output_language: t(lang, 'language.name'),
      head: plan.head_sha,
      base: plan.base_sha,
      candidates: JSON.stringify(pending.map(({ id, severity, title, body, path: file, line, symbol, evidence_level }) => ({ id, severity, title, body, path: file, line, symbol, evidence_level })), null, 2),
    });
    const verify = callModel(rt, 'verify', verifyPrompt, 'verify.schema.json', 'raw-verify-' + lensName + '.json', timeouts.verify || 600, plan.models?.verify);
    const verdicts = new Map((verify.ok ? verify.data.results : []).map((item) => [item.id, item]));
    for (const finding of pending) {
      const item = verdicts.get(finding.id);
      if (!item) {
        finding.verifier = 'unverified';
        continue;
      }
      const verdict = pickValue(item.verdict, VERIFY_VERDICTS, 'uncertain', 'verdict');
      finding.verifier = verdict === 'confirmed' ? 'confirmed' : verdict === 'rejected' ? 'rejected' : 'unverified';
      finding.verifier_reason = String(item.reason || '').slice(0, 800);
      const suggested = pickValue(item.severity, SEVERITIES, null, 'verifier severity');
      if (verdict !== 'rejected' && suggested && suggested !== finding.severity) {
        finding.severity_pending = true;
        finding.severity_suggested = suggested;
      }
    }
    result.stats.verify = verify.ok
      ? { model: verify.model, seconds: Math.round(verify.durationMs / 1000), usage: verify.usage, attempts: verify.attempts }
      : { error: verify.errors.join(' | ').slice(0, 500), usage: verify.usage, attempts: verify.attempts };
  }
  result.rejected = candidates.filter((finding) => finding.verifier === 'rejected').map(({ id, title, verifier_reason }) => ({ id, title, reason: verifier_reason }));
  // A partial pass may not have got back to the earlier findings it was asked
  // to re-check; they stay as they were, like those of a failed pass.
  const carried = partial ? lensPlan.recheck.map((finding) => ({ ...finding, carried: true })) : [];
  result.findings = mergeFindings([lensPlan.reused_findings, candidates.filter((finding) => finding.verifier !== 'rejected'), carried]);
  result.needs_human = normalizeNeedsHuman(hunt.data.needs_human, lensName);
  result.claims = (hunt.data.claims || []).slice(0, 20).map((item) => ({ claim: String(item.claim || '').slice(0, 500), status: pickValue(item.status, CLAIM_STATUSES, 'unverified', 'claim status'), evidence: String(item.evidence || '').slice(0, 1000) }));
  save(result);
  log('lens ' + lensName + ': ' + result.findings.length + ' findings, ' + result.rejected.length + ' rejected by the verifier' + (partial ? '; the model ran out of time, so the pass counts as unfinished' : ''));
  // Fail the job (it is allowed to fail) so the pipeline shows the gap.
  if (partial) process.exitCode = 1;
}

// The author quiz. prepare decided whether this round writes one; the model
// writes a few more questions than the quiz keeps, the checks in core/quiz.mjs
// drop the unusable ones, and when fewer than MIN_QUESTIONS are left the model
// is asked once, in the same session, to rewrite them. Publish posts the note.
async function quiz() {
  const plan = readPlan();
  if (!plan || plan.superseded) return log('no plan or superseded; skipping quiz');
  if (!plan.quiz?.generate) return log('no quiz this round (' + (plan.quiz?.decision || 'no quiz plan') + ')');
  if (prHeadMoved(plan)) return log('PR head moved past ' + shortSha(plan.head_sha) + '; skipping quiz');
  const rt = setupModelRuntime(plan, 'quiz');
  const lang = planLanguage(plan);
  const count = plan.quiz.count;
  const ask = count + 1;
  // One prompt per language: each teaches the plain-language rules of its own.
  const quizTimeout = rt.config.timeouts.quiz || 900;
  const prompt = template('quiz.' + lang + '.md', {
    pr_ref: HOST.ref(plan.mr.iid),
    host_name: HOST.name,
    minutes: minutesOf(quizTimeout),
    output_schema: schemaFor('quiz.schema.json'),
    head: plan.head_sha,
    base: plan.base_sha,
    reason: plan.quiz.why,
    diff_path: path.relative(PROJECT_DIR, DIFF_FILE),
    files: fileList(plan, plan.quiz.files || [], lang),
    title: plan.mr.title,
    description: readFileSync(DESCRIPTION_FILE, 'utf8').slice(0, 20000),
    ask,
    count,
    quota: Math.ceil(ask / 2),
  });
  const checks = [];
  const validate = (data) => {
    const checked = normalizeQuiz(data, { count, lang });
    checks.push({ ...checked.stats, rejected: checked.rejected });
    return checked.questions.length >= MIN_QUESTIONS ? null : rewriteRequest(checked, { ask, lang });
  };
  const result = callModel(rt, 'quiz', prompt, 'quiz.schema.json', 'raw-quiz.json', quizTimeout, null, validate);
  const stats = { model: result.model, usage: result.usage, attempts: result.attempts, checks };
  if (!result.ok) {
    // Fails open: publish says so in the summary, and the next round tries again.
    writeJson(QUIZ_OUT, redactSecrets({ status: 'failed', head_sha: plan.head_sha, error: result.errors.join(' | ').slice(0, 800), stats }, modelJobSecrets()));
    return log('quiz generation failed: ' + result.errors.join(' | ').slice(0, 300));
  }
  const { questions } = normalizeQuiz(result.data, { count, lang });
  writeJson(QUIZ_OUT, redactSecrets({ status: 'complete', head_sha: plan.head_sha, questions, stats }, modelJobSecrets()));
  log('quiz: ' + questions.length + ' questions from ' + result.model + '; the checks dropped ' + checks.map((check) => check.dropped + ' of ' + check.written).join(', then '));
}

// ---------------------------------------------------------------- publish

// Questions that come from pipeline rules, not from a model. Each is a thread
// while its condition holds; the bot closes it when the condition clears. A lens
// that did not finish is the pipeline's problem, not the author's: the summary
// says so, and no thread asks the author about it.
function conditionNeedsHuman(plan, findings, consecutive, lang) {
  const items = [];
  for (const hit of plan.risk) {
    items.push({ id: 'NH-risk-' + hit.id, source: 'condition', kind: 'risk_path', title: t(lang, 'rule.risk.title', { name: hit.name }), why: t(lang, 'rule.risk.why', { paths: hit.paths.slice(0, 5).join(t(lang, 'list')), more: hit.paths.length > 5 ? t(lang, 'files_more', { n: hit.paths.length }) : '' }), questions: hit.questions, paths: hit.paths });
  }
  if (plan.description?.missing?.length) {
    items.push({ id: 'NH-desc', source: 'condition', kind: 'description', title: t(lang, 'rule.desc.title'), why: t(lang, 'rule.desc.why', { tier: plan.tier, sections: plan.description.missing.join(t(lang, 'list')) }), questions: [t(lang, 'rule.desc.question')], paths: [] });
  }
  if (plan.ui_evidence_missing) {
    items.push({ id: 'NH-ui', source: 'condition', kind: 'ui_evidence', title: t(lang, 'rule.ui.title'), why: t(lang, 'rule.ui.why'), questions: [t(lang, 'rule.ui.question')], paths: [] });
  }
  for (const finding of findings.filter((item) => item.severity_pending)) {
    items.push({ id: 'NH-sev-' + finding.id, source: 'condition', kind: 'severity', title: t(lang, 'rule.severity.title', { id: finding.id }), why: t(lang, 'rule.severity.why', { severity: finding.severity, suggested: finding.severity_suggested }), questions: [t(lang, 'rule.severity.question')], paths: [finding.path] });
  }
  if (consecutive >= 3) {
    items.push({ id: 'NH-rounds', source: 'condition', kind: 'non_convergence', title: t(lang, 'rule.rounds.title', { n: consecutive }), why: t(lang, 'rule.rounds.why'), questions: [t(lang, 'rule.rounds.question')], paths: [] });
  }
  return items;
}

// The changed file a thread goes on when it cannot go on a line: GitHub has no
// resolvable thread on a PR as a whole, so what GitLab opens on the PR goes on
// the most relevant changed file. The first candidate the PR changes and keeps,
// else the first such file that is not mechanical, else any.
function threadPath(plan, candidates) {
  const kept = plan.files.filter((file) => file.status !== 'D');
  const changed = new Set(kept.map((file) => file.path));
  return candidates.find((file) => changed.has(file)) || kept.find((file) => !file.mechanical)?.path || kept[0]?.path || plan.files[0]?.path || '';
}

async function applyThreadActions(gl, plan, mr, actions, index, lang) {
  const byPath = new Map(plan.files.map((file) => [file.path, file]));
  const place = (paths) => ({ path: threadPath(plan, paths.filter(Boolean)), head_sha: plan.head_sha });
  const created = new Map();
  const iid = plan.mr.iid;
  for (const action of actions) {
    if (DRY_RUN) {
      log('[dry-run] ' + action.type + ' thread ' + action.id + (action.finding ? ' at ' + action.finding.path + ':' + action.finding.line + (action.anchored ? '' : ' (not on a line)') : ''));
      continue;
    }
    const thread = index.get(action.id);
    try {
      if (action.type === 'create' && action.finding) {
        const finding = action.finding;
        const body = (anchored) => renderInlineFinding(finding, { anchored, lang }) + '\n\n' + threadMarker(findingMeta(finding));
        let discussion;
        if (action.anchored) {
          const position = { position_type: 'text', base_sha: mr.diff_refs.base_sha, start_sha: mr.diff_refs.start_sha, head_sha: mr.diff_refs.head_sha, new_path: finding.path, old_path: byPath.get(finding.path)?.oldPath || finding.path, new_line: finding.line };
          discussion = await gl.createDiscussion(iid, body(true), position).catch((error) => {
            if (finding.severity === 'P2') throw error;
            log('could not anchor ' + finding.id + ' (' + String(error.message).slice(0, 160) + '); opening it without a line');
            return gl.createDiscussion(iid, body(false), null, place([finding.path]));
          });
        } else {
          discussion = await gl.createDiscussion(iid, body(false), null, place([finding.path]));
        }
        created.set(action.id, { discussionId: discussion.id, noteId: discussion.notes?.[0]?.id || null });
      } else if (action.type === 'create') {
        const discussion = await gl.createDiscussion(iid, renderNeedsHumanThread(action.item, lang) + '\n\n' + threadMarker(questionMeta(action.item)), null, place(action.item.paths || []));
        created.set(action.id, { discussionId: discussion.id, noteId: discussion.notes?.[0]?.id || null });
      } else if (action.type === 'reopen') {
        await gl.resolveDiscussion(iid, thread.discussionId, false);
        await gl.replyDiscussion(iid, thread.discussionId, action.reply);
      } else if (action.type === 'resolve') {
        await gl.replyDiscussion(iid, thread.discussionId, action.reply);
        await gl.resolveDiscussion(iid, thread.discussionId, true);
      } else if (action.type === 'reply') {
        await gl.replyDiscussion(iid, thread.discussionId, renderNeedsHumanReply(action.item, lang) + '\n\n' + replyMarker(action.key));
      }
    } catch (error) {
      log('thread ' + action.type + ' ' + action.id + ' failed: ' + String(error.message).slice(0, 300));
    }
  }
  return created;
}

function feishuConfig() {
  const appId = env('MCODE_REVIEW_FEISHU_APP_ID');
  const secret = env('MCODE_REVIEW_FEISHU_APP_SECRET');
  const chatId = env('MCODE_REVIEW_FEISHU_CHAT_ID');
  return appId && secret && chatId ? { appId, secret, chatId } : null;
}

// target: the PR, as { iid, web_url }; noteId: a comment on it.
const noteUrl = (target, noteId) => commentLink(HOST.host, target.web_url, noteId, 'note');

// The emails that could @ mention the PR author in the quiz card, best first.
async function cardMentions(gl, iid, mr) {
  const domains = env('MCODE_REVIEW_FEISHU_EMAIL_DOMAINS').split(',').filter((domain) => domain.trim());
  if (!domains.length || !mr?.author?.username) return [];
  try {
    return authorEmails({ username: mr.author.username, commits: await gl.mergeRequestCommits(iid), domains, aliases: parseEmailAliases(env('MCODE_REVIEW_FEISHU_EMAIL_ALIASES')) });
  } catch (error) {
    log('quiz card: could not read the PR commits for the author mention: ' + String(error.message).slice(0, 200));
    return [];
  }
}

// Sends the quiz card to the group, or updates the card already sent. A
// repository without the Feishu variables gets no card.
async function quizCardMessage(gl, target, mr, current, summary, messageId, lang) {
  const feishu = feishuConfig();
  if (!feishu || DRY_RUN) return messageId || null;
  const base = { iid: target.iid, ref: HOST.ref(target.iid), url: noteUrl(target, current.note.id), quiz: current.quiz, summary };
  const mentions = await cardMentions(gl, target.iid, mr);
  const cards = [...mentions.map((mention) => renderCard(quizCard({ ...base, mention }), lang)), renderCard(quizCard(base), lang)];
  try {
    const token = await tenantToken(feishu.appId, feishu.secret);
    const deliver = (body) => (messageId ? updateCard(token, messageId, body).then(() => messageId) : sendCard(token, feishu.chatId, body));
    const { result, index } = await deliverFirstAccepted(deliver, cards);
    log('quiz card: ' + (index < mentions.length ? '@ ' + mentions[index] : 'no @, Feishu knows none of: ' + (mentions.join(', ') || 'no email to try')));
    return result;
  } catch (error) {
    log('feishu card failed: ' + error.message);
    return messageId || null;
  }
}

// Records the author's answers to the current quiz when they changed since the
// last record, and updates the card. publish runs it every round, grade on
// demand. The comments on the PR are the state; state.quiz only keeps the card id.
// The record and the card are in lang, whatever language the quiz note is in.
async function recordAnswers(gl, target, state, notes, mr, lang, current = findPublishedQuiz(notes, { authorId: mr.author?.id })) {
  if (!current) return null;
  const submission = findSubmission({ notes, current, authorId: mr.author?.id });
  const summary = summarizeSubmission(current.quiz, submission);
  if (!submission || !submissionChanged(findLatestResponse(notes, current.meta.quizId), summary, submission.source)) return { current, summary, recorded: false };
  const body = renderRecordNote(summary, { author: mr.author?.username, source: submission.source, stamp: submission.stamp, lang });
  if (DRY_RUN) log('[dry-run] quiz record:\n' + body);
  else await gl.createNote(target.iid, body);
  if (state.quiz?.v === 2 && state.quiz.id === current.meta.quizId && state.quiz.card_message_id) await quizCardMessage(gl, target, mr, current, summary, state.quiz.card_message_id, lang);
  return { current, summary, recorded: true };
}

// Posts the quiz the quiz job wrote, then records the author's answers. A
// sealed quiz of an older plugin version stays as it is. Returns what the
// summary says about the quiz.
async function syncQuiz(gl, plan, state, notes, mr, lang) {
  const settings = plan.quiz;
  if (!settings?.enabled) return null;
  const target = plan.mr;
  const authorId = mr.author?.id;
  let current = findPublishedQuiz(notes, { authorId });
  let failed = false;
  if (settings.generate) {
    const output = readJson(QUIZ_OUT, null);
    const written = output?.status === 'complete' && output.head_sha === plan.head_sha && (output.questions || []).length >= MIN_QUESTIONS;
    if (!written) {
      failed = true;
      log('quiz: none written this round (' + String(output?.error || 'no quiz result').slice(0, 300) + ')');
    } else if ((current?.meta.quizId || null) !== (settings.current?.id || null)) {
      log('quiz: another round posted a quiz after prepare; not posting this one');
    } else if (current && findSubmission({ notes, current, authorId })) {
      log('quiz: the author answered the current quiz after prepare; not posting a new one');
    } else {
      const body = renderQuizNote({ questions: output.questions }, { generatedAtSha: plan.head_sha, scope: settings.scope, again: Boolean(current), lang });
      let note = { id: null };
      if (DRY_RUN) {
        writeText(path.join(OUT, 'quiz-note.md'), body);
        log('[dry-run] quiz note written to .mcode-review/out/quiz-note.md');
      } else {
        note = await gl.createNote(target.iid, body);
      }
      current = { note: { ...note, body }, meta: parseQuizMeta(body), quiz: readQuiz(body) };
      state.quiz = { v: 2, id: current.meta.quizId, note_id: note.id || null, card_message_id: await quizCardMessage(gl, target, mr, current, null, null, lang) };
    }
  }
  if (!current) {
    if (isLegacyQuiz(state.quiz)) return { legacy: true, url: noteUrl(target, state.quiz.note_id) };
    return failed ? { failed: true } : null;
  }
  const { summary } = await recordAnswers(gl, target, state, notes, mr, lang, current);
  return { url: noteUrl(target, current.note.id), status: summary.answeredCount ? t(lang, 'quiz.status.answered', { answered: summary.answeredCount, total: summary.total }) : t(lang, 'quiz.status.unanswered'), failed };
}

// Which lenses answer for each finding: those whose last completed result
// reported it, and the lens recorded in its thread. A finding thread closes only
// when one of them reviewed the finding's file again since the last publish (in
// this round, or in a later round whose result this round kept), or the file is
// no longer part of the PR, and did not report it. A lens that failed, or never
// ran, says nothing about whether a problem is fixed.
function closeRule(plan, state, outputs) {
  const owners = new Map();
  for (const [lens, entry] of Object.entries(state.lenses || {})) {
    for (const finding of entry?.findings || []) owners.set(finding.id, new Set([...(owners.get(finding.id) || []), lens]));
  }
  const changed = new Set(plan.files.map((file) => file.path));
  const reviewed = new Map(plan.lenses.map((lens, index) => {
    const output = outputs[index];
    return [lens, output?.status === 'complete' ? new Set(output.fresh_files || []) : null];
  }));
  const looked = (lens, file) => {
    const files = reviewed.get(lens);
    return Boolean(files) && (files.has(file) || !changed.has(file));
  };
  return (thread) => {
    const responsible = new Set([...(owners.get(thread.id) || []), ...(thread.meta.lens ? [thread.meta.lens] : [])]);
    if (responsible.size) return [...responsible].some((lens) => looked(lens, thread.meta.path));
    return plan.lenses.every((lens) => looked(lens, thread.meta.path));
  };
}

async function publish() {
  const plan = readPlan();
  if (!plan) throw new Error('missing plan.json from mcode-review:prepare');
  if (plan.superseded) return log('superseded; nothing to publish');
  const lang = planLanguage(plan);
  const gl = api();
  const mr = await gl.mergeRequest(plan.mr.iid);
  if (mr.sha !== plan.head_sha) return log('PR head moved to ' + mr.sha + '; not publishing results for ' + plan.head_sha);
  const bot = await gl.currentUser();
  const notes = await gl.notes(plan.mr.iid);
  const summary = priorSummary(notes, bot.id);
  const state = { ...emptyState(), ...((summary && extractState(summary.body)) || {}) };
  for (const legacy of ['discussions', 'dismissals', 'acks']) delete state[legacy];
  const index = readThreadIndex(await gl.discussions(plan.mr.iid), bot.id);
  const fileFp = Object.fromEntries(plan.files.map((file) => [file.path, file.fp]));
  const headShort = shortSha(plan.head_sha);

  const outputs = plan.lenses.map((lens) => readJson(lensOut(lens), null));
  const incomplete = plan.lenses.map((lens, index) => ({ lens, output: outputs[index] })).filter((item) => !item.output || item.output.status !== 'complete').map((item) => ({ lens: item.lens, error: item.output?.error || t(lang, 'lens_status.no_result') }));
  let findings = dedupeSpots(mergeFindings(outputs.filter(Boolean).map((output) => output.findings || [])));
  const reportedBefore = new Set(Object.values(state.lenses || {}).flatMap((entry) => (entry?.findings || []).map((finding) => finding.id)));
  findings = markFoundLate(findings, reportedBefore, plan.delta);
  // A finding whose thread a person closed is dismissed: it stops counting and
  // its thread is never reopened.
  const added = readJson(ADDED_FILE, {});
  const findingPlan = planFindingThreads({ findings, index, headShort, anchorable: (finding) => (added[finding.path] || []).includes(finding.line), canClose: closeRule(plan, state, outputs), lang });
  const dismissedIds = new Set(findingPlan.dismissed.map((entry) => entry.finding.id));
  findings = findings.filter((finding) => !dismissedIds.has(finding.id));

  const modelCalled = outputs.some((output) => output?.model_called);
  const { round, consecutive } = nextRound(state, plan.pipeline_id, { modelCalled, complete: !incomplete.length, blocking: findings.some(isBlocking) });
  const conditionItems = conditionNeedsHuman(plan, findings, consecutive, lang);
  const modelItems = mergeNeedsHuman(outputs.flatMap((output) => output?.needs_human || [])).map((item) => ({ ...item, source: 'model' }));
  const questionActions = planQuestionThreads({ conditionItems, modelItems, index, headShort, lang });
  const created = await applyThreadActions(gl, plan, mr, [...findingPlan.actions, ...questionActions], index, lang);
  const attention = openQuestions(index, questionActions).map((item) => (item.noteId ? item : { ...item, noteId: created.get(item.id)?.noteId || null }));
  const verdict = computeVerdict({ findings, needsHuman: attention, consecutiveBlocking: consecutive, incomplete: incomplete.length });
  const quizInfo = await syncQuiz(gl, plan, state, withDryRunQuiz(notes, bot.id), mr, lang);
  const usage = addUsage(...outputs.filter(Boolean).flatMap((output) => [output.stats?.hunt?.usage, output.stats?.verify?.usage]), readJson(QUIZ_OUT, null)?.stats?.usage);

  state.lenses = Object.fromEntries(plan.lenses.map((lens, index) => {
    const output = outputs[index];
    if (output?.status === 'complete') return [lens, { lens, status: 'complete', head_sha: plan.head_sha, files: output.files, findings: output.findings }];
    return [lens, state.lenses?.[lens] || null];
  }).filter((entry) => entry[1]));
  Object.assign(state, { v: 1, head_sha: plan.head_sha, merge_base: plan.base_sha, pipeline_id: plan.pipeline_id, files: fileFp, round, consecutive_blocking: consecutive, last_verdict: verdict.verdict, updated_at: new Date().toISOString() });
  state.history = [...(state.history || []).filter((entry) => entry.pipeline !== plan.pipeline_id), { sha: plan.head_sha, pipeline: plan.pipeline_id, verdict: verdict.verdict, round, model_called: modelCalled, at: state.updated_at, tier: plan.tier, lenses: plan.lenses, language: lang, ...(plan.models?.arm ? { arm: plan.models.arm } : {}), ...(usage ? { usage } : {}) }].slice(-30);

  const lensStatus = plan.lenses.map((lens, index) => {
    const output = outputs[index];
    if (!output) return { lens, status: t(lang, 'lens_status.missing') };
    if (output.status === 'partial') return { lens, status: t(lang, 'lens_status.partial') + (output.stats?.hunt?.model ? t(lang, 'paren', { text: output.stats.hunt.model }) : '') };
    if (output.status !== 'complete') return { lens, status: t(lang, 'lens_status.failed') };
    if (!output.model_called) return { lens, status: t(lang, 'lens_status.reused') };
    // The model that actually answered: a fallback shows here.
    const notes = [output.reused_files ? t(lang, 'lens_status.partly_reused') : '', output.stats?.hunt?.model || ''].filter(Boolean);
    return { lens, status: t(lang, 'lens_status.done') + (notes.length ? t(lang, 'paren', { text: notes.join(t(lang, 'comma')) }) : '') };
  });
  const reusedFileCount = Math.max(0, ...outputs.filter(Boolean).map((output) => output.reused_files || 0));
  const dismissed = findingPlan.dismissed.map(({ finding, thread }) => ({ id: finding.id, title: finding.title, by: thread.resolvedBy?.username || '', reason: thread.humanReplies.at(-1)?.text || '' }));
  const fitted = fitSummary(renderSummary({ plan, verdict, findings, attention: verdict.attention, closed: closedQuestions(index, mr.author?.id), dismissed, quiz: quizInfo, round, consecutive, lensStatus, reusedFileCount, phase: plan.phase, incomplete, usage, lang }), state, HOST.commentLimit);
  if (fitted.dropped.length) log('the summary and its state are longer than a ' + HOST.name + ' comment may be (' + HOST.commentLimit.toLocaleString('en-US') + ' characters); the stored state leaves out ' + fitted.dropped.join(', then '));
  const body = fitted.body;
  writeText(path.join(OUT, 'summary.md'), body);
  writeJson(path.join(OUT, 'verdict.json'), { verdict: verdict.verdict, exit_code: verdict.exitCode, blocking: verdict.blocking.map((f) => f.id), attention: verdict.attention.map((i) => i.id), round, consecutive_blocking: consecutive, head_sha: plan.head_sha });
  if (DRY_RUN) return log('[dry-run] summary written to .mcode-review/out/summary.md; verdict ' + verdict.verdict);
  if (summary) await gl.updateNote(plan.mr.iid, summary.id, body);
  else await gl.createNote(plan.mr.iid, body);
  log('published verdict ' + verdict.verdict + ' for ' + plan.head_sha.slice(0, 10));
}

// ---------------------------------------------------------------- grade

// The grade job (manual on GitLab, on a person's PR comment on GitHub): records
// the author's answers now rather than at the next push. The child pipelines of
// older GitLab branches call it too. It has no plan, so it reads the language
// setting itself, and the rule pack from the checkout.
async function grade() {
  const lang = resolveLanguage(env('MCODE_REVIEW_LANGUAGE'), log);
  const gl = api();
  const iid = HOST.number();
  if (!quizConfig(projectRules(null).profile).enabled) return log('the author quiz is off for this repository');
  const mr = await gl.mergeRequest(iid);
  const bot = await gl.currentUser();
  const notes = withDryRunQuiz(await gl.notes(iid), bot.id);
  const summary = priorSummary(notes, bot.id);
  const state = { ...emptyState(), ...((summary && extractState(summary.body)) || {}) };
  const result = await recordAnswers(gl, { iid, web_url: mr.web_url }, state, notes, mr, lang);
  if (!result) return log('this PR has no quiz');
  log(result.recorded ? 'recorded the answers: ' + result.summary.answeredCount + '/' + result.summary.total : 'no new answers since the last record');
}

const commands = { prepare, lens, quiz, publish, grade };
const name = process.argv[2];
if (!commands[name]) {
  console.error('usage: review.mjs <' + Object.keys(commands).join('|') + '>');
  process.exit(2);
}
Promise.resolve().then(() => {
  init();
  return commands[name]();
}).catch((error) => {
  console.error('[mcode-review] ' + name + ' failed: ' + (error instanceof ConfigError ? error.message : error?.stack || error));
  process.exit(1);
});

#!/usr/bin/env node
// Weekly MCode Review metrics from prs.jsonl, the file collect.mjs writes.
// Pure computation: reads local files, writes metrics.json and metrics.md, and
// makes no network call. Definitions and caveats: ../references/metrics.md.
//
//   node metrics.mjs --in <dir>/prs.jsonl [--previous <old-dir>/metrics.json] --out <dir>
//                    [--since <iso>] [--until <iso>] [--sync-branches <regex>]
//
// Without --since and --until every record counts. With them, a PR counts as
// reviewed when one of its published runs falls in the window, threads and runs
// count when they were created in it, and the merge measures (coverage,
// unanswered at merge, time to merge, follow-up fixes) take PRs merged in it.
// Quantiles use the nearest rank, so every median and p90 is an observed value.

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Source branches of integration and sync PRs (main into a release branch, dev
// into main, sync/... branches). Their open-to-merge time measures a release
// cadence, not review, so it stays out of the time to merge.
export const DEFAULT_SYNC_BRANCHES = '^(main|master|trunk|dev|develop|staging|production)$|^releases?([/_-]|$)|(^|[/_-])sync([/_-]|$)';

export const GROUPS = [
  ['p0_p1', 'P0/P1 defects'],
  ['p2_defect', 'P2 defects'],
  ['maintainability', 'Maintainability'],
  ['leftover', 'Leftovers'],
  ['finding_other', 'Other findings'],
  ['rule_question', 'Rule questions'],
  ['model_question', 'Model questions'],
  ['question_other', 'Other questions'],
];

export const OUTCOMES = [
  ['fixed', 'Fixed or accepted'],
  ['rejected', 'Rejected'],
  ['deferred', 'Deferred'],
  ['other', 'Other'],
];

// The headline numbers, in the order of the metrics.md table. better: which
// direction is an improvement; null marks a number that only gives context.
export const HEADLINE = [
  { key: 'prs_reviewed', label: 'PRs reviewed', better: null, kind: 'count' },
  { key: 'threads', label: 'Bot threads', better: null, kind: 'count' },
  { key: 'merged_reviewed_share', label: 'Merged PRs the bot reviewed', better: 'higher', kind: 'share' },
  { key: 'threads_per_pr_median', label: 'Threads per reviewed PR, median', better: 'lower', kind: 'number' },
  { key: 'threads_per_pr_p90', label: 'Threads per reviewed PR, p90', better: 'lower', kind: 'number' },
  { key: 'threads_per_pr_max', label: 'Threads per reviewed PR, max', better: 'lower', kind: 'number' },
  { key: 'replied_share', label: 'Threads with a human reply', better: 'higher', kind: 'share' },
  { key: 'unanswered_at_merge_share', label: 'Threads unanswered at merge', better: 'lower', kind: 'share' },
  { key: 'fixed_share', label: 'Replied threads fixed or accepted', better: 'higher', kind: 'share' },
  { key: 'rejected_share', label: 'Replied threads rejected', better: 'lower', kind: 'share' },
  { key: 'deferred_share', label: 'Replied threads deferred', better: 'lower', kind: 'share' },
  { key: 'rounds_per_pr_median', label: 'Rounds per reviewed PR, median', better: 'lower', kind: 'number' },
  { key: 'rounds_per_pr_p90', label: 'Rounds per reviewed PR, p90', better: 'lower', kind: 'number' },
  { key: 'tokens_per_round_median', label: 'Tokens per round, median', better: 'lower', kind: 'count' },
  { key: 'tokens_per_round_p90', label: 'Tokens per round, p90', better: 'lower', kind: 'count' },
  { key: 'open_to_merge_hours_median', label: 'Open to merge, hours, median', better: 'lower', kind: 'number' },
  { key: 'open_to_merge_hours_p90', label: 'Open to merge, hours, p90', better: 'lower', kind: 'number' },
  { key: 'quiz_answer_rate', label: 'Author quizzes answered', better: 'higher', kind: 'share' },
  { key: 'follow_up_pairs', label: 'Follow-up fix pairs', better: 'lower', kind: 'count' },
  { key: 'follow_up_flagged', label: 'Follow-ups on a file the bot had a thread on', better: 'lower', kind: 'count' },
  { key: 'follow_up_not_flagged', label: 'Follow-ups on a reviewed PR without such a thread', better: 'lower', kind: 'count' },
];

// Reply outcomes. Rules run in order and the first match decides: explicit
// deferral, explicit rejection, signs of a fix or of agreement, weak deferral,
// rebuttal, plain acknowledgement. Hypothetical clauses ("if we ever ...",
// "如果以后 ...") are removed first so that they do not read as a deferral.
// Keyword matching is approximate; references/metrics.md says how to check it.
const PR_WORD = '(?:pr|mr|pull request|merge request|change|ticket|issue|iteration|release|version)';
const HYPOTHETICAL = [/\b(?:if|unless|in case)\b[^.!?;,\n]*/gi, /(?:如果|假如|要是|万一|假设)[^，。！？；,\n]*/g];
const OUTCOME_RULES = [
  ['deferred', new RegExp('\\bfollow[- ]?ups?\\b|\\b(?:separate|another|next|later|future|new) ' + PR_WORD + '\\b|\\bout of scope\\b|\\bnot in this ' + PR_WORD + '\\b|\\b(?:track|tracked|tracking) (?:in|it|this)\\b|\\btodo\\b|\\btech(?:nical)? debt\\b|\\bdefer(?:red|ring)?\\b|\\bpostpon', 'i')],
  ['deferred', /后续|之后再|以后再|回头再|下个\s*(?:pr|mr|版本|迭代)|下一个\s*(?:pr|mr|版本)|另开|另起|单独(?:提|开|做|处理|跟进)|二期|下期|排期|先不(?:改|动|处理)|暂(?:时)?不(?:改|动|处理)|技术债|记一下|记下来/i],
  ['rejected', /\bby design\b|\bas designed\b|\bintend(?:ed|ional|ionally)\b|\bexpected behaviou?r\b|\bworks as intended\b|\bwon'?t fix\b|\bwontfix\b|\bnot (?:a|an) (?:bug|problem|issue|concern)\b|\bfalse positive\b|\bnot applicable\b|\bno change (?:is )?(?:needed|required)\b|\b(?:keep|leave) (?:it |this )?as is\b|\bnot needed\b|\bunnecessary\b|\bcan(?:'?t|not) happen\b|\bwon'?t happen\b|\balready (?:handled|covered|checked|validated|guarded)\b/i],
  ['rejected', /设计如此|设计上就是|预期行为|符合预期|是预期的|有意为之|有意这样|故意的|不是\s*(?:问题|bug|缺陷)|误报|不需要(?:改|修改|处理|动)|无需(?:改|修改|改动|处理)|不用(?:改|修改|处理)|保持现状|保持不变|不改|不会发生|不会出现|已经(?:覆盖|校验|兜底)/i],
  // A commit hash: 7 to 40 hex characters with at least one digit and one letter.
  ['fixed', /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/i],
  ['fixed', /\b(?:fixed|fixes|fixing|done|addressed|resolved|updated|changed|added|removed|applied|reverted|renamed|refactored|good (?:catch|point)|nice catch|agreed?|makes sense|will (?:fix|do|update|change|add|remove)|you'?re right)\b/i],
  ['fixed', /已修|修复|修好|修了|已改|改了|改好|已处理|处理了|已调整|调整了|已补|补了|补上|已加|加了|已删|删了|删掉|已更新|更新了|已移除|采纳|接受|同意|有道理|确实|说得对/],
  ['deferred', /\b(?:later|eventually|someday|at some point|not now)\b/i],
  ['deferred', /稍后|回头|晚点|以后|再说/],
  ['rejected', /(?:^|[^a-z])(?:no|nope)\s*[,.!;]|\bdisagree\b|\b(?:it'?s|this is|that'?s) fine\b|\bnot true\b|\bincorrect\b|\bdoes(?:n'?t| not) apply\b|\birrelevant\b/i],
  ['rejected', /不会|不对|没必要|不存在|不涉及|不影响|没影响|无影响/],
  ['fixed', /\b(?:thanks|thank you|ok|okay|sure|yes|yep|lgtm|ack)\b/i],
  ['fixed', /好的|嗯|可以|收到|感谢|谢谢/],
];

export function classifyReply(texts) {
  let text = (Array.isArray(texts) ? texts : [texts]).filter((item) => item !== null && item !== undefined).map(String).join('\n');
  for (const pattern of HYPOTHETICAL) text = text.replace(pattern, ' ');
  for (const [outcome, pattern] of OUTCOME_RULES) if (pattern.test(text)) return outcome;
  return 'other';
}

export function threadGroup(thread) {
  if (thread?.kind === 'finding') {
    const severity = String(thread.severity || '').toUpperCase();
    if (severity === 'P0' || severity === 'P1') return 'p0_p1';
    if (thread.type === 'maintainability') return 'maintainability';
    if (thread.type === 'leftover') return 'leftover';
    if (severity === 'P2' && thread.type === 'defect') return 'p2_defect';
    return 'finding_other';
  }
  if (thread?.source === 'condition') return 'rule_question';
  if (thread?.source === 'model') return 'model_question';
  return 'question_other';
}

export function quantile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  // The small epsilon keeps floating-point noise in p * n from moving the rank.
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length - 1e-9)));
  return sorted[rank - 1];
}

export function parseJsonl(text) {
  const records = [];
  let invalid = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) records.push(value);
      else invalid += 1;
    } catch {
      invalid += 1;
    }
  }
  return { records, invalid };
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function ratio(part, whole) {
  return whole ? round(part / whole) : null;
}

function time(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function distribution(values, digits = null) {
  const finite = values.filter((value) => Number.isFinite(value));
  const shape = (value) => (digits === null || value === null ? value : round(value, digits));
  return {
    n: finite.length,
    median: shape(quantile(finite, 0.5)),
    p90: shape(quantile(finite, 0.9)),
    max: finite.length ? shape(finite.reduce((a, b) => Math.max(a, b))) : null,
  };
}

function spread(values) {
  return { median: quantile(values, 0.5), p90: quantile(values, 0.9), sum: values.reduce((a, b) => a + b, 0) };
}

function makeWindow(since, until) {
  const lo = time(since);
  const hi = time(until);
  const active = lo !== null || hi !== null;
  return {
    active,
    since: since || null,
    until: until || null,
    has(value) {
      if (!active) return true;
      const ms = time(value);
      return ms !== null && (lo === null || ms >= lo) && (hi === null || ms < hi);
    },
  };
}

function emptyThreadStats() {
  return { threads: 0, replied: 0, resolved: 0, resolved_by_person: 0, resolved_by_bot: 0, merged_threads: 0, unanswered_at_merge: 0 };
}

function addThread(stats, thread) {
  stats.threads += 1;
  if (Number(thread.human_replies) > 0) stats.replied += 1;
  if (thread.resolved) {
    stats.resolved += 1;
    if (thread.resolved_by_bot) stats.resolved_by_bot += 1;
    else stats.resolved_by_person += 1;
  }
}

function shareThreadStats(stats) {
  return {
    threads: stats.threads,
    replied: ratio(stats.replied, stats.threads),
    resolved: ratio(stats.resolved, stats.threads),
    resolved_by_person: ratio(stats.resolved_by_person, stats.threads),
    resolved_by_bot: ratio(stats.resolved_by_bot, stats.threads),
    merged_threads: stats.merged_threads,
    unanswered_at_merge: stats.unanswered_at_merge,
    unanswered_at_merge_share: ratio(stats.unanswered_at_merge, stats.merged_threads),
  };
}

// A thread on a merged PR, opened before the merge, was unanswered at merge
// when nobody had replied by then and no person resolved it. The record has no
// resolve time, so a person's resolve counts whenever it happened, and a reply
// without a time counts as answered.
function answeredByMerge(thread, mergedAt) {
  if (thread.resolved && !thread.resolved_by_bot) return true;
  if (Number(thread.human_replies) > 0) {
    const replied = time(thread.first_human_reply_at);
    return replied === null || replied <= mergedAt;
  }
  return false;
}

const TIER_ORDER = ['S', 'M', 'L', 'XL'];

function tierSort(a, b) {
  const ia = TIER_ORDER.indexOf(a);
  const ib = TIER_ORDER.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return a.localeCompare(b);
}

export function computeMetrics(records, options = {}) {
  const window = makeWindow(options.since, options.until);
  const syncPattern = options.syncBranches || DEFAULT_SYNC_BRANCHES;
  const sync = new RegExp(syncPattern);
  const prs = records.filter((record) => record && typeof record === 'object');
  const keyOf = (pr, number = pr.number) => (pr.project || '') + '#' + Number(number);
  const byKey = new Map(prs.map((pr) => [keyOf(pr), pr]));
  const everReviewed = (pr) => Boolean(pr.summary) || (pr.history || []).length > 0;
  const runsOf = (pr) => (pr.history || []).filter((entry) => entry && window.has(entry.at));
  const threadsOf = (pr) => (pr.threads || []).filter((thread) => thread && window.has(thread.created_at));
  const isReviewed = (pr) => (window.active ? runsOf(pr).length > 0 : everReviewed(pr));
  const isMerged = (pr) => pr.state === 'merged' && time(pr.merged_at) !== null && window.has(pr.merged_at);

  const reviewed = prs.filter(isReviewed);
  const merged = prs.filter(isMerged);

  // Coverage and rounds.
  const byState = {};
  for (const pr of prs) byState[pr.state || 'unknown'] = (byState[pr.state || 'unknown'] || 0) + 1;
  const mergedReviewed = merged.filter(everReviewed).length;
  const coverage = {
    prs: prs.length,
    by_state: byState,
    reviewed: reviewed.length,
    merged: merged.length,
    merged_reviewed: mergedReviewed,
    merged_reviewed_share: ratio(mergedReviewed, merged.length),
  };
  const rounds = {
    rounds_per_pr: distribution(reviewed.map((pr) => runsOf(pr).filter((entry) => entry.model_called).length)),
    runs_per_pr: distribution(reviewed.map((pr) => runsOf(pr).length)),
  };

  // Threads.
  const perPr = reviewed.map((pr) => threadsOf(pr).length);
  const rows = prs.flatMap((pr) => threadsOf(pr).map((thread) => ({ pr, thread, group: threadGroup(thread) })));
  const groupStats = Object.fromEntries(GROUPS.map(([id]) => [id, emptyThreadStats()]));
  const kindStats = {};
  const kindOf = (thread) => (kindStats[thread.kind || 'unknown'] ||= emptyThreadStats());
  const all = emptyThreadStats();
  for (const { thread, group } of rows) {
    addThread(groupStats[group], thread);
    addThread(all, thread);
    if (group === 'rule_question') addThread(kindOf(thread), thread);
  }

  // Unanswered at merge: threads opened before the merge of a merged PR.
  let mergedWithThreads = 0;
  let mergedWithUnanswered = 0;
  for (const pr of merged) {
    const mergedAt = time(pr.merged_at);
    const before = (pr.threads || []).filter((thread) => thread && (time(thread.created_at) === null || time(thread.created_at) <= mergedAt));
    if (before.length) mergedWithThreads += 1;
    let unanswered = 0;
    for (const thread of before) {
      const group = threadGroup(thread);
      const open = !answeredByMerge(thread, mergedAt);
      const targets = [groupStats[group], all];
      if (group === 'rule_question') targets.push(kindOf(thread));
      for (const stats of targets) {
        stats.merged_threads += 1;
        if (open) stats.unanswered_at_merge += 1;
      }
      if (open) unanswered += 1;
    }
    if (unanswered) mergedWithUnanswered += 1;
  }

  const zero = perPr.filter((count) => count === 0).length;
  const threads = {
    total: all.threads,
    per_pr: { ...distribution(perPr), zero, zero_share: ratio(zero, perPr.length) },
    all: shareThreadStats(all),
    by_group: Object.fromEntries(GROUPS.map(([id]) => [id, shareThreadStats(groupStats[id])])),
    rule_questions_by_kind: Object.fromEntries(Object.keys(kindStats).sort().map((kind) => [kind, shareThreadStats(kindStats[kind])])),
  };
  const unansweredAtMerge = {
    merged_prs: merged.length,
    merged_prs_with_threads: mergedWithThreads,
    prs_with_unanswered: mergedWithUnanswered,
    threads: all.merged_threads,
    unanswered: all.unanswered_at_merge,
    share: ratio(all.unanswered_at_merge, all.merged_threads),
  };

  // Outcomes of replied threads.
  const emptyOutcomes = () => ({ replied: 0, fixed: 0, rejected: 0, deferred: 0, other: 0 });
  const outcomeAll = emptyOutcomes();
  const outcomeGroups = Object.fromEntries(GROUPS.map(([id]) => [id, emptyOutcomes()]));
  for (const { thread, group } of rows) {
    if (!(Number(thread.human_replies) > 0)) continue;
    const outcome = classifyReply(thread.human_reply_texts || []);
    for (const stats of [outcomeAll, outcomeGroups[group]]) {
      stats.replied += 1;
      stats[outcome] += 1;
    }
  }
  const withShares = (stats) => ({ ...stats, fixed_share: ratio(stats.fixed, stats.replied), rejected_share: ratio(stats.rejected, stats.replied), deferred_share: ratio(stats.deferred, stats.replied), other_share: ratio(stats.other, stats.replied) });
  const outcomes = { ...withShares(outcomeAll), by_group: Object.fromEntries(GROUPS.map(([id]) => [id, withShares(outcomeGroups[id])])) };

  // Cost per round: runs that called a model, with the usage the bot stored.
  const modelRuns = prs.flatMap((pr) => runsOf(pr).filter((entry) => entry.model_called).map((entry) => ({ pr, entry })));
  const priced = modelRuns.filter(({ entry }) => entry.usage && typeof entry.usage === 'object');
  const part = (usage, name) => Number(usage[name]) || 0;
  const total = (usage) => part(usage, 'input') + part(usage, 'output') + part(usage, 'cache_read');
  const tiers = {};
  for (const { pr, entry } of priced) (tiers[entry.tier || pr.summary?.tier || 'unknown'] ||= []).push(total(entry.usage));
  const cost = {
    rounds: modelRuns.length,
    rounds_without_usage: modelRuns.length - priced.length,
    total: spread(priced.map(({ entry }) => total(entry.usage))),
    input: spread(priced.map(({ entry }) => part(entry.usage, 'input'))),
    output: spread(priced.map(({ entry }) => part(entry.usage, 'output'))),
    cache_read: spread(priced.map(({ entry }) => part(entry.usage, 'cache_read'))),
    by_tier: Object.fromEntries(Object.keys(tiers).sort(tierSort).map((tier) => [tier, { rounds: tiers[tier].length, ...spread(tiers[tier]) }])),
  };

  // Time to merge, without sync-like source branches.
  const timed = merged.filter((pr) => time(pr.created_at) !== null);
  const kept = timed.filter((pr) => !sync.test(pr.source_branch || ''));
  const speed = {
    open_to_merge_hours: distribution(kept.map((pr) => (time(pr.merged_at) - time(pr.created_at)) / 3600000), 2),
    excluded_sync: timed.length - kept.length,
    sync_branch_pattern: syncPattern,
  };

  // Author quiz.
  const quizPrs = reviewed.filter((pr) => pr.quiz && Number(pr.quiz.posted) > 0);
  const answeredQuiz = quizPrs.filter((pr) => pr.quiz.answered).length;
  const quiz = {
    prs_with_quiz: quizPrs.length,
    posted: quizPrs.reduce((sum, pr) => sum + Number(pr.quiz.posted), 0),
    answered_prs: answeredQuiz,
    answer_rate: ratio(answeredQuiz, quizPrs.length),
  };

  // Follow-up fixes: a merged PR whose fixes field names an earlier PR.
  const pairs = [];
  const fixPrs = merged.filter((pr) => Array.isArray(pr.fixes) && pr.fixes.length);
  for (const fix of fixPrs) {
    const fixFiles = new Set(fix.files || []);
    for (const number of [...new Set(fix.fixes.map(Number))].filter((value) => Number.isFinite(value) && value !== Number(fix.number))) {
      const earlier = byKey.get(keyOf(fix, number));
      let split = 'missing';
      let flagged = [];
      let shared = [];
      if (earlier) {
        shared = (earlier.files || []).filter((file) => fixFiles.has(file));
        if (!everReviewed(earlier)) split = 'not_reviewed';
        else {
          flagged = [...new Set((earlier.threads || []).map((thread) => thread?.path).filter((file) => file && fixFiles.has(file)))];
          split = flagged.length ? 'flagged' : 'not_flagged';
        }
      }
      pairs.push({ fix: Number(fix.number), earlier: number, split, fix_url: fix.url || null, earlier_url: earlier?.url || null, earlier_state: earlier?.state || null, flagged_files: flagged, shared_files: shared });
    }
  }
  const countSplit = (split) => pairs.filter((pair) => pair.split === split).length;
  const followUps = {
    fix_prs: fixPrs.length,
    pairs: pairs.length,
    flagged: countSplit('flagged'),
    not_flagged: countSplit('not_flagged'),
    not_reviewed: countSplit('not_reviewed'),
    missing: countSplit('missing'),
    list: pairs,
  };

  const headline = {
    prs_reviewed: reviewed.length,
    threads: threads.total,
    merged_reviewed_share: coverage.merged_reviewed_share,
    threads_per_pr_median: threads.per_pr.median,
    threads_per_pr_p90: threads.per_pr.p90,
    threads_per_pr_max: threads.per_pr.max,
    replied_share: threads.all.replied,
    unanswered_at_merge_share: unansweredAtMerge.share,
    fixed_share: outcomes.fixed_share,
    rejected_share: outcomes.rejected_share,
    deferred_share: outcomes.deferred_share,
    rounds_per_pr_median: rounds.rounds_per_pr.median,
    rounds_per_pr_p90: rounds.rounds_per_pr.p90,
    tokens_per_round_median: cost.total.median,
    tokens_per_round_p90: cost.total.p90,
    open_to_merge_hours_median: speed.open_to_merge_hours.median,
    open_to_merge_hours_p90: speed.open_to_merge_hours.p90,
    quiz_answer_rate: quiz.answer_rate,
    follow_up_pairs: followUps.pairs,
    follow_up_flagged: followUps.flagged,
    follow_up_not_flagged: followUps.not_flagged,
  };

  const previousHeadline = options.previous?.headline && typeof options.previous.headline === 'object' ? options.previous.headline : null;
  const delta = previousHeadline
    ? Object.fromEntries(HEADLINE.map(({ key }) => [key, Number.isFinite(headline[key]) && Number.isFinite(previousHeadline[key]) ? round(headline[key] - previousHeadline[key]) : null]))
    : null;

  return {
    version: 1,
    generated_at: options.now || new Date().toISOString(),
    input: { file: options.inputFile || null, records: prs.length, invalid_lines: options.invalidLines || 0 },
    window: { since: window.since, until: window.until },
    previous_file: options.previousFile || null,
    headline,
    previous: previousHeadline ? Object.fromEntries(HEADLINE.map(({ key }) => [key, Number.isFinite(previousHeadline[key]) ? previousHeadline[key] : null])) : null,
    delta,
    coverage,
    rounds,
    threads,
    unanswered_at_merge: unansweredAtMerge,
    outcomes,
    cost,
    speed,
    quiz,
    follow_ups: followUps,
  };
}

const thousands = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function show(value, kind) {
  if (value === null || value === undefined) return 'n/a';
  if (kind === 'share') return (value * 100).toFixed(1) + '%';
  if (kind === 'count') return thousands(Math.round(value));
  return String(round(value, 2));
}

function showDelta(value, kind) {
  if (value === null || value === undefined) return 'n/a';
  if (value === 0) return '0';
  const sign = value > 0 ? '+' : '-';
  if (kind === 'share') return sign + Math.abs(value * 100).toFixed(1) + ' pts';
  if (kind === 'count') return sign + thousands(Math.abs(Math.round(value)));
  return sign + String(round(Math.abs(value), 2));
}

const BT = '\x60';
const code = (text) => BT + text + BT;
const pct = (value) => (value === null || value === undefined ? 'n/a' : (value * 100).toFixed(1) + '%');
const ofTotal = (part, whole) => (whole ? part + ' of ' + whole : 'n/a');
const prLink = (number, url) => (url ? '[#' + number + '](' + url + ')' : '#' + number);
const SPLITS = {
  flagged: 'The earlier PR had a bot thread on a file the fix changed',
  not_flagged: 'The earlier PR was reviewed, with no bot thread on those files',
  not_reviewed: 'The earlier PR was never reviewed',
  missing: 'The earlier PR is not in the input',
};

export function renderMarkdown(metrics) {
  const lines = [];
  const { coverage, rounds, threads, outcomes, cost, speed, quiz } = metrics;
  const followUps = metrics.follow_ups;
  const states = Object.entries(coverage.by_state).map(([state, count]) => state + ' ' + count).join(', ');
  lines.push('# MCode Review metrics', '');
  lines.push('- Input: ' + (metrics.input.file ? code(metrics.input.file) + ', ' : '') + coverage.prs + ' PRs (' + (states || 'none') + ')' + (metrics.input.invalid_lines ? ', ' + metrics.input.invalid_lines + ' unreadable lines skipped' : ''));
  lines.push('- Window: ' + (metrics.window.since || metrics.window.until ? (metrics.window.since || 'start') + ' to ' + (metrics.window.until || 'now') + ' (end excluded)' : 'every record in the input'));
  lines.push('- Previous run: ' + (metrics.previous ? (metrics.previous_file ? code(metrics.previous_file) : 'given') : 'none'));
  lines.push('- Definitions: ' + code('references/metrics.md') + ' of the pr-review-tuning skill. Medians and p90 are nearest-rank values. Reply outcomes come from keyword patterns and are approximate.');
  lines.push('', '## Headline', '', '| Metric | This run | Previous | Change | Direction |', '| --- | ---: | ---: | ---: | --- |');
  for (const item of HEADLINE) {
    const direction = item.better ? item.better + ' is better' : 'context';
    const now = metrics.headline[item.key];
    const before = metrics.previous ? metrics.previous[item.key] : null;
    // A share's change is taken from the two shown percentages, so the row adds up.
    const change = item.kind === 'share' && Number.isFinite(now) && Number.isFinite(before)
      ? showDelta(round(Number((now * 100).toFixed(1)) - Number((before * 100).toFixed(1)), 1) / 100, 'share')
      : metrics.delta ? showDelta(metrics.delta[item.key], item.kind) : 'n/a';
    lines.push('| ' + item.label + ' | ' + show(now, item.kind) + ' | ' + (metrics.previous ? show(before, item.kind) : 'n/a') + ' | ' + change + ' | ' + direction + ' |');
  }

  lines.push('', '## Coverage and rounds', '');
  lines.push('Reviewed PRs: ' + coverage.reviewed + '. Merged PRs: ' + coverage.merged + ', of which the bot reviewed ' + ofTotal(coverage.merged_reviewed, coverage.merged) + ' (' + pct(coverage.merged_reviewed_share) + '). Reviewed PRs without a thread: ' + threads.per_pr.zero + ' (' + pct(threads.per_pr.zero_share) + ').');
  lines.push('', '| Per reviewed PR | PRs | Median | p90 | Max |', '| --- | ---: | ---: | ---: | ---: |');
  const distRow = (label, value) => '| ' + label + ' | ' + value.n + ' | ' + show(value.median, 'number') + ' | ' + show(value.p90, 'number') + ' | ' + show(value.max, 'number') + ' |';
  lines.push(distRow('Rounds (runs that called a model)', rounds.rounds_per_pr));
  lines.push(distRow('Runs (published review runs)', rounds.runs_per_pr));
  lines.push(distRow('Threads', threads.per_pr));

  lines.push('', '## Threads by group', '');
  lines.push('Shares are of the threads in each row. Unanswered at merge counts threads opened before the merge of a merged PR that nobody had replied to and no person had resolved.');
  lines.push('', '| Group | Threads | Share | Replied | Resolved | By a person | By the bot | Unanswered at merge |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const groupRow = (label, stats) => '| ' + label + ' | ' + stats.threads + ' | ' + pct(ratio(stats.threads, threads.total)) + ' | ' + pct(stats.replied) + ' | ' + pct(stats.resolved) + ' | ' + pct(stats.resolved_by_person) + ' | ' + pct(stats.resolved_by_bot) + ' | ' + ofTotal(stats.unanswered_at_merge, stats.merged_threads) + ' |';
  for (const [id, label] of GROUPS) {
    const stats = threads.by_group[id];
    if (!stats.threads && !stats.merged_threads) continue;
    lines.push(groupRow(label, stats));
    if (id === 'rule_question') for (const [kind, kindStats] of Object.entries(threads.rule_questions_by_kind)) lines.push(groupRow('Rule questions, ' + kind, kindStats));
  }
  lines.push(groupRow('All', threads.all));
  lines.push('', 'Merged PRs with a thread: ' + metrics.unanswered_at_merge.merged_prs_with_threads + '; with a thread unanswered at merge: ' + metrics.unanswered_at_merge.prs_with_unanswered + '.');

  lines.push('', '## Replied threads by outcome', '');
  lines.push('Classified from the reply texts with English and Chinese keyword patterns. Approximate: judge a sample by hand before relying on a share.');
  lines.push('', '| Group | Replied | Fixed or accepted | Rejected | Deferred | Other |', '| --- | ---: | ---: | ---: | ---: | ---: |');
  const outcomeRow = (label, stats) => '| ' + label + ' | ' + stats.replied + ' | ' + stats.fixed + ' | ' + stats.rejected + ' | ' + stats.deferred + ' | ' + stats.other + ' |';
  for (const [id, label] of GROUPS) if (outcomes.by_group[id].replied) lines.push(outcomeRow(label, outcomes.by_group[id]));
  lines.push('| All | ' + outcomes.replied + ' | ' + outcomes.fixed + ' (' + pct(outcomes.fixed_share) + ') | ' + outcomes.rejected + ' (' + pct(outcomes.rejected_share) + ') | ' + outcomes.deferred + ' (' + pct(outcomes.deferred_share) + ') | ' + outcomes.other + ' (' + pct(outcomes.other_share) + ') |');

  lines.push('', '## Cost per round', '');
  lines.push('Tokens of each run that called a model, from the usage the bot stores with the run: input, output and cache reads added up. They are priced differently, so read the parts too.' + (cost.rounds_without_usage ? ' Runs without stored usage, left out: ' + cost.rounds_without_usage + '.' : ''));
  lines.push('', '| Rounds | Count | Median | p90 | Sum |', '| --- | ---: | ---: | ---: | ---: |');
  const costRow = (label, count, value) => '| ' + label + ' | ' + count + ' | ' + show(value.median, 'count') + ' | ' + show(value.p90, 'count') + ' | ' + show(value.sum, 'count') + ' |';
  const pricedRounds = cost.rounds - cost.rounds_without_usage;
  lines.push(costRow('All tiers, tokens', pricedRounds, cost.total));
  for (const [tier, value] of Object.entries(cost.by_tier)) lines.push(costRow('Tier ' + tier + ', tokens', value.rounds, value));
  lines.push(costRow('All tiers, input', pricedRounds, cost.input));
  lines.push(costRow('All tiers, output', pricedRounds, cost.output));
  lines.push(costRow('All tiers, cache reads', pricedRounds, cost.cache_read));

  lines.push('', '## Time to merge', '');
  const hours = speed.open_to_merge_hours;
  lines.push('Hours from opening to merge, for merged PRs whose source branch does not match ' + code(speed.sync_branch_pattern) + ': ' + hours.n + ' PRs, median ' + show(hours.median, 'number') + ', p90 ' + show(hours.p90, 'number') + ', max ' + show(hours.max, 'number') + '. Left out as sync-like: ' + speed.excluded_sync + '.');

  lines.push('', '## Author quiz', '');
  lines.push('Reviewed PRs with a quiz: ' + quiz.prs_with_quiz + '. Quizzes posted: ' + quiz.posted + '. PRs whose author answered: ' + quiz.answered_prs + ' (' + pct(quiz.answer_rate) + ').');

  lines.push('', '## Follow-up fixes', '');
  lines.push('A pair is a merged PR whose fixes field names an earlier PR. It says only that one PR fixes another, not that a review could have seen the problem: judge every pair by hand. Fix PRs: ' + followUps.fix_prs + '. Pairs: ' + followUps.pairs + '.');
  lines.push('', '| Split | Pairs |', '| --- | ---: |');
  for (const [split, label] of Object.entries(SPLITS)) lines.push('| ' + label + ' | ' + followUps[split] + ' |');
  if (followUps.list.length) {
    lines.push('', '| Fix PR | Earlier PR | Split | Fixed files with a bot thread on the earlier PR | Files both changed |', '| --- | --- | --- | --- | --- |');
    const files = (list) => list.map(code).join(', ');
    for (const pair of followUps.list) lines.push('| ' + prLink(pair.fix, pair.fix_url) + ' | ' + prLink(pair.earlier, pair.earlier_url) + ' | ' + pair.split.replace('_', ' ') + ' | ' + files(pair.flagged_files) + ' | ' + files(pair.shared_files) + ' |');
  }
  return lines.join('\n') + '\n';
}

const USAGE = 'usage: node metrics.mjs --in <dir>/prs.jsonl [--previous <old-dir>/metrics.json] --out <dir> [--since <iso>] [--until <iso>] [--sync-branches <regex>]';

function fail(message) {
  console.error('metrics: ' + message + '\n' + USAGE);
  process.exit(2);
}

export function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        in: { type: 'string' },
        out: { type: 'string' },
        previous: { type: 'string' },
        since: { type: 'string' },
        until: { type: 'string' },
        'sync-branches': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return fail(error.message);
  }
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (!values.in || !values.out) return fail('--in and --out are required');
  for (const name of ['since', 'until']) if (values[name] !== undefined && time(values[name]) === null) return fail('--' + name + ' is not a date: ' + values[name]);
  if (values['sync-branches'] !== undefined) {
    try {
      new RegExp(values['sync-branches']);
    } catch (error) {
      return fail('--sync-branches is not a regular expression: ' + error.message);
    }
  }
  let text;
  try {
    text = readFileSync(values.in, 'utf8');
  } catch (error) {
    return fail('cannot read ' + values.in + ': ' + error.message);
  }
  const { records, invalid } = parseJsonl(text);
  let previous = null;
  if (values.previous) {
    try {
      previous = JSON.parse(readFileSync(values.previous, 'utf8'));
    } catch (error) {
      console.error('metrics: ignoring --previous ' + values.previous + ': ' + error.message);
    }
  }
  const metrics = computeMetrics(records, {
    since: values.since,
    until: values.until,
    syncBranches: values['sync-branches'],
    previous,
    inputFile: values.in,
    previousFile: previous ? values.previous : null,
    invalidLines: invalid,
  });
  mkdirSync(values.out, { recursive: true });
  const jsonFile = path.join(values.out, 'metrics.json');
  const mdFile = path.join(values.out, 'metrics.md');
  writeFileSync(jsonFile, JSON.stringify(metrics, null, 2) + '\n');
  writeFileSync(mdFile, renderMarkdown(metrics));
  if (invalid) console.error('metrics: skipped ' + invalid + ' unreadable lines in ' + values.in);
  console.log('metrics: ' + metrics.coverage.prs + ' PRs, ' + metrics.coverage.reviewed + ' reviewed, ' + metrics.threads.total + ' threads; wrote ' + jsonFile + ' and ' + mdFile);
}

// Run only when started as a script, also through a symlinked path.
const invoked = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) main(process.argv.slice(2));

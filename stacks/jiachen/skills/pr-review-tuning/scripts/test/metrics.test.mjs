import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HEADLINE, classifyReply, computeMetrics, parseJsonl, quantile, renderMarkdown, threadGroup } from '../metrics.mjs';

// The fixture holds eight made-up PRs of acme/app. The expected numbers below
// were worked out by hand from it; see the comments next to each assertion.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'metrics.mjs');
const FIXTURES = path.join(HERE, 'fixtures', 'metrics');
const PRS = path.join(FIXTURES, 'prs.jsonl');
const PREVIOUS = path.join(FIXTURES, 'previous-metrics.json');
const records = () => parseJsonl(readFileSync(PRS, 'utf8')).records;
const previous = () => JSON.parse(readFileSync(PREVIOUS, 'utf8'));

test('quantiles take the nearest rank, so every median and p90 was observed', () => {
  assert.equal(quantile([3, 1, 2, 5, 4, 6, 8, 7, 10, 9], 0.5), 5);
  assert.equal(quantile([3, 1, 2, 5, 4, 6, 8, 7, 10, 9], 0.9), 9);
  assert.equal(quantile([1, 2], 0.5), 1);
  assert.equal(quantile([7], 0.9), 7);
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile(Array.from({ length: 50 }, (_, i) => i + 1), 0.9), 45);
});

test('threads are grouped by kind, severity, type and source', () => {
  assert.equal(threadGroup({ kind: 'finding', severity: 'P0', type: 'defect' }), 'p0_p1');
  assert.equal(threadGroup({ kind: 'finding', severity: 'P1', type: 'maintainability' }), 'p0_p1');
  assert.equal(threadGroup({ kind: 'finding', severity: 'P2', type: 'defect' }), 'p2_defect');
  assert.equal(threadGroup({ kind: 'finding', severity: 'P2', type: 'maintainability' }), 'maintainability');
  assert.equal(threadGroup({ kind: 'finding', severity: 'P2', type: 'leftover' }), 'leftover');
  assert.equal(threadGroup({ kind: 'finding', severity: 'P2' }), 'finding_other');
  assert.equal(threadGroup({ kind: 'risk_path', source: 'condition' }), 'rule_question');
  assert.equal(threadGroup({ kind: 'design_direction', source: 'model' }), 'model_question');
  assert.equal(threadGroup({ kind: 'other' }), 'question_other');
});

test('reply outcomes follow English and Chinese patterns, after hypotheticals are removed', () => {
  const cases = [
    [['Good catch, fixed in 3f9a2c1.'], 'fixed'],
    [['Screenshot added in the description.'], 'fixed'],
    [['LGTM'], 'fixed'],
    [['好的，已改'], 'fixed'],
    [['已修复，见 a1b2c3d4'], 'fixed'],
    [['Will do this in a follow-up PR.'], 'deferred'],
    [['Later.'], 'deferred'],
    [['后续 PR 处理'], 'deferred'],
    [["Won't fix: intended."], 'rejected'],
    [['Not needed: the migration runs automatically.', 'ok'], 'rejected'],
    [['这是设计如此，不需要改'], 'rejected'],
    [['这个是有意为之'], 'rejected'],
    [['No, this path is never reached.'], 'rejected'],
    [['@bob can you take a look?'], 'other'],
    [[], 'other'],
    // Without removing the "if" clause these would read as deferrals.
    [['If we add a second caller in a follow-up, this needs a lock.'], 'other'],
    [['如果以后要支持多租户再改'], 'other'],
  ];
  for (const [texts, expected] of cases) assert.equal(classifyReply(texts), expected, JSON.stringify(texts));
});

test('unreadable lines are skipped and counted', () => {
  const { records: parsed, invalid } = parseJsonl('{"number":1}\nnot json\n\n[1]\n{"number":2}\r\n');
  assert.deepEqual(parsed.map((record) => record.number), [1, 2]);
  assert.equal(invalid, 2);
});

test('coverage, rounds and threads per PR, counting reviewed PRs without a thread as zero', () => {
  const metrics = computeMetrics(records());
  // 101, 102, 104, 105, 106 and 108 were reviewed; 103 and 107 never were.
  assert.equal(metrics.coverage.prs, 8);
  assert.deepEqual(metrics.coverage.by_state, { merged: 6, open: 1, closed: 1 });
  assert.equal(metrics.coverage.reviewed, 6);
  // Merged: 101, 102, 103, 104, 106, 107; the bot reviewed 101, 102, 104, 106.
  assert.equal(metrics.coverage.merged, 6);
  assert.equal(metrics.coverage.merged_reviewed, 4);
  assert.equal(metrics.coverage.merged_reviewed_share, 0.6667);
  // Threads per reviewed PR: 3, 2, 5, 2, 0, 1.
  assert.deepEqual(metrics.threads.per_pr, { n: 6, median: 2, p90: 5, max: 5, zero: 1, zero_share: 0.1667 });
  assert.equal(metrics.threads.total, 13);
  // Rounds are runs that called a model (104's third run reused results).
  assert.deepEqual(metrics.rounds.rounds_per_pr, { n: 6, median: 1, p90: 2, max: 2 });
  assert.deepEqual(metrics.rounds.runs_per_pr, { n: 6, median: 1, p90: 3, max: 3 });
});

test('groups report reply and resolve shares and what was unanswered at merge', () => {
  const { threads, unanswered_at_merge: unanswered } = computeMetrics(records());
  assert.deepEqual(threads.by_group.p0_p1, { threads: 3, replied: 0.3333, resolved: 0.3333, resolved_by_person: 0, resolved_by_bot: 0.3333, merged_threads: 2, unanswered_at_merge: 1, unanswered_at_merge_share: 0.5 });
  assert.equal(threads.by_group.p2_defect.threads, 1);
  assert.equal(threads.by_group.maintainability.threads, 2);
  assert.equal(threads.by_group.maintainability.replied, 1);
  assert.equal(threads.by_group.leftover.resolved_by_bot, 1);
  assert.equal(threads.by_group.leftover.unanswered_at_merge, 1);
  assert.deepEqual(threads.by_group.rule_question, { threads: 3, replied: 0.3333, resolved: 0.6667, resolved_by_person: 0.3333, resolved_by_bot: 0.3333, merged_threads: 3, unanswered_at_merge: 1, unanswered_at_merge_share: 0.3333 });
  assert.deepEqual(Object.keys(threads.rule_questions_by_kind), ['description', 'risk_path', 'ui_evidence']);
  assert.equal(threads.rule_questions_by_kind.description.unanswered_at_merge, 1);
  assert.equal(threads.rule_questions_by_kind.risk_path.resolved_by_person, 1);
  assert.equal(threads.by_group.model_question.threads, 3);
  assert.equal(threads.by_group.model_question.replied, 1);
  assert.equal(threads.all.replied, 0.5385);
  // Ten threads were opened before a merge. Unanswered: 102's two (one reply came
  // after the merge) and 104's P0, the leftover and the description question
  // (both only resolved by the bot).
  assert.deepEqual(unanswered, { merged_prs: 6, merged_prs_with_threads: 3, prs_with_unanswered: 2, threads: 10, unanswered: 5, share: 0.5 });
});

test('outcomes, cost per round by tier, time to merge and the quiz', () => {
  const metrics = computeMetrics(records());
  const { outcomes, cost, speed, quiz } = metrics;
  assert.deepEqual([outcomes.replied, outcomes.fixed, outcomes.rejected, outcomes.deferred, outcomes.other], [7, 2, 2, 2, 1]);
  assert.equal(outcomes.fixed_share, 0.2857);
  assert.equal(outcomes.by_group.maintainability.deferred, 2);
  assert.equal(outcomes.by_group.model_question.rejected, 2);
  // Tokens per round: 10500, 26000, 42000, 103000, 125000, 208000, 510000, 520000.
  assert.equal(cost.rounds, 8);
  assert.equal(cost.rounds_without_usage, 0);
  assert.deepEqual(cost.total, { median: 103000, p90: 520000, sum: 1544500 });
  assert.deepEqual(cost.input, { median: 60000, p90: 400000, sum: 970000 });
  assert.deepEqual(Object.keys(cost.by_tier), ['S', 'M', 'L', 'XL']);
  assert.deepEqual(cost.by_tier.S, { rounds: 3, median: 26000, p90: 42000, sum: 78500 });
  assert.deepEqual(cost.by_tier.XL, { rounds: 2, median: 510000, p90: 520000, sum: 1030000 });
  // Hours to merge: 24, 2, 6, 12, 3; 104 comes from dev and is left out.
  assert.deepEqual(speed.open_to_merge_hours, { n: 5, median: 6, p90: 24, max: 24 });
  assert.equal(speed.excluded_sync, 1);
  assert.deepEqual(quiz, { prs_with_quiz: 3, posted: 4, answered_prs: 1, answer_rate: 0.3333 });
  // A custom pattern decides what counts as a sync branch.
  assert.equal(computeMetrics(records(), { syncBranches: '^docs/' }).speed.open_to_merge_hours.n, 5);
});

test('follow-up pairs are split by whether the earlier PR had a bot thread on a fixed file', () => {
  const { follow_ups: followUps } = computeMetrics(records());
  assert.equal(followUps.fix_prs, 3);
  assert.deepEqual([followUps.pairs, followUps.flagged, followUps.not_flagged, followUps.not_reviewed, followUps.missing], [4, 1, 1, 1, 1]);
  const split = Object.fromEntries(followUps.list.map((pair) => [pair.fix + '>' + pair.earlier, pair.split]));
  assert.deepEqual(split, { '102>99': 'missing', '106>101': 'flagged', '107>103': 'not_reviewed', '107>104': 'not_flagged' });
  const flagged = followUps.list.find((pair) => pair.split === 'flagged');
  assert.deepEqual(flagged.flagged_files, ['src/auth/login.ts']);
  assert.deepEqual(flagged.shared_files, ['src/auth/login.ts']);
});

test('a window keeps the runs, threads and merges inside it', () => {
  const metrics = computeMetrics(records(), { since: '2026-01-06T00:00:00Z', until: '2026-01-09T00:00:00Z' });
  // Runs in the window: 102, 104 (two) and 105; the end is excluded, so 106's run is out.
  assert.equal(metrics.coverage.reviewed, 3);
  assert.deepEqual(metrics.threads.per_pr, { n: 3, median: 2, p90: 2, max: 2, zero: 0, zero_share: 0 });
  assert.equal(metrics.threads.total, 6);
  assert.deepEqual(metrics.rounds.rounds_per_pr, { n: 3, median: 1, p90: 1, max: 1 });
  assert.deepEqual(metrics.rounds.runs_per_pr, { n: 3, median: 1, p90: 2, max: 2 });
  // Merged in the window: 101, 102, 103.
  assert.equal(metrics.coverage.merged, 3);
  assert.equal(metrics.coverage.merged_reviewed_share, 0.6667);
  assert.deepEqual(metrics.speed.open_to_merge_hours, { n: 3, median: 6, p90: 24, max: 24 });
  assert.equal(metrics.unanswered_at_merge.threads, 5);
  assert.equal(metrics.unanswered_at_merge.unanswered, 2);
  assert.deepEqual(metrics.cost.total, { median: 208000, p90: 510000, sum: 760000 });
  assert.deepEqual([metrics.follow_ups.pairs, metrics.follow_ups.missing], [1, 1]);
  assert.deepEqual(metrics.quiz, { prs_with_quiz: 2, posted: 3, answered_prs: 0, answer_rate: 0 });
  assert.equal(metrics.outcomes.replied, 4);
});

test('the delta compares the headline numbers with the previous run', () => {
  const metrics = computeMetrics(records(), { previous: previous() });
  assert.equal(metrics.delta.prs_reviewed, 1);
  assert.equal(metrics.delta.threads_per_pr_p90, -2);
  assert.equal(metrics.delta.unanswered_at_merge_share, -0.1);
  assert.equal(metrics.delta.merged_reviewed_share, 0.1667);
  assert.equal(metrics.delta.tokens_per_round_median, 13000);
  // A number the previous run did not have has no delta.
  assert.equal(metrics.delta.open_to_merge_hours_median, null);
  assert.equal(metrics.previous.open_to_merge_hours_median, null);
  assert.equal(computeMetrics(records()).delta, null);
});

test('metrics.md has one headline row per number, each with its direction', () => {
  const markdown = renderMarkdown(computeMetrics(records(), { previous: previous() }));
  assert.match(markdown, /\| Metric \| This run \| Previous \| Change \| Direction \|/);
  const headline = markdown.split('## Headline')[1].split('\n## ')[0];
  const rows = headline.split('\n').filter((line) => /\| (lower is better|higher is better|context) \|$/.test(line));
  assert.equal(rows.length, HEADLINE.length);
  assert.match(markdown, /\| Threads per reviewed PR, p90 \| 5 \| 7 \| -2 \| lower is better \|/);
  assert.match(markdown, /\| Threads unanswered at merge \| 50\.0% \| 60\.0% \| -10\.0 pts \| lower is better \|/);
  assert.match(markdown, /\| Merged PRs the bot reviewed \| 66\.7% \| 50\.0% \| \+16\.7 pts \| higher is better \|/);
  assert.match(markdown, /\| \[#106\]\(https:\/\/github\.com\/acme\/app\/pull\/106\) \| \[#101\]/);
});

test('the command writes metrics.json and metrics.md', () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'pr-review-metrics-'));
  try {
    const run = spawnSync(process.execPath, [SCRIPT, '--in', PRS, '--previous', PREVIOUS, '--out', out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /8 PRs, 6 reviewed, 13 threads/);
    const written = JSON.parse(readFileSync(path.join(out, 'metrics.json'), 'utf8'));
    assert.deepEqual(written.headline, computeMetrics(records()).headline);
    assert.equal(written.delta.threads_per_pr_p90, -2);
    assert.ok(existsSync(path.join(out, 'metrics.md')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the command explains wrong arguments', () => {
  const missing = spawnSync(process.execPath, [SCRIPT, '--out', os.tmpdir()], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--in and --out are required/);
  assert.match(missing.stderr, /usage: node metrics\.mjs --in/);
  const date = spawnSync(process.execPath, [SCRIPT, '--in', PRS, '--out', os.tmpdir(), '--since', 'last week'], { encoding: 'utf8' });
  assert.equal(date.status, 2);
  assert.match(date.stderr, /--since is not a date/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { embedState, extractState, findingId, fitSummary, planReuse } from '../core/state.mjs';

const finding = (path, symbol, cls, extra = {}) => ({ id: findingId(path, symbol, cls), path, symbol, class: cls, severity: 'P1', ...extra });

test('finding ids depend on path, symbol and class, not on wording', () => {
  assert.equal(findingId('a.ts', 'f', 'contract-break'), findingId('a.ts', 'f', 'contract-break'));
  assert.notEqual(findingId('a.ts', 'f', 'contract-break'), findingId('a.ts', 'g', 'contract-break'));
  assert.match(findingId('a.ts', '', 'other'), /^F-[0-9a-f]{6}$/);
});

test('state survives a round trip through the summary note', () => {
  const state = { v: 1, round: 2, lenses: { general: { files: { 'a.ts': 'x' } } } };
  const body = 'summary text\n\n' + embedState(state);
  assert.deepEqual(extractState(body), state);
  assert.equal(extractState('no state here'), null);
});

test('a clean rebase reuses every file and calls no model', () => {
  const source = { lens: 'general', status: 'complete', files: { 'a.ts': 'fa', 'b.ts': 'fb' }, findings: [finding('a.ts', 'f', 'behavior-regression')] };
  const plan = planReuse('general', [{ path: 'a.ts', fp: 'fa' }, { path: 'b.ts', fp: 'fb' }], [source]);
  assert.deepEqual(plan.reviewFiles, []);
  assert.equal(plan.reusedFindings.length, 1);
});

test('only changed files are reviewed again; their old findings go to re-check', () => {
  const onA = finding('a.ts', 'f', 'behavior-regression');
  const onB = finding('b.ts', 'g', 'contract-break');
  const crossing = finding('b.ts', 'h', 'parallel-impl-missed', { related_paths: ['a.ts'] });
  const source = { lens: 'general', status: 'complete', files: { 'a.ts': 'fa', 'b.ts': 'fb' }, findings: [onA, onB, crossing] };
  const plan = planReuse('general', [{ path: 'a.ts', fp: 'fa-changed' }, { path: 'b.ts', fp: 'fb' }], [source]);
  assert.deepEqual(plan.reviewFiles, ['a.ts']);
  assert.deepEqual(plan.reusedFindings.map((f) => f.id), [onB.id]);
  assert.deepEqual(plan.recheck.map((f) => f.id).sort(), [onA.id, crossing.id].sort());
});

test('results of another lens or an incomplete run are never reused', () => {
  const other = { lens: 'security', status: 'complete', files: { 'a.ts': 'fa' }, findings: [] };
  const failed = { lens: 'general', status: 'failed', files: { 'a.ts': 'fa' }, findings: [] };
  assert.deepEqual(planReuse('general', [{ path: 'a.ts', fp: 'fa' }], [other, failed]).reviewFiles, ['a.ts']);
});

// A state as big as a large PR makes it: thirty rounds of history and forty
// findings per lens whose texts do not compress.
function bigState() {
  const findings = (lens) => Array.from({ length: 40 }, (_, index) => finding('src/f' + index + '.ts', 'symbol' + index, 'other', { lens, title: 'Problem ' + index, body: randomBytes(1000).toString('hex'), suggestion: randomBytes(200).toString('hex'), verifier_reason: 'checked' }));
  const lenses = Object.fromEntries(['behavior', 'contracts'].map((lens) => [lens, { lens, status: 'complete', head_sha: 'a'.repeat(40), files: { 'src/f0.ts': 'fp' }, findings: findings(lens) }]));
  const history = Array.from({ length: 30 }, (_, index) => ({ sha: randomBytes(20).toString('hex'), pipeline: 100 + index, verdict: 'pass', round: index + 1, model_called: true, at: '2026-01-01T00:00:00.000Z', tier: 'L', lenses: ['behavior', 'contracts'], language: 'en' }));
  return { v: 1, round: 30, files: { 'src/f0.ts': 'fp' }, lenses, history };
}

test('a summary within the limit keeps its whole state', () => {
  const state = { v: 1, round: 1, history: [{ round: 1 }], lenses: {} };
  const fitted = fitSummary('summary', state, 65536);
  assert.equal(fitted.body, 'summary\n\n' + embedState(state));
  assert.deepEqual(fitted.dropped, []);
});

test('a state too big for a comment gives way: old history first, then the long texts of the findings, never the ids', () => {
  const state = bigState();
  const text = '<!-- mcode-review:summary -->\n## MCode Review: ✅ Pass';
  assert.ok(('x\n\n' + embedState(state)).length > 65536, 'the test state is over the limit');
  const fitted = fitSummary(text, state, 65536);
  assert.ok(fitted.body.length <= 65536);
  assert.ok(fitted.body.startsWith(text + '\n\n'));
  assert.deepEqual(fitted.dropped, ['history before the last 10 rounds', 'history before the last 3 rounds', 'history before this round', 'the long texts of the findings']);
  const kept = extractState(fitted.body);
  assert.deepEqual(kept.history.map((entry) => entry.round), [30], 'the round just published stays');
  for (const lens of ['behavior', 'contracts']) {
    assert.deepEqual(kept.lenses[lens].findings.map((item) => item.id), state.lenses[lens].findings.map((item) => item.id));
    assert.deepEqual(kept.lenses[lens].files, { 'src/f0.ts': 'fp' }, 'fingerprints for reuse stay');
    const [first] = kept.lenses[lens].findings;
    assert.deepEqual([first.body, first.suggestion, first.verifier_reason, first.title, first.path, first.symbol], [undefined, undefined, undefined, 'Problem 0', 'src/f0.ts', 'symbol0']);
  }
});

test('history alone gives way when that is enough', () => {
  const state = bigState();
  for (const entry of Object.values(state.lenses)) entry.findings = entry.findings.slice(0, 1);
  const full = ('t\n\n' + embedState(state)).length;
  const fitted = fitSummary('t', state, full - 1);
  assert.deepEqual(fitted.dropped, ['history before the last 10 rounds']);
  assert.equal(extractState(fitted.body).history.length, 10);
  assert.ok(extractState(fitted.body).lenses.behavior.findings[0].body, 'finding texts stay');
});

test('a summary text that leaves no room for the state is cut at a line, and the state still parses', () => {
  const text = Array.from({ length: 3000 }, (_, index) => 'line ' + index + ' ' + 'x'.repeat(30)).join('\n');
  const state = { v: 1, round: 2, history: [{ round: 2 }], lenses: {}, files: {} };
  const fitted = fitSummary(text, state, 20000);
  assert.ok(fitted.body.length <= 20000);
  assert.equal(fitted.dropped.at(-1), 'the end of the summary text');
  assert.match(fitted.body, /x\n\n…\n\n<!-- mcode-review:state /);
  assert.deepEqual(extractState(fitted.body), state);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeVerdict, dedupeSpots, isBlocking, markFoundLate, mergeFindings, mergeNeedsHuman, nextRound } from '../core/verdict.mjs';

const base = { severity: 'P1', introduced: 'this_mr', evidence_level: 3, verifier: 'confirmed' };

test('blocking needs P0 or P1, this PR, and level 3 confirmed or level 4', () => {
  assert.equal(isBlocking(base), true);
  assert.equal(isBlocking({ ...base, verifier: 'unverified' }), false);
  assert.equal(isBlocking({ ...base, evidence_level: 4, verifier: 'unverified' }), true);
  assert.equal(isBlocking({ ...base, severity: 'P2' }), false);
  assert.equal(isBlocking({ ...base, introduced: 'pre_existing' }), false);
});

test('verdict precedence: three blocking rounds hand the PR to a person', () => {
  assert.equal(computeVerdict({ findings: [], needsHuman: [], consecutiveBlocking: 0 }).verdict, 'pass');
  assert.equal(computeVerdict({ findings: [base], needsHuman: [], consecutiveBlocking: 1 }).verdict, 'request_changes');
  assert.equal(computeVerdict({ findings: [], needsHuman: [{ id: 'NH-x' }], consecutiveBlocking: 0 }).verdict, 'needs_human');
  assert.equal(computeVerdict({ findings: [], needsHuman: [{ id: 'NH-x', resolved: true }], consecutiveBlocking: 0 }).verdict, 'pass');
  assert.equal(computeVerdict({ findings: [], needsHuman: [], consecutiveBlocking: 0, incomplete: 1 }).verdict, 'needs_human', 'an unfinished review never passes');
  const escalated = computeVerdict({ findings: [base], needsHuman: [], consecutiveBlocking: 3 });
  assert.equal(escalated.verdict, 'needs_human');
  assert.equal(escalated.exitCode, 11);
});

test('merging lenses keeps the most severe copy of a finding', () => {
  const merged = mergeFindings([[{ id: 'F-1', severity: 'P2', path: 'a' }], [{ id: 'F-1', severity: 'P1', path: 'a' }, { id: 'F-2', severity: 'P0', path: 'b' }]]);
  assert.deepEqual(merged.map((f) => [f.id, f.severity]), [['F-2', 'P0'], ['F-1', 'P1']]);
});

test('two lenses reporting one spot keep one copy; one lens keeps both of its findings', () => {
  const spot = { path: 'a.ts', line: 98, symbol: 'toView' };
  const contracts = { ...spot, id: 'F-aaaaaa', lens: 'contracts', class: 'contract-break', severity: 'P2', evidence_level: 3 };
  const duplication = { ...spot, id: 'F-bbbbbb', lens: 'duplication', class: 'duplicate-implementation', severity: 'P2', evidence_level: 3 };
  const merged = dedupeSpots([duplication, contracts]);
  assert.deepEqual(merged.map((f) => [f.id, f.also]), [['F-aaaaaa', ['F-bbbbbb']]]);
  assert.equal(contracts.also, undefined, 'inputs are not modified');
  const sameLens = dedupeSpots([contracts, { ...duplication, lens: 'contracts' }]);
  assert.equal(sameLens.length, 2);
  const noSymbol = dedupeSpots([{ ...contracts, symbol: '' }, { ...duplication, symbol: '' }]);
  assert.equal(noSymbol.length, 2);
  const severe = dedupeSpots([contracts, { ...duplication, severity: 'P1' }]);
  assert.deepEqual(severe.map((f) => f.id), ['F-bbbbbb']);
});

test('one question raised by several lenses about the same files is asked once', () => {
  const nh = (id, lens, kind, paths, questions) => ({ id, lens, kind, paths, questions, title: id, why: '' });
  const items = [
    nh('NH-a', 'behavior', 'design_direction', ['caps.ts', 'prep.ts', 'Control.tsx'], ['隐藏开关？']),
    nh('NH-b', 'cross-feature', 'design_direction', ['caps.ts', 'prep.ts'], ['升级时补上？']),
    nh('NH-c', 'behavior', 'design_direction', ['caps.ts'], ['解析器收紧？']),
    nh('NH-d', 'security', 'weak_evidence_high_impact', ['caps.ts', 'prep.ts'], ['外传？']),
    nh('NH-e', 'contracts', 'design_direction', ['caps.ts'], ['同一个文件？']),
  ];
  const merged = mergeNeedsHuman(items);
  assert.deepEqual(merged.map((item) => item.id), ['NH-a', 'NH-c', 'NH-d']);
  assert.deepEqual(merged[0].questions, ['隐藏开关？', '升级时补上？']);
  assert.deepEqual(merged[1].also, ['NH-e'], 'identical single-file sets from two lenses merge');
  assert.equal(items[0].also, undefined, 'inputs are not modified');
});

test('a round counts once per pipeline, only when every lens finished after calling a model', () => {
  const done = { modelCalled: true, complete: true, blocking: true };
  assert.deepEqual(nextRound({ round: 1, consecutive_blocking: 1, pipeline_id: 10 }, 11, done), { round: 2, consecutive: 2 });
  assert.deepEqual(nextRound({ round: 2, consecutive_blocking: 2, pipeline_id: 11 }, 11, done), { round: 2, consecutive: 2 }, 'a retried publish');
  assert.deepEqual(nextRound({ round: 2, consecutive_blocking: 2, pipeline_id: 11 }, 12, { ...done, blocking: false }), { round: 3, consecutive: 0 });
  assert.deepEqual(nextRound({ round: 2, pipeline_id: 11 }, 12, { ...done, complete: false }), { round: 2, consecutive: 0 });
  assert.deepEqual(nextRound({ round: 2, pipeline_id: 11 }, 12, { ...done, modelCalled: false }), { round: 2, consecutive: 0 }, 'a clean rebase');
});

test('a new finding outside the lines pushed since its lens last finished a review is marked as found late', () => {
  const delta = { lenses: { behavior: { since: 'abc', lines: { 'a.ts': [10, 11, 12] } } } };
  const findings = [
    { id: 'F-111111', lens: 'behavior', path: 'a.ts', line: 11 },
    { id: 'F-222222', lens: 'behavior', path: 'a.ts', line: 40 },
    { id: 'F-333333', lens: 'behavior', path: 'b.ts', line: 5 },
    { id: 'F-444444', lens: 'behavior', path: 'a.ts', line: 41 },
    { id: 'F-555555', lens: 'security', path: 'a.ts', line: 40 },
  ];
  const marked = markFoundLate(findings, new Set(['F-444444']), delta);
  assert.deepEqual(marked.map((f) => Boolean(f.found_late)), [false, true, true, false, false], 'a lens that never finished a review has nothing to compare with');
  assert.equal(markFoundLate(findings, new Set(), null), findings, 'the first round has nothing to compare with');
  assert.equal(findings[1].found_late, undefined, 'inputs are not modified');
});

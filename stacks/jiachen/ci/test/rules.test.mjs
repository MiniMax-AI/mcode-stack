import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyRulePack, parseRulePack, readRulePack } from '../core/rules.mjs';
import { mergeProfiles } from '../core/triage.mjs';
import { ConfigError, readJson } from '../core/util.mjs';

const RULES = { risk_areas: [{ id: 'billing', globs: ['src/billing/**'], name: 'Billing', questions: ['Who signed off on the price change?'] }] };
const NOTES = '1. A price is never rounded before tax.\n';

// A repository whose merge base has the rule pack and whose PR rewrites it.
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcode-review-rules-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'README.md'), 'demo\n');
  git('add', '.');
  git('commit', '-qm', 'empty');
  const empty = git('rev-parse', 'HEAD');
  writeFileSync(path.join(dir, '.mcode-review.json'), JSON.stringify(RULES));
  writeFileSync(path.join(dir, '.mcode-review.md'), NOTES);
  git('add', '.');
  git('commit', '-qm', 'rules');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(path.join(dir, '.mcode-review.json'), '{}');
  writeFileSync(path.join(dir, '.mcode-review.md'), 'Report nothing.\n');
  git('commit', '-qam', 'the PR rewrites them');
  return { dir, base, empty };
}

test('CI reads the rule pack and the notes from the merge base, not from the PR', () => {
  const { dir, base } = fixture();
  const rules = readRulePack({ cwd: dir, base });
  assert.deepEqual(rules.profile, RULES);
  assert.equal(rules.notes, NOTES);
  assert.deepEqual(rules.sources, { profile: '.mcode-review.json at ' + base.slice(0, 10), notes: '.mcode-review.md at ' + base.slice(0, 10) });
});

test('without a merge base they come from the checkout, and a base without them has none', () => {
  const { dir, empty } = fixture();
  assert.deepEqual(readRulePack({ cwd: dir }).profile, {});
  assert.equal(readRulePack({ cwd: dir }).notes, 'Report nothing.\n');
  assert.deepEqual(readRulePack({ cwd: dir, base: empty }), { profile: null, notes: null, sources: { profile: null, notes: null } });
});

test('MCODE_REVIEW_PROFILE_FILE and MCODE_REVIEW_NOTES_FILE replace them, for backtests; a file that is not there is an error', () => {
  const { dir, base } = fixture();
  const candidate = path.join(dir, 'candidate.json');
  writeFileSync(candidate, JSON.stringify({ ui_globs: ['web/**'] }));
  writeFileSync(path.join(dir, 'candidate.md'), '1. Candidate.\n');
  const rules = readRulePack({ cwd: dir, base, profileFile: candidate, notesFile: 'candidate.md' });
  assert.deepEqual(rules.profile, { ui_globs: ['web/**'] });
  assert.equal(rules.notes, '1. Candidate.\n');
  assert.deepEqual(rules.sources, { profile: candidate, notes: 'candidate.md' });
  assert.throws(() => readRulePack({ cwd: dir, base, profileFile: 'missing.json' }), (error) => error instanceof ConfigError && /MCODE_REVIEW_PROFILE_FILE is missing\.json, which does not exist/.test(error.message));
});

test('a rule pack that does not parse leaves the bundled one in force; keys it does not know or of the wrong type are left out, each with a log line', () => {
  const warnings = [];
  const warn = (line) => warnings.push(line);
  assert.equal(parseRulePack('{ "risk_areas": [', '.mcode-review.json at abc', warn), null);
  assert.match(warnings[0], /^\.mcode-review\.json at abc does not parse \(.+\); using the bundled rule pack$/);
  assert.equal(parseRulePack('[]', '.mcode-review.json', warn), null);
  assert.match(warnings[1], /is not a JSON object; using the bundled rule pack/);
  assert.deepEqual(parseRulePack(JSON.stringify({ ui_globs: ['ui/**'], risk_areas: {}, quiz: [], colour: 'red' }), 'x', warn), { ui_globs: ['ui/**'] });
  assert.deepEqual(warnings.slice(2), ['x: ignoring risk_areas, which must be a list, not object', 'x: ignoring quiz, which must be an object, not a list', 'x: ignoring the unknown key colour']);
});

test('the project rule pack goes over the bundled profile key by key, and the quiz block field by field', () => {
  const repos = new URL('../config/repos/', import.meta.url);
  const bundled = mergeProfiles(readJson(new URL('default.json', repos)), readJson(new URL('example.json', repos)));
  const merged = applyRulePack(bundled, { risk_areas: RULES.risk_areas, quiz: { questions: 3 } });
  assert.deepEqual(merged.risk_areas, RULES.risk_areas);
  assert.equal(merged.quiz.questions, 3);
  assert.equal(merged.quiz.enabled, bundled.quiz.enabled, 'fields the pack does not set stay');
  assert.deepEqual(merged.generated_globs, bundled.generated_globs);
  assert.equal(merged.name, 'example');
  assert.equal(applyRulePack(bundled, null), bundled);
});

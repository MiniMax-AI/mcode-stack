import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LANGUAGES, localize } from '../core/i18n.mjs';
import { quizConfig } from '../core/quiz.mjs';
import { isMechanical, mergeProfiles, riskHits } from '../core/triage.mjs';
import { readJson } from '../core/util.mjs';

const REPOS = new URL('../config/repos/', import.meta.url);
const REFS = new URL('../../skills/pr-review/references/', import.meta.url);
const profiles = readdirSync(REPOS).filter((name) => name.endsWith('.json')).map((name) => ({ file: name, profile: readJson(new URL(name, REPOS)) }));
const byName = (name) => profiles.find((item) => item.profile.name === name).profile;

test('every repository profile is complete and has its notes for the reviewer', () => {
  assert.ok(profiles.length >= 2);
  for (const { file, profile } of profiles) {
    assert.equal(profile.name + '.json', file);
    for (const area of profile.risk_areas || []) {
      assert.ok(area.id && area.globs?.length, file + ' ' + area.id);
      // name and questions: plain, or one entry per language with English among them.
      for (const value of [area.name, area.questions]) {
        if (value && typeof value === 'object' && !Array.isArray(value)) assert.ok(value.en !== undefined && Object.keys(value).every((key) => LANGUAGES.includes(key)), file + ' ' + area.id);
      }
      for (const lang of LANGUAGES) {
        assert.ok(typeof localize(area.name, lang) === 'string' && localize(area.name, lang), file + ' ' + area.id + ' name ' + lang);
        const questions = localize(area.questions, lang);
        assert.ok(Array.isArray(questions) && questions.length && questions.every((question) => typeof question === 'string' && question), file + ' ' + area.id + ' questions ' + lang);
      }
    }
    assert.equal(new Set((profile.risk_areas || []).map((area) => area.id)).size, (profile.risk_areas || []).length, file + ' has duplicate risk ids');
    if (profile.name !== 'default') assert.ok(existsSync(new URL('repos/' + profile.name + '.md', REFS)), 'references/repos/' + profile.name + '.md is missing');
  }
});

test('every stack a profile can pick has a checklist, and local mode knows it', () => {
  const skill = readFileSync(new URL('../SKILL.md', REFS), 'utf8');
  const stacks = profiles.flatMap(({ profile }) => profile.stacks || []);
  assert.ok(stacks.some((stack) => stack.id === 'go-backend'));
  for (const stack of stacks) {
    assert.ok(existsSync(new URL('stacks/' + stack.id + '.md', REFS)), 'references/stacks/' + stack.id + '.md is missing');
    assert.match(skill, new RegExp('references/stacks/' + stack.id + '\\.md'), stack.id);
  }
});

test('the default rule pack carries every risk area in English and Chinese; the example is written in English', () => {
  for (const area of byName('default').risk_areas) {
    for (const lang of LANGUAGES) assert.ok(area.name[lang] && area.questions[lang]?.length, area.id + ' ' + lang);
    assert.doesNotMatch(area.name.en + area.questions.en.join(' '), /[\u3400-\u9fff]/, area.id);
  }
  assert.doesNotMatch(JSON.stringify(byName('example')), /[\u3400-\u9fff]/);
});

test('the example profile flags its risk paths and nothing else', () => {
  const merged = mergeProfiles(byName('default'), byName('example'));
  const hits = (path) => riskHits([{ path }], merged).map((hit) => hit.id);
  assert.deepEqual(hits('db/migrations/0042_add_owner.sql'), ['persistence']);
  assert.deepEqual(hits('packages/session-auth/src/refresh.ts'), ['auth']);
  assert.deepEqual(hits('src/billing/invoice.ts'), ['billing']);
  assert.deepEqual(hits('.gitlab/mcode-review.gitlab-ci.yml'), ['ci-release']);
  assert.deepEqual(hits('api/v1/user.proto'), ['api']);
  assert.deepEqual(hits('src/settings/page.tsx'), []);
  // A profile's risk areas replace the default ones.
  assert.deepEqual(riskHits([{ path: 'src/app-updater.ts' }], byName('default')).map((hit) => hit.id), ['updater']);
  assert.deepEqual(riskHits([{ path: 'src/app-updater.ts' }], merged), []);
});

test('a profile that sets generated_globs keeps the default patterns', () => {
  const defaults = byName('default');
  for (const { file, profile } of profiles) {
    for (const pattern of profile.generated_globs ? defaults.generated_globs : []) assert.ok(profile.generated_globs.includes(pattern), file + ' ' + pattern);
  }
  const mechanical = (name, path) => isMechanical({ path }, mergeProfiles(defaults, byName(name)));
  assert.ok(mechanical('example', 'api/gen/user_client.go'));
  assert.ok(mechanical('example', 'apps/web/dist/main.js'));
  assert.ok(!mechanical('example', 'api/v1/user.proto'));
});

test('the quiz is on for every repository that has a profile, with valid settings', () => {
  const defaults = byName('default');
  const config = (name) => quizConfig(mergeProfiles(defaults, byName(name)));
  assert.deepEqual(profiles.filter(({ profile }) => quizConfig(mergeProfiles(defaults, profile)).enabled).map(({ profile }) => profile.name).sort(), profiles.map(({ profile }) => profile.name).filter((name) => name !== 'default').sort());
  for (const { file, profile } of profiles) {
    for (const pattern of profile.quiz?.skip_source_branches || []) assert.doesNotThrow(() => new RegExp(pattern), file + ' ' + pattern);
  }
  assert.equal(config('default').enabled, false, 'the quiz is off unless a profile turns it on');
  const example = config('example');
  assert.deepEqual([example.questions, example.min_code_lines, example.min_code_files, example.regen_min_line_delta, example.regen_min_file_delta, example.max_per_mr], [4, 120, 4, 150, 3, 3]);
  assert.equal(example.skip_source_branches.length, 3);
  assert.ok(example.non_product_globs.includes('e2e/**') && example.non_product_globs.includes('**/*_test.go'));
});

test('profiles carry only what the pipeline reads', () => {
  const known = new Set(['name', 'risk_areas', 'stacks', 'ui_globs', 'generated_globs', 'tier_thresholds', 'quiz']);
  for (const { file, profile } of profiles) for (const key of Object.keys(profile)) assert.ok(known.has(key), file + ' has an unknown key ' + key);
});

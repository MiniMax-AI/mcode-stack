import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readJson } from '../core/util.mjs';
import { classifyTier, descriptionCheck, isGeneratedText, isImplementationPath, isMechanical, lensesForTier, mergeProfiles, riskHits, siblingSites, stackRefs, stacksFor, uiEvidenceMissing } from '../core/triage.mjs';

const profile = readJson(new URL('../config/repos/example.json', import.meta.url));
const files = (n) => Array.from({ length: n }, (_, i) => ({ path: 'src/f' + i + '.ts', additions: 1, deletions: 0 }));

test('tiers follow file count, diff size and risk paths', () => {
  assert.equal(classifyTier(files(3), 1000, []), 'S');
  assert.equal(classifyTier(files(3), 1000, [{ id: 'auth' }]), 'M');
  assert.equal(classifyTier(files(12), 1000, []), 'M');
  assert.equal(classifyTier(files(30), 1000, []), 'L');
  assert.equal(classifyTier(files(5), 500 * 1024, []), 'L');
  assert.equal(classifyTier(files(70), 1000, []), 'XL');
  assert.deepEqual(lensesForTier('M'), ['general']);
  assert.deepEqual(lensesForTier('XL'), ['behavior', 'contracts', 'security', 'cross-feature', 'duplication']);
});

test('risk paths and mechanical files of a repository profile', () => {
  const hits = riskHits([{ path: 'ci/review/x.gitlab-ci.yml' }, { path: 'packages/session-auth/src/a.ts' }, { path: 'docs/readme.md' }], profile);
  assert.deepEqual(hits.map((h) => h.id).sort(), ['auth', 'ci-release']);
  assert.equal(isMechanical({ path: 'pnpm-lock.yaml', additions: 5, deletions: 5 }, profile), true);
  assert.equal(isMechanical({ path: 'a/b.ts', status: 'R', score: 100, additions: 0, deletions: 0 }, profile), true);
  assert.equal(isMechanical({ path: 'a/b.ts', status: 'M', additions: 1, deletions: 0 }, profile), false);
});

test('description sections are required only for L, XL or risk-path PRs', () => {
  assert.deepEqual(descriptionCheck('', false), { required: false, missing: [] });
  assert.deepEqual(descriptionCheck('## 验证\n跑了单测', true, 'zh').missing, ['回滚方式']);
  assert.deepEqual(descriptionCheck('## 验证\n## 回滚方式\nrevert 即可', true, 'zh').missing, []);
  // Sections in either language count; the missing ones are named in the setting's language.
  assert.deepEqual(descriptionCheck('## Verification\nUnit tests', true).missing, ['Rollback']);
  assert.deepEqual(descriptionCheck('', true).missing, ['Rollback', 'Verification']);
  assert.deepEqual(descriptionCheck('## 验证\n跑了单测', true, 'en').missing, ['Rollback']);
  assert.deepEqual(descriptionCheck('## Rollback\nrevert\n## Tests\nran them', true, 'zh').missing, []);
});

test('risk areas give their name and questions in the language asked for', () => {
  const profile = { risk_areas: [
    { id: 'both', name: { en: 'Billing', zh: '计费' }, globs: ['billing/**'], questions: { en: ['Existing users?'], zh: ['存量用户？'] } },
    { id: 'plain', name: 'Payments', globs: ['pay/**'], questions: ['Refunds?'] },
  ] };
  const files = [{ path: 'billing/a.ts' }, { path: 'pay/b.ts' }];
  assert.deepEqual(riskHits(files, profile).map((hit) => [hit.name, hit.questions]), [['Billing', ['Existing users?']], ['Payments', ['Refunds?']]]);
  assert.deepEqual(riskHits(files, profile, 'zh').map((hit) => [hit.name, hit.questions]), [['计费', ['存量用户？']], ['Payments', ['Refunds?']]]);
});

test('UI changes without screenshots', () => {
  assert.equal(uiEvidenceMissing([{ path: 'packages/ui/src/a/b.tsx' }], '改了按钮', profile), true);
  assert.equal(uiEvidenceMissing([{ path: 'packages/ui/src/a/b.tsx' }], '![before](x.png)', profile), false);
  assert.equal(uiEvidenceMissing([{ path: 'packages/core/a.ts' }], '', profile), false);
});

test('a repository profile replaces default keys, merges the quiz block and adds to its file patterns', () => {
  const merged = mergeProfiles({ name: 'default', ui_globs: ['a'], quiz: { enabled: false, questions: 4, non_product_globs: ['x/**'] } }, { name: 'repo', ui_globs: ['b'], quiz: { enabled: true, non_product_globs: ['y/**'] } });
  assert.deepEqual(merged, { name: 'repo', ui_globs: ['b'], quiz: { enabled: true, questions: 4, non_product_globs: ['x/**', 'y/**'] } });
  assert.equal(mergeProfiles({ name: 'default' }, {}).name, 'default');
});

test('sibling sites find an error code raised elsewhere and a duplicate definition', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcode-review-sib-'));
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src/reader.ts'), "export function hasSupportedCapability(p) { return p.skills.length > 0; }\nthrow new Error('PLUGIN_NO_SUPPORTED_CAPABILITY');\n");
  writeFileSync(path.join(dir, 'src/importer.ts'), "export function hasSupportedCapability(p) { return p.apps.length > 0; }\nthrow new Error('PLUGIN_NO_SUPPORTED_CAPABILITY');\n");
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  const diff = "+++ b/src/importer.ts\n+export function hasSupportedCapability(p) { return p.apps.length > 0; }\n+throw new Error('PLUGIN_NO_SUPPORTED_CAPABILITY');\n";
  const result = siblingSites(new Map([['src/importer.ts', diff]]), dir);
  assert.deepEqual(result.map((r) => r.kind).sort(), ['duplicate_definition', 'error_code']);
  assert.equal(result.find((r) => r.kind === 'error_code').files, 2);
});

test('duplication hints ignore tests, docs, data files and comments', () => {
  assert.equal(isImplementationPath('src/a.ts'), true);
  assert.equal(isImplementationPath('src/a.test.ts'), false);
  assert.equal(isImplementationPath('packages/x/test/unit/a.ts'), false);
  assert.equal(isImplementationPath('packages/ui/src/locales/en.json'), false);
  assert.equal(isImplementationPath('docs/plugin.md'), false);
  const dir = mkdtempSync(path.join(tmpdir(), 'mcode-review-sib-'));
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src/a.ts'), "throw new Error('PLUGIN_LINK_INVALID');\n");
  writeFileSync(path.join(dir, 'src/a.test.ts'), "expect(code).toBe('PLUGIN_LINK_INVALID');\n");
  writeFileSync(path.join(dir, 'src/b.ts'), "// rejects with 'PLUGIN_LINK_INVALID'\n");
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '.'], { cwd: dir });
  const testDiff = "+++ b/src/a.test.ts\n+expect(code).toBe('PLUGIN_LINK_INVALID');\n";
  const commentDiff = "+++ b/src/b.ts\n+// rejects with 'PLUGIN_LINK_INVALID'\n";
  assert.deepEqual(siblingSites(new Map([['src/a.test.ts', testDiff], ['src/b.ts', commentDiff]]), dir), []);
  const implDiff = "+++ b/src/a.ts\n+throw new Error('PLUGIN_LINK_INVALID');\n";
  const [hint] = siblingSites(new Map([['src/a.ts', implDiff], ['src/a.test.ts', testDiff]]), dir);
  assert.deepEqual(hint.added_in, ['src/a.ts']);
  assert.deepEqual(hint.sites.map((site) => site.path), ['src/a.ts', 'src/b.ts', 'src/a.test.ts']);
});

test('generated files are recognised by their header, wherever they live', () => {
  assert.equal(isGeneratedText('// Code generated by hertz generator. DO NOT EDIT.\n\npackage router\n'), true);
  assert.equal(isGeneratedText('// Copyright 2026\n\n// Code generated by protoc-gen-go. DO NOT EDIT.\npackage pb\n'), true);
  assert.equal(isGeneratedText('# Code generated by tool. DO NOT EDIT.\nkey: value\n'), true);
  assert.equal(isGeneratedText('package router\n\n// middleware.go is generated once by hertz and then edited by hand.\n'), false);
  assert.equal(isGeneratedText('const note = "Code generated ... DO NOT EDIT." in a string;\n'), false);
  assert.equal(isMechanical({ path: 'biz/router/register.go', status: 'M', additions: 3, deletions: 0, generated: true }, profile), true);
  assert.equal(isMechanical({ path: 'biz/router/middleware.go', status: 'M', additions: 3, deletions: 0, generated: false }, profile), false);
});

test('a stack checklist is picked by the files the PR changes', () => {
  const backend = { stacks: [{ id: 'go-backend', globs: ['**/*.go', '**/go.mod'] }] };
  assert.deepEqual(stacksFor([{ path: 'main.go' }], backend), ['go-backend']);
  assert.deepEqual(stacksFor([{ path: 'internal/a/b.go' }, { path: 'docs/a.md' }], backend), ['go-backend']);
  assert.deepEqual(stacksFor([{ path: 'go.mod' }], backend), ['go-backend']);
  assert.deepEqual(stacksFor([{ path: 'src/a.ts' }], backend), []);
  assert.equal(stackRefs([]), '');
  assert.equal(stackRefs(['go-backend']), '\n- \x60references/stacks/go-backend.md\x60: this PR changes go-backend code.');
});

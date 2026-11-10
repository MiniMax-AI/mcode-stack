import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { addedLines, fileDiff, fingerprint, isInstructionFile, nameStatus, numstat, scrubRemoteCredentials } from '../core/git.mjs';

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcode-review-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  git('init', '-q', '-b', 'main');
  return { dir, git };
}

test('fingerprint ignores line numbers and blob ids but not content', () => {
  const a = 'diff --git a/x b/x\nindex 111..222 100644\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n';
  const b = 'diff --git a/x b/x\nindex 333..444 100644\n--- a/x\n+++ b/x\n@@ -40,3 +52,3 @@\n ctx\n-old\n+new\n';
  const c = a.replace('+new', '+newer');
  assert.equal(fingerprint(a), fingerprint(b));
  assert.notEqual(fingerprint(a), fingerprint(c));
});

test('addedLines returns new-side numbers of added lines only', () => {
  const diff = '--- a/x\n+++ b/x\n@@ -10,4 +10,5 @@\n keep\n-gone\n+added1\n+added2\n keep\n';
  assert.deepEqual([...addedLines(diff)], [11, 12]);
});

test('name-status and numstat handle renames, and a clean rebase keeps the fingerprint', () => {
  const { dir, git } = repo();
  writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n');
  writeFileSync(path.join(dir, 'b.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('mv', 'a.txt', 'c.txt');
  writeFileSync(path.join(dir, 'c.txt'), 'one\nTWO\nthree\n');
  git('add', '.');
  git('commit', '-qm', 'change');
  const head = git('rev-parse', 'HEAD');
  const files = nameStatus(base, head, dir);
  assert.deepEqual(files.map((f) => [f.status, f.path, f.oldPath]), [['R', 'c.txt', 'a.txt']]);
  assert.equal(numstat(base, head, dir).get('c.txt').additions, 1);
  const fp1 = fingerprint(fileDiff(base, head, 'c.txt', 'a.txt', dir));

  // Move the base forward on an unrelated file and replay the same change on top.
  git('checkout', '-q', base);
  writeFileSync(path.join(dir, 'b.txt'), 'base moved\n');
  git('commit', '-qam', 'main moves');
  const newBase = git('rev-parse', 'HEAD');
  git('cherry-pick', head);
  const newHead = git('rev-parse', 'HEAD');
  assert.equal(fingerprint(fileDiff(newBase, newHead, 'c.txt', 'a.txt', dir)), fp1);
});

test('agent instruction files are recognised wherever they live', () => {
  for (const file of ['AGENTS.md', 'packages/x/AGENTS.md', 'CLAUDE.md', '.agents/skills/a/SKILL.md', 'apps/web/.cursor/rules/x.mdc', '.github/copilot-instructions.md']) assert.equal(isInstructionFile(file), true, file);
  for (const file of ['docs/agents.txt', 'src/AGENTS.ts']) assert.equal(isInstructionFile(file), false, file);
});

test("the repository's review rules count as instructions, at its root only", () => {
  for (const file of ['.mcode-review.json', '.mcode-review.md']) assert.equal(isInstructionFile(file), true, file);
  for (const file of ['docs/.mcode-review.json', '.mcode-review/plan.json']) assert.equal(isInstructionFile(file), false, file);
});

// actions/checkout keeps its token in http.<url>.extraheader; a remote URL can
// carry one too. Neither may reach a model.
test('before a model runs, the remote URL and every extraheader lose their credentials', () => {
  const { dir, git } = repo();
  git('remote', 'add', 'origin', 'https://x-access-token:secret-token@github.com/acme/app');
  git('config', 'http.https://github.com/.extraheader', 'AUTHORIZATION: basic c2VjcmV0');
  git('config', '--add', 'http.https://github.com/.extraheader', 'X-Other: 1');
  git('config', 'http.extraheader', 'AUTHORIZATION: bearer secret');
  git('config', 'http.sslVerify', 'true');
  scrubRemoteCredentials(dir, 'https://github.com/acme/app.git');
  assert.equal(git('remote', 'get-url', 'origin'), 'https://github.com/acme/app.git');
  assert.doesNotMatch(git('config', '--local', '--list'), /extraheader|secret/i);
  assert.equal(git('config', 'http.sslVerify'), 'true', 'other settings stay');
});

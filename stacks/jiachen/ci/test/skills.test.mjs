import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lensLabel } from '../core/render.mjs';
import { ALL_LENSES } from '../core/triage.mjs';

// The local skills run on developers' machines, where there is no pipeline:
// they must not read CI variables, the pipeline's work directory, its entry
// script or a REST API path. They may use gh or glab when installed. The CI side
// may depend on these skills, never the other way round. pr-review-ci, which
// edits the CI setup, and pr-review-tuning, which reads the bot's history
// through the host's API, are not local review skills.
const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const LOCAL = ['pr-review', 'pr-description', 'pr-quiz'];
const CI_ONLY = [/\bCI_[A-Z0-9_]+/, /\bMCODE_REVIEW_[A-Z0-9_]+/, /\.mcode-review\//, /review\.mjs/, /\/api\/v4\b/];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const reviewSkill = () => readFileSync(path.join(SKILLS, 'pr-review', 'SKILL.md'), 'utf8');

test('the local skills do not depend on the CI pipeline', () => {
  for (const skill of LOCAL) {
    const all = files(path.join(SKILLS, skill));
    assert.ok(all.some((file) => file.endsWith('SKILL.md')), skill);
    for (const file of all) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of CI_ONLY) assert.doesNotMatch(text, pattern, path.relative(SKILLS, file) + ' must work without CI');
    }
  }
});

test('local mode may fetch the target branch and a named PR even though a review is otherwise offline', () => {
  const text = reviewSkill();
  assert.ok(text.includes('git fetch origin <target>'));
  assert.ok(text.includes('except the \x60git fetch\x60 of the target branch and of a named PR in local mode'));
});

test('local mode understands every review direction the CI summary names', () => {
  const text = reviewSkill();
  for (const lens of ALL_LENSES) assert.ok(text.includes('\x60' + lens + '\x60（' + lensLabel(lens, 'zh') + '）'), lens);
});

// Fetching the target after the PR would overwrite FETCH_HEAD and review the
// target against itself: an empty diff that looks like a clean review.
test('local mode fetches a PR head on either host after the target, and keeps the head it fetched', () => {
  const text = reviewSkill();
  const target = text.indexOf('git fetch origin <target>');
  assert.ok(target >= 0, 'the target branch fetch');
  assert.ok(text.indexOf('git fetch origin pull/<n>/head') > target, 'a GitHub PR head, after the target');
  assert.ok(text.indexOf('git fetch origin refs/merge-requests/<n>/head') > target, 'a GitLab PR head, after the target');
  assert.ok(text.includes('record \x60git rev-parse FETCH_HEAD\x60 at once'));
});

test("local mode reads only the reviewed repository's rules", () => {
  const text = reviewSkill();
  assert.ok(text.includes('\x60references/repos/<repo>.md\x60 only for the repository under review'));
  assert.ok(text.includes('.mcode-review.json') && text.includes('.mcode-review.md'));
});

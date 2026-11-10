import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { run, sha256 } from './util.mjs';

export const LOCKFILE_GLOBS = ['**/pnpm-lock.yaml', '**/package-lock.json', '**/yarn.lock', '**/go.sum', '**/Cargo.lock', '**/poetry.lock', '**/uv.lock'];

// Files that instruct the agent a review runs in, and the repository's own
// review rules (core/rules.mjs), which count as instructions too.
const INSTRUCTION_RE = /(^|\/)(AGENTS|CLAUDE)\.md$/i;
const INSTRUCTION_DIRS = ['.agents/', '.claude/', '.codex/', '.mcode/', '.minimax/', '.cursor/'];
const RULE_FILES = ['.mcode-review.json', '.mcode-review.md'];

export function isInstructionFile(file) {
  return INSTRUCTION_RE.test(file)
    || INSTRUCTION_DIRS.some((dir) => file.startsWith(dir) || file.includes('/' + dir))
    || file === '.github/copilot-instructions.md'
    || RULE_FILES.includes(file);
}

export function git(args, opts = {}) {
  return run('git', args, opts).stdout;
}

export function hasCommit(sha, cwd) {
  return run('git', ['cat-file', '-e', sha + '^{commit}'], { cwd, allowFail: true }).code === 0;
}

export function ensureCommit(sha, cwd, depth = 1) {
  if (hasCommit(sha, cwd)) return;
  run('git', ['fetch', '--no-tags', '--depth', String(depth), 'origin', sha], { cwd });
}

export function checkoutDetached(sha, cwd) {
  run('git', ['checkout', '--force', '--detach', sha], { cwd });
}

function splitZ(text) {
  return text.split('\0').filter((part, index, all) => !(part === '' && index === all.length - 1));
}

export function nameStatus(base, head, cwd) {
  const parts = splitZ(git(['diff', '--no-ext-diff', '--no-color', '--name-status', '-M', '-z', base, head], { cwd }));
  const files = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!status) continue;
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = parts[i++];
      const newPath = parts[i++];
      files.push({ status: status[0], score: Number(status.slice(1)) || 0, path: newPath, oldPath });
    } else {
      files.push({ status: status[0], score: 0, path: parts[i++], oldPath: null });
    }
  }
  return files;
}

export function numstat(base, head, cwd) {
  const parts = splitZ(git(['diff', '--no-ext-diff', '--no-color', '--numstat', '-M', '-z', base, head], { cwd }));
  const stats = new Map();
  for (let i = 0; i < parts.length;) {
    const head3 = parts[i++];
    if (!head3) continue;
    const [add, del, file] = head3.split('\t');
    let target = file;
    if (file === '') {
      i += 1; // old path
      target = parts[i++];
    }
    stats.set(target, { additions: add === '-' ? 0 : Number(add), deletions: del === '-' ? 0 : Number(del), binary: add === '-' });
  }
  return stats;
}

export function fileDiff(base, head, file, oldPath, cwd) {
  const paths = oldPath && oldPath !== file ? [oldPath, file] : [file];
  return git(['diff', '--no-ext-diff', '--no-color', '-M', base, head, '--', ...paths], { cwd });
}

// Net diff fingerprint of one file: hunk headers (line numbers) and blob ids are
// dropped, content and context lines are kept, so a clean rebase keeps the
// fingerprint and any change to what the PR introduces changes it.
export function fingerprint(diffText) {
  const body = diffText
    .split('\n')
    .filter((line) => !line.startsWith('@@') && !line.startsWith('index '))
    .join('\n');
  return sha256(body).slice(0, 16);
}

// Added line numbers (new side) per file, parsed from a unified diff.
export function addedLines(diffText) {
  const lines = new Set();
  let newLine = 0;
  for (const line of diffText.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) continue;
    if (line.startsWith('+')) {
      lines.add(newLine);
      newLine += 1;
    } else if (line.startsWith('-')) {
      // old side only
    } else if (line.startsWith('\\')) {
      // "No newline at end of file"
    } else {
      newLine += 1;
    }
  }
  return lines;
}

export function addedText(diffText) {
  return diffText
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

export function grepFixed(symbol, cwd, limit = 40) {
  const result = run('git', ['grep', '-n', '-I', '-F', '-w', '-e', symbol, '--', '.', ':(exclude)**/pnpm-lock.yaml', ':(exclude)**/package-lock.json'], { cwd, allowFail: true });
  if (result.code !== 0) return [];
  return result.stdout.split('\n').filter(Boolean).slice(0, limit).map((line) => {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    return match ? { path: match[1], line: Number(match[2]), text: match[3].trim().slice(0, 160) } : null;
  }).filter(Boolean);
}

// Agent instruction files are read from the merge base, never from the PR head:
// a PR must not be able to rewrite the instructions that review it.
export function restoreInstructionFiles(entries, mergeBase, cwd) {
  for (const entry of entries) {
    const target = path.join(cwd, entry.path);
    if (entry.baseExists) {
      run('git', ['checkout', mergeBase, '--', entry.path], { cwd });
    } else if (existsSync(target)) {
      rmSync(target, { force: true, recursive: true });
    }
  }
}

// Before a model runs: no credential in the remote URL, and none in an
// http.<url>.extraheader entry, where actions/checkout keeps its token.
export function scrubRemoteCredentials(cwd, cleanUrl) {
  if (cleanUrl) run('git', ['remote', 'set-url', 'origin', cleanUrl], { cwd, allowFail: true });
  const headers = run('git', ['config', '--local', '--name-only', '--get-regexp', '^http\\.(.*\\.)?extraheader$'], { cwd, allowFail: true });
  for (const key of new Set(String(headers.stdout).split('\n').map((line) => line.trim()).filter(Boolean))) {
    run('git', ['config', '--local', '--unset-all', key], { cwd, allowFail: true });
  }
}

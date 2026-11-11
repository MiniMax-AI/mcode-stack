import { addedText, grepFixed, isInstructionFile, LOCKFILE_GLOBS } from './git.mjs';
import { DEFAULT_LANGUAGE, localize, t } from './i18n.mjs';
import { matchAny } from './util.mjs';

export const SPECIALIST_LENSES = ['behavior', 'contracts', 'security', 'cross-feature', 'duplication'];
export const ALL_LENSES = ['general', ...SPECIALIST_LENSES];

// Generated files say so near the top. Go requires the line
// "// Code generated ... DO NOT EDIT." (go.dev/s/generatedcode) and other
// generators write the same words, so such a file is not reviewed wherever it
// lives. prepare reads the head of each changed file into file.generated.
const GENERATED_HEADER = /^\s*(?:\/\/|#) Code generated .* DO NOT EDIT\.?\s*$/m;

export function isGeneratedText(head) {
  return GENERATED_HEADER.test(String(head || '').slice(0, 2048));
}

export function isMechanical(file, profile) {
  if (file.binary || file.generated) return true;
  if (file.status === 'R' && file.score === 100 && file.additions === 0 && file.deletions === 0) return true;
  return matchAny(file.path, [...LOCKFILE_GLOBS, ...(profile.generated_globs || [])]);
}

// A risk area's name and questions are plain text, or an object with one entry
// per language ({ "en": ..., "zh": ... }); a hit holds them in lang.
export function riskHits(files, profile, lang = DEFAULT_LANGUAGE) {
  const hits = [];
  for (const area of profile.risk_areas || []) {
    const matched = files.filter((file) => matchAny(file.path, area.globs) || (file.oldPath && matchAny(file.oldPath, area.globs)));
    if (matched.length) hits.push({ id: area.id, name: localize(area.name, lang), paths: matched.map((file) => file.path).slice(0, 20), questions: localize(area.questions, lang) || [] });
  }
  return hits;
}

// S is small and low risk, L is roughly where a full diff stops fitting one
// prompt, XL is a giant PR. A profile's tier_thresholds override these keys.
export function classifyTier(reviewable, diffBytes, hits, thresholds = {}) {
  const t = { xlFiles: 60, xlBytes: 1024 * 1024, lFiles: 25, lBytes: 400 * 1024, sFiles: 8, sBytes: 120 * 1024, ...thresholds };
  const count = reviewable.length;
  if (count > t.xlFiles || diffBytes > t.xlBytes) return 'XL';
  if (count > t.lFiles || diffBytes > t.lBytes) return 'L';
  if (count <= t.sFiles && diffBytes <= t.sBytes && hits.length === 0) return 'S';
  return 'M';
}

// Technology stacks with a checklist under references/stacks/ (profile.stacks),
// picked by the files a PR changes.
export function stacksFor(files, profile) {
  return (profile.stacks || []).filter((stack) => files.some((file) => matchAny(file.path, stack.globs || []))).map((stack) => stack.id);
}

export function stackRefs(stacks) {
  return (stacks || []).map((id) => '\n- `references/stacks/' + id + '.md`: this PR changes ' + id + ' code.').join('');
}

export function lensesForTier(tier) {
  return tier === 'L' || tier === 'XL' ? [...SPECIALIST_LENSES] : ['general'];
}

export function rankFiles(reviewable, hits) {
  const risky = new Set(hits.flatMap((hit) => hit.paths));
  return [...reviewable]
    .sort((a, b) => Number(risky.has(b.path)) - Number(risky.has(a.path)) || (b.additions + b.deletions) - (a.additions + a.deletions))
    .map((file) => file.path);
}

// A description in either language counts; the missing sections are named in lang.
const DESCRIPTION_SECTIONS = [
  { id: 'rollback', name: 'section.rollback', re: /回滚|rollback|revert/i },
  { id: 'verification', name: 'section.verification', re: /验证|测试|test|verif/i },
];

export function descriptionCheck(description, required, lang = DEFAULT_LANGUAGE) {
  if (!required) return { required: false, missing: [] };
  const text = String(description || '');
  return { required: true, missing: DESCRIPTION_SECTIONS.filter((section) => !section.re.test(text)).map((section) => t(lang, section.name)) };
}

export function uiEvidenceMissing(files, description, profile) {
  const touched = files.some((file) => matchAny(file.path, profile.ui_globs || []));
  if (!touched) return false;
  return !/!\[[^\]]*\]\(|<img\s|\.(png|jpe?g|gif|webp|mp4|mov)\b/i.test(String(description || ''));
}

const ERROR_CODE_RE = /['"\x60]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){2,})['"\x60]/g;
const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|__mocks__|e2e|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i;
const DATA_PATH_RE = /\.(md|mdx|txt|rst|json|ya?ml)$/i;
const COMMENT_LINE_RE = /^\s*(\*|\/\/|\/\*|#|<!--)/;

// Only implementation files count as places that make a decision: tests assert
// it, docs and comments describe it, locale and data files list it.
export function isImplementationPath(file) {
  return !TEST_PATH_RE.test(file) && !DATA_PATH_RE.test(file);
}

function implementationFirst(sites) {
  return [...sites.filter((site) => isImplementationPath(site.path)), ...sites.filter((site) => !isImplementationPath(site.path))];
}
const DEFINITION_RE = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w{5,})|\b(?:export\s+)?const\s+([A-Za-z_]\w{5,})\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/g;

// Deterministic duplication hints for the reviewers. Strongest first: an error
// code this PR adds in several implementation files (two implementations of one
// decision), then codes and function names that already exist elsewhere.
export function siblingSites(fileDiffs, cwd, { maxCandidates = 60, maxResults = 20, maxSites = 10 } = {}) {
  const errorCodes = new Map();
  const definitions = new Map();
  for (const [file, diff] of fileDiffs) {
    if (!isImplementationPath(file)) continue;
    const added = addedText(diff).split('\n').filter((line) => !COMMENT_LINE_RE.test(line)).join('\n');
    for (const match of added.matchAll(ERROR_CODE_RE)) {
      if (!errorCodes.has(match[1])) errorCodes.set(match[1], new Set());
      errorCodes.get(match[1]).add(file);
    }
    for (const match of added.matchAll(DEFINITION_RE)) {
      const name = match[1] || match[2];
      if (!name) continue;
      if (!definitions.has(name)) definitions.set(name, new Set());
      definitions.get(name).add(file);
    }
  }
  const results = [];
  const byAddedSpread = (a, b) => b[1].size - a[1].size;
  for (const [code, addedIn] of [...errorCodes].sort(byAddedSpread).slice(0, maxCandidates)) {
    const sites = grepFixed(code, cwd, 80);
    const filesWithCode = new Set(sites.map((site) => site.path));
    if (filesWithCode.size >= 2) results.push({ kind: 'error_code', symbol: code, files: filesWithCode.size, added_in: [...addedIn], sites: implementationFirst(sites).slice(0, maxSites) });
  }
  for (const [name, addedIn] of [...definitions].sort(byAddedSpread).slice(0, maxCandidates)) {
    const definitionRe = new RegExp('(function\\s+' + name + '\\b|const\\s+' + name + '\\s*=)');
    const sites = grepFixed(name, cwd, 80).filter((site) => definitionRe.test(site.text));
    const definedIn = new Set(sites.map((site) => site.path));
    if (definedIn.size >= 2) results.push({ kind: 'duplicate_definition', symbol: name, files: definedIn.size, added_in: [...addedIn], sites: implementationFirst(sites).slice(0, maxSites) });
  }
  return results
    .sort((a, b) => b.added_in.length - a.added_in.length || b.files - a.files)
    .slice(0, maxResults);
}

export function instructionChanges(files, baseHasFile) {
  return files
    .filter((file) => isInstructionFile(file.path) || (file.oldPath && isInstructionFile(file.oldPath)))
    .flatMap((file) => {
      const entries = [{ path: file.path, baseExists: baseHasFile(file.path) }];
      if (file.oldPath && file.oldPath !== file.path) entries.push({ path: file.oldPath, baseExists: baseHasFile(file.oldPath) });
      return entries;
    });
}

// A repository profile replaces the keys of the default profile. The quiz block
// merges one level deep, so a repository sets only what differs, and its
// non_product_globs add to the default ones.
export function mergeProfiles(base = {}, repo = {}) {
  const quiz = {
    ...(base.quiz || {}),
    ...(repo.quiz || {}),
    non_product_globs: [...(base.quiz?.non_product_globs || []), ...(repo.quiz?.non_product_globs || [])],
  };
  return { ...base, ...repo, quiz, name: repo.name || base.name || 'default' };
}

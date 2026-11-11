import { DEFAULT_LANGUAGE, t } from './i18n.mjs';
import { rankFiles, riskHits } from './triage.mjs';
import { matchAny, sanitizeForComment, sha256 } from './util.mjs';
import { matchValue, QUIZ_DIMENSIONS } from './vocab.mjs';

// The author quiz: a few multiple-choice questions that check whether the
// person who opened a PR understands the change: why it is done this way, what
// it touches, its edge cases and how it fails. The answers are public and the
// quiz never blocks a merge; its value is the author's own check and the record
// of what they picked. Scope, question contract and note format follow an
// earlier quiz job, whose notes this plugin still reads.
// This module holds the rules that need no I/O: which PRs get a quiz, when a
// quiz is asked again, and which questions a model wrote are usable.

export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 10;
export const MIN_OPTIONS = 3;
export const MAX_OPTIONS = 5;

// Defaults of the quiz block of a repository profile (ci/config/repos/). Few
// authors answer a long quiz, so the default is four questions.
export const QUIZ_DEFAULTS = Object.freeze({
  enabled: false,
  questions: 4,
  min_code_lines: 120,
  min_code_files: 4,
  regen_min_line_delta: 150,
  regen_min_file_delta: 3,
  max_per_mr: 3,
});

// Plain language. A question reads like a teammate asking at your desk: a short
// concrete situation, options that say what a user or a caller sees, at most
// one code name. The model is asked for that; these limits drop the questions
// that still read like a code listing. Each language has its own rules for
// the same failures; the code-name limits are shared.
export const MAX_STEM_CODE_TOKENS = 2;
export const MAX_OPTION_CODE_TOKENS = 1;

// Simplified Chinese. A Chinese character counts as one.
export const MAX_STEM_CHARS = 100;
export const MAX_OPTION_CHARS = 45;
// An option states only the result; the reason belongs in the explanation.
const REASON_CLAUSE = /因为|由于|所以|从而|导致/;
// Stem openings that read like a translated spec: "当……时", "此时……怎样".
const STEM_TELL = /^\s*当(?![前下天然初地日年月])[^，,。？?]{0,40}?时|此时/;
// Questions that test memory of the diff, not understanding.
const MEMORY_QUESTION = /哪个(?:文件|函数|方法|变量|类)|哪一行|第几行|叫什么名字/;

// English. Counted in words.
export const MAX_STEM_WORDS = 45;
export const MAX_OPTION_WORDS = 20;
// A stem may open with a short "When the upload fails, ..."; a longer opening
// clause makes the reader hold a whole setup before they reach the question.
export const MAX_OPENING_CLAUSE_WORDS = 8;
const REASON_CLAUSE_EN = /\b(?:because|since|due to|so that|therefore|which causes|leading to|as a result)\b/i;
const STEM_TELL_EN = /\bat (?:this|that) (?:point|moment)\b/i;
const OPENING_CLAUSE_EN = /^\s*((?:when|while|once)\b[^,;:?.!]*)/i;
const MEMORY_QUESTION_EN = /\bwhich (?:files?|functions?|methods?|variables?|class(?:es)?|lines?)\b|\bwhat (?:is|was|are|were) (?:it|they|this|that|the [\w-]+(?: [\w-]+)?) (?:called|named)\b|\bon what line\b/i;

// Files the quiz does not ask about: docs, tests, generated and vendored code,
// for TypeScript and Go. Files the review already treats as mechanical (lock
// files, binaries, generated headers, pure renames) are left out as well. A
// profile adds its own patterns in quiz.non_product_globs.
export const NON_PRODUCT_GLOBS = Object.freeze([
  '**/*.md', '**/*.mdx', '**/*.rst', 'docs/**', 'doc/**', 'changelogs/**', '**/CHANGELOG*', 'LICENSE*', 'NOTICE*',
  '**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/__mocks__/**', '**/test/**', '**/tests/**', '**/fixtures/**', '**/fixture/**', 'test-support/**',
  '**/*_test.go', '**/testdata/**', '**/mocks/**', '**/mock_*.go', '**/*_mock.go',
  '**/generated/**', '**/*.gen.*', '**/*.generated.*', '**/*_gen.go', '**/*.pb.go', '**/zz_generated*', '**/*.snap', '**/__snapshots__/**', '**/dist/**', '**/vendor/**',
  '**/*-lock.yaml', '**/*-lock.json', '**/go.sum',
]);

const CORE_DIMENSIONS = new Set(['design-intent', 'failure-mode']);

export function quizConfig(profile = {}) {
  const raw = profile.quiz || {};
  const int = (key, min, max) => {
    const value = Number(raw[key]);
    return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : QUIZ_DEFAULTS[key];
  };
  const skip = [];
  for (const pattern of raw.skip_source_branches || []) {
    try {
      skip.push(new RegExp(String(pattern)));
    } catch {
      // ci/test/profiles.test.mjs checks that every pattern compiles
    }
  }
  return {
    enabled: raw.enabled === true,
    questions: int('questions', MIN_QUESTIONS, MAX_QUESTIONS),
    min_code_lines: int('min_code_lines', 1, 1e9),
    min_code_files: int('min_code_files', 1, 1e9),
    regen_min_line_delta: int('regen_min_line_delta', 1, 1e9),
    regen_min_file_delta: int('regen_min_file_delta', 1, 1e9),
    max_per_mr: int('max_per_mr', 1, 100),
    skip_source_branches: skip,
    non_product_globs: [...NON_PRODUCT_GLOBS, ...(raw.non_product_globs || []).map(String)],
  };
}

export function isProductCode(file, config) {
  return !file.mechanical && !matchAny(file.path, config.non_product_globs);
}

// Which PRs get a quiz: the repository has it enabled, the source branch is not
// a mechanical one (a sync or release branch, whose diff the author did not
// write), and the PR changes enough product code or a risk path in product
// code. The risk path keeps small risky changes covered.
export function quizScope({ files, profile, sourceBranch, lang = DEFAULT_LANGUAGE }) {
  const config = quizConfig(profile);
  const product = files.filter((file) => isProductCode(file, config));
  const paths = product.map((file) => file.path).sort();
  const hits = riskHits(product, profile, lang);
  const scope = {
    code_lines: product.reduce((sum, file) => sum + (file.additions || 0) + (file.deletions || 0), 0),
    code_files: product.length,
    files_hash: sha256(paths.join('\n')).slice(0, 16),
    file_keys: [...new Set(paths.map((file) => sha256(file).slice(0, 8)))].sort().slice(0, 300),
    files: rankFiles(product, hits).slice(0, 40),
    risk: hits.map((hit) => hit.name),
  };
  if (!config.enabled) return { ...scope, needed: false, reason: 'disabled' };
  if (config.skip_source_branches.some((pattern) => pattern.test(String(sourceBranch || '')))) return { ...scope, needed: false, reason: 'skipped-branch' };
  if (!product.length) return { ...scope, needed: false, reason: 'no-product-code' };
  if (scope.code_lines >= config.min_code_lines || product.length >= config.min_code_files) {
    return { ...scope, needed: true, reason: 'size', why: t(lang, 'quiz.reason.size', { lines: scope.code_lines, files: product.length }) };
  }
  if (hits.length) return { ...scope, needed: true, reason: 'risk', why: t(lang, 'quiz.reason.risk', { names: hits.map((hit) => hit.name).join(t(lang, 'list')) }) };
  return { ...scope, needed: false, reason: 'small' };
}

// A later push asks the quiz again only when the product code moved enough
// that the old questions may no longer describe it. Quiz notes keep the size
// and the file set they were written for; notes written without the file set
// (fileKeys) compare file counts instead.
export function shouldRegenerate({ meta, scope, config }) {
  const lineDelta = Math.abs(Number(scope.code_lines || 0) - Number(meta?.codeLines || 0));
  let fileDelta;
  if (Array.isArray(meta?.fileKeys) && Array.isArray(scope.file_keys)) {
    const before = new Set(meta.fileKeys);
    const now = new Set(scope.file_keys);
    fileDelta = [...now].filter((key) => !before.has(key)).length + [...before].filter((key) => !now.has(key)).length;
  } else {
    fileDelta = meta?.filesHash !== scope.files_hash ? Math.abs(Number(scope.code_files || 0) - Number(meta?.codeFileCount || 0)) : 0;
  }
  if (lineDelta >= config.regen_min_line_delta) return { regenerate: true, reason: 'lines', lineDelta, fileDelta };
  if (fileDelta >= config.regen_min_file_delta) return { regenerate: true, reason: 'files', lineDelta, fileDelta };
  return { regenerate: false, reason: 'small-change', lineDelta, fileDelta };
}

// Whether this round writes a quiz. current is the quiz the PR shows now,
// answered whether anyone answered it, quizzes how many quizzes the PR has had.
// A PR still holding a sealed quiz of an older plugin version gets no new one.
export function decideQuiz({ scope, config, legacy, current, answered, quizzes }) {
  if (!config.enabled) return { generate: false, why: 'disabled' };
  if (legacy) return { generate: false, why: 'legacy' };
  if (!scope.needed) return { generate: false, why: scope.reason };
  if (!current) return quizzes >= config.max_per_mr ? { generate: false, why: 'cap' } : { generate: true, why: 'first' };
  if (answered) return { generate: false, why: 'answered' };
  const regen = shouldRegenerate({ meta: current.meta, scope, config });
  const deltas = { line_delta: regen.lineDelta, file_delta: regen.fileDelta };
  if (!regen.regenerate) return { generate: false, why: 'kept', ...deltas };
  if (quizzes >= config.max_per_mr) return { generate: false, why: 'cap', ...deltas };
  return { generate: true, why: 'regenerate-' + regen.reason, ...deltas };
}

// ---------------------------------------------------------------- questions

const BACKTICKED = /\x60[^\x60\n]+\x60/g;
const PATH_LIKE = /(?:\.{1,2}\/)?(?:[\w.-]+\/)+[\w.-]+/g;
const DOTTED_NAME = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(\))?/g;
const WORD = /[A-Za-z_$][\w$]*(?:\(\))?/g;
// Product names that look like identifiers but are plain words to a reader.
const PLAIN_NAMES = new Set(['GitLab', 'GitHub', 'MiniMax', 'OpenAI', 'ChatGPT', 'DeepSeek', 'JavaScript', 'TypeScript', 'GraphQL', 'WebSocket', 'PostgreSQL', 'MySQL', 'MongoDB', 'OAuth', 'macOS', 'iOS', 'iPadOS', 'iPhone', 'iPad', 'YouTube', 'WeChat', 'DevTools', 'Node.js', 'Next.js', 'Vue.js']);

function isCodeWord(word) {
  if (word.endsWith('()')) return true;
  if (PLAIN_NAMES.has(word)) return false;
  // snake_case, camelCase, PascalCase with two or more humps, HTTPClient
  return /[A-Za-z0-9]_[A-Za-z0-9]/.test(word) || /[a-z0-9][A-Z]/.test(word) || /[A-Z]{2,}[a-z]{2,}/.test(word);
}

// Code-like tokens in question text: backticked spans, file paths, dotted
// names, calls, snake_case, camelCase and PascalCase with two or more humps.
// Single words (Agent, Desktop, source) and acronyms (API, PR) are plain.
export function codeTokens(text) {
  const tokens = [];
  let rest = String(text ?? '');
  const take = (pattern, keep) => {
    rest = rest.replace(pattern, (match) => {
      if (!keep(match)) return match;
      tokens.push(match);
      return ' ';
    });
  };
  take(BACKTICKED, () => true);
  take(PATH_LIKE, (match) => /[a-z]/.test(match) && match.replace(/\W/g, '').length >= 4);
  take(DOTTED_NAME, (match) => !PLAIN_NAMES.has(match) && match.replace(/\(\)$/, '').split('.').some((part) => part.length >= 2));
  for (const word of rest.match(WORD) || []) if (isCodeWord(word)) tokens.push(word);
  return tokens;
}

const chars = (text) => [...String(text ?? '')].length;
const words = (text) => (String(text ?? '').match(/[^\s]+/g) || []).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

// The rules that differ by language. Each returns the problems of a stem or
// of one option; the problem texts are in English, as only the model reads them.
const LANGUAGE_RULES = {
  zh: {
    stem(prompt) {
      const problems = [];
      if (chars(prompt) > MAX_STEM_CHARS) problems.push('the stem is ' + chars(prompt) + ' characters, at most ' + MAX_STEM_CHARS);
      if (STEM_TELL.test(prompt)) problems.push('the stem uses 此时 or opens with 当……时; say what happens in a plain sentence');
      return problems;
    },
    option(option, number) {
      const problems = [];
      if (chars(option) > MAX_OPTION_CHARS) problems.push('option ' + number + ' is ' + chars(option) + ' characters, at most ' + MAX_OPTION_CHARS);
      const reason = option.match(REASON_CLAUSE);
      if (reason) problems.push('option ' + number + ' gives a reason (' + reason[0] + '); an option states only the result, the reason goes in the explanation');
      return problems;
    },
    memory: MEMORY_QUESTION,
  },
  en: {
    stem(prompt) {
      const problems = [];
      if (words(prompt) > MAX_STEM_WORDS) problems.push('the stem is ' + words(prompt) + ' words, at most ' + MAX_STEM_WORDS);
      const tell = prompt.match(STEM_TELL_EN);
      if (tell) problems.push('the stem uses "' + tell[0] + '"; say what happens in a plain sentence');
      const opening = prompt.match(OPENING_CLAUSE_EN);
      if (opening && words(opening[1]) > MAX_OPENING_CLAUSE_WORDS) problems.push('the stem opens with a ' + words(opening[1]) + '-word "' + opening[1].trim().split(/\s+/)[0] + ' ..." clause, at most ' + MAX_OPENING_CLAUSE_WORDS + '; state the situation in its own short sentence');
      return problems;
    },
    option(option, number) {
      const problems = [];
      if (words(option) > MAX_OPTION_WORDS) problems.push('option ' + number + ' is ' + words(option) + ' words, at most ' + MAX_OPTION_WORDS);
      const reason = option.match(REASON_CLAUSE_EN);
      if (reason) problems.push('option ' + number + ' gives a reason (' + reason[0] + '); an option states only the result, the reason goes in the explanation');
      return problems;
    },
    memory: MEMORY_QUESTION_EN,
  },
};
const rulesFor = (lang) => LANGUAGE_RULES[lang] || LANGUAGE_RULES[DEFAULT_LANGUAGE];

// Deterministic plain-language checks of one question, in the rules of its
// language. The wording rules that need judgement (long modifiers, lists joined
// by 顿号, invented terms) are in the pr-quiz skill; only the cheap, unambiguous
// ones are checked here.
export function plainLanguageProblems({ prompt, options = [] }, lang = DEFAULT_LANGUAGE) {
  const rules = rulesFor(lang);
  const problems = [];
  const stem = codeTokens(prompt);
  if (stem.length > MAX_STEM_CODE_TOKENS) problems.push('the stem has ' + stem.length + ' code names (' + stem.join(', ') + '), at most ' + MAX_STEM_CODE_TOKENS);
  problems.push(...rules.stem(prompt));
  options.forEach((option, index) => {
    const found = codeTokens(option);
    if (found.length > MAX_OPTION_CODE_TOKENS) problems.push('option ' + (index + 1) + ' has ' + found.length + ' code names (' + found.join(', ') + '), at most ' + MAX_OPTION_CODE_TOKENS);
    problems.push(...rules.option(option, index + 1));
  });
  return problems;
}

// A question gives its answer away when the correct option is clearly the
// longest one. Models do this often even when told not to.
export function revealsAnswerByLength(question) {
  const lengths = question.options.map(chars);
  const right = lengths[question.answer_index];
  return !lengths.some((length, index) => index !== question.answer_index && length >= right * 0.85);
}

// Model text goes into a note the bot posts: no HTML, images, quick actions or
// comment markers, and one line, so the checkbox parser never loses an option.
function oneLine(value, max) {
  return sanitizeForComment(typeof value === 'string' ? value : '').replace(/<!--|-->/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeEvidence(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => ({ path: oneLine(item?.path, 300).replace(/\x60/g, '').replace(/^\.?\//, ''), line: Number.isInteger(item?.line) && item.line > 0 ? item.line : 0 }))
    .filter((item) => item.path && !/\s/.test(item.path))
    .slice(0, 3);
}

// Models tend to write the correct option first. The order is shuffled by the
// stem, so the same question always gets the same order.
function optionOrder(seed, count) {
  const order = [...Array(count).keys()];
  for (let i = count - 1; i > 0; i -= 1) {
    const j = parseInt(sha256(seed + ':' + i).slice(0, 8), 16) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// At most count questions, at least half of them design-intent or
// failure-mode when there are enough, questions whose answer stands out by
// length last; the model's order otherwise.
function pickQuestions(accepted, count) {
  const fair = accepted.filter((question) => !revealsAnswerByLength(question));
  const pool = [...fair, ...accepted.filter((question) => revealsAnswerByLength(question))];
  const size = Math.min(count, pool.length);
  const picked = new Set(pool.filter((question) => CORE_DIMENSIONS.has(question.dimension)).slice(0, Math.ceil(size / 2)));
  for (const question of pool) {
    if (picked.size >= size) break;
    picked.add(question);
  }
  return accepted.filter((question) => picked.has(question));
}

function finalize(question, position) {
  const order = optionOrder(question.prompt, question.options.length);
  const options = order.map((original, slot) => ({ id: String.fromCharCode(97 + slot), text: question.options[original] }));
  return {
    id: 'q' + (position + 1),
    dimension: question.dimension,
    prompt: question.prompt,
    options,
    correct_option_id: options[order.indexOf(question.answer_index)].id,
    explanation: question.explanation,
    evidence: question.evidence,
  };
}

// The schema only shapes the answer (see core/vocab.mjs); every rule of the
// question contract is checked here. A question that breaks one is dropped with
// its reasons. Fewer than MIN_QUESTIONS usable questions means the attempt
// failed; the caller asks once for a rewrite (rewriteRequest).
export function normalizeQuiz(raw, { count = QUIZ_DEFAULTS.questions, lang = DEFAULT_LANGUAGE } = {}) {
  const want = Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, Number(count) || QUIZ_DEFAULTS.questions));
  const items = Array.isArray(raw?.questions) ? raw.questions : [];
  const accepted = [];
  const rejected = [];
  const stems = new Set();
  items.slice(0, MAX_QUESTIONS * 2).forEach((item, index) => {
    const prompt = oneLine(item?.prompt, 400);
    const options = (Array.isArray(item?.options) ? item.options : []).map((option) => oneLine(typeof option === 'string' ? option : option?.text, 240).replace(/^[A-Ea-e][.、)）:：]\s*/, ''));
    const answer = Number.isInteger(item?.answer_index) ? item.answer_index : -1;
    const explanation = oneLine(item?.explanation, 800);
    const dimension = matchValue(item?.dimension, QUIZ_DIMENSIONS);
    const reasons = [];
    if (chars(prompt) < 8) reasons.push('the stem is missing or too short');
    else if (stems.has(prompt)) reasons.push('the same stem as an earlier question');
    if (!dimension) reasons.push('dimension is not one of ' + QUIZ_DIMENSIONS.join(', '));
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) reasons.push(options.length + ' options, give ' + MIN_OPTIONS + ' to ' + MAX_OPTIONS);
    else if (options.some((option) => chars(option) < 2)) reasons.push('an option is empty');
    else if (new Set(options).size !== options.length) reasons.push('two options are the same');
    if (answer < 0 || answer >= options.length) reasons.push('answer_index does not point at an option');
    if (chars(explanation) < 8) reasons.push('the explanation is missing');
    if (rulesFor(lang).memory.test(prompt)) reasons.push('it asks the author to recall a name or a place in the diff');
    reasons.push(...plainLanguageProblems({ prompt, options }, lang));
    if (reasons.length) {
      rejected.push({ index, prompt: prompt.slice(0, 120), reasons });
      return;
    }
    stems.add(prompt);
    accepted.push({ dimension, prompt, options, answer_index: answer, explanation, evidence: normalizeEvidence(item?.evidence) });
  });
  const questions = pickQuestions(accepted, want).map(finalize);
  return {
    questions,
    rejected,
    stats: { written: items.length, accepted: accepted.length, kept: questions.length, dropped: rejected.length, core: questions.filter((question) => CORE_DIMENSIONS.has(question.dimension)).length },
  };
}

// The rewrite request, sent once in the same model session when fewer than
// MIN_QUESTIONS questions survived, in the language of the quiz. It names every
// rejected question and why.
export function rewriteRequest({ questions, rejected }, { ask, lang = DEFAULT_LANGUAGE }) {
  const lines = [t(lang, 'rewrite.intro')];
  for (const item of rejected.slice(0, 12)) lines.push(t(lang, 'rewrite.item', { n: item.index + 1, prompt: JSON.stringify(item.prompt.slice(0, 60)), reasons: item.reasons.join('; ') }));
  lines.push('', t(lang, 'rewrite.left', { left: questions.length, min: MIN_QUESTIONS, ask }));
  lines.push('', t(lang, 'rewrite.format'));
  return lines.join('\n');
}

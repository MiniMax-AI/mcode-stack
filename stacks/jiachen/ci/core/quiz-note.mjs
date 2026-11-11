import { shortFormAnswers } from './commands.mjs';
import { DEFAULT_LANGUAGE, t } from './i18n.mjs';
import { decideQuiz, MIN_OPTIONS } from './quiz.mjs';
import { sha256 } from './util.mjs';

// The quiz as a comment on the PR. The comment is the state: the questions, the answer
// area the author ticks, a collapsed answer key and a hidden meta marker. The
// format, the markers and the schema version are those of an earlier quiz job,
// so the quiz notes it published are read as the current quiz, whoever posted
// them. One plain note, not a resolvable discussion: the quiz
// never blocks a merge.

export const QUIZ_SCHEMA_VERSION = 3;
export const QUIZ_META_MARKER = 'mcode-author-quiz-meta';
export const QUIZ_ANSWER_MARKER = 'mcode-author-quiz-answer';
export const QUIZ_KEY_MARKER = 'mcode-author-quiz-key';
export const QUIZ_RESPONSE_MARKER = QUIZ_META_MARKER + '-response';

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}

// Identity of a question set: questions and options, not the answer key. The
// same algorithm as the earlier quiz job, so an id in one of its notes can be
// checked.
export function quizId(quiz) {
  const canonical = (quiz?.questions ?? []).map((question) => ({ id: question.id, prompt: question.prompt, options: question.options.map((option) => ({ id: option.id, text: option.text })) }));
  return sha256(stableStringify(canonical)).slice(0, 12);
}

// The answer area stays flat: GitLab re-renders the whole note on every tick,
// and an open <details> would close under the author. Each option carries a
// hidden qid:oid marker, so the ticks parse whatever the rendering does.
export function renderAnswerBlock(quiz) {
  const lines = ['<!-- ' + QUIZ_ANSWER_MARKER + ' -->'];
  for (const question of quiz.questions) {
    lines.push('**' + question.id.toUpperCase() + '.** ' + question.prompt);
    for (const option of question.options) lines.push('- [ ] <!-- ' + question.id + ':' + option.id + ' --> ' + option.id.toUpperCase() + '. ' + option.text);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderAnswerKey(quiz, lang = DEFAULT_LANGUAGE) {
  const lines = ['<!-- ' + QUIZ_KEY_MARKER + ' -->'];
  for (const question of quiz.questions) {
    lines.push('**' + question.id.toUpperCase() + '.** ' + t(lang, 'quiz.answer', { answer: question.correct_option_id.toUpperCase() }), '', '> ' + question.explanation);
    if (question.evidence?.length) lines.push('', t(lang, 'quiz.evidence', { places: question.evidence.map((item) => '\x60' + item.path + (item.line ? ':' + item.line : '') + '\x60').join(t(lang, 'list')) }));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// meta: generatedAtSha, and the quiz scope (core/quiz.mjs quizScope) it was
// written for, which decides later whether a push asks it again.
export function renderQuizNote(quiz, { generatedAtSha = null, scope = {}, again = false, lang = DEFAULT_LANGUAGE } = {}) {
  const meta = {
    schemaVersion: QUIZ_SCHEMA_VERSION,
    quizId: quizId(quiz),
    questionIds: quiz.questions.map((question) => question.id),
    generatedAtSha,
    codeLines: scope.code_lines ?? null,
    codeFileCount: scope.code_files ?? null,
    filesHash: scope.files_hash ?? null,
    questionCount: quiz.questions.length,
    fileKeys: scope.file_keys ?? [],
  };
  return [
    t(lang, 'quiz.heading'),
    '',
    (again ? t(lang, 'quiz.again') : '') + t(lang, 'quiz.intro'),
    '',
    renderAnswerBlock(quiz),
    '',
    '<details>',
    t(lang, 'quiz.key_summary'),
    '',
    renderAnswerKey(quiz, lang),
    '',
    '</details>',
    '',
    '<!-- ' + QUIZ_META_MARKER + ': ' + JSON.stringify(meta) + ' -->',
    '<!-- ' + QUIZ_META_MARKER + '-end -->',
    '',
  ].join('\n');
}

export function parseQuizMeta(markdown) {
  const match = String(markdown ?? '').match(new RegExp('<!--\\s*' + QUIZ_META_MARKER + ':\\s*(\\{.*?\\})\\s*-->', 's'));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed.quizId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

// The question set, rebuilt from the answer area of a note. quizId over the
// result must match the meta: a note whose questions were edited does not.
export function parseQuizBlock(markdown) {
  const text = String(markdown ?? '');
  if (!text.includes(QUIZ_ANSWER_MARKER)) return null;
  const questions = [];
  const byId = new Map();
  for (const line of text.split(/\r?\n/)) {
    const option = line.match(/^\s*[-*]\s*\[[ xX]\]\s*<!--\s*([a-z0-9]{1,4}):([a-e])\s*-->\s*(.+?)\s*$/i);
    if (option) {
      const question = byId.get(option[1].toLowerCase());
      const id = option[2].toLowerCase();
      if (question && !question.options.some((item) => item.id === id)) question.options.push({ id, text: option[3].replace(/^[A-Ea-e]\.\s*/, '') });
      continue;
    }
    const heading = line.match(/^\s*\*\*([A-Za-z][A-Za-z0-9]{0,3})\.\*\*\s*(.+?)\s*$/);
    if (heading && !byId.has(heading[1].toLowerCase())) {
      const question = { id: heading[1].toLowerCase(), prompt: heading[2], options: [] };
      byId.set(question.id, question);
      questions.push(question);
    }
  }
  const usable = questions.filter((question) => question.options.length >= MIN_OPTIONS);
  return usable.length ? { schemaVersion: QUIZ_SCHEMA_VERSION, questions: usable } : null;
}

// The answer key of a quiz note: per question the correct option and the
// explanation. The earlier quiz job wrote "正确答案：B", this plugin "答案：B" or
// "Answer: B". Every form is read whatever the language setting, so a PR
// whose language changed between rounds keeps its quiz.
const ANSWER_KEY_HEADING = /^\s*\*\*([A-Za-z][A-Za-z0-9]{0,3})\.\*\*\s*(?:(?:正确)?答案\s*[:：]|(?:correct\s+)?answer\s*:)\s*([A-Ea-e])\s*$/i;

export function parseAnswerKey(markdown) {
  const text = String(markdown ?? '');
  const start = text.indexOf(QUIZ_KEY_MARKER);
  const key = new Map();
  if (start < 0) return key;
  let current = null;
  for (const line of text.slice(start).split(/\r?\n/)) {
    const heading = line.match(ANSWER_KEY_HEADING);
    if (heading) {
      current = { correct_option_id: heading[2].toLowerCase(), explanation: '' };
      key.set(heading[1].toLowerCase(), current);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote && current && !current.explanation) current.explanation = quote[1].trim();
  }
  return key;
}

// The question set of a quiz note with its answer key.
export function readQuiz(markdown) {
  const quiz = parseQuizBlock(markdown);
  if (!quiz) return null;
  const key = parseAnswerKey(markdown);
  return { ...quiz, questions: quiz.questions.map((question) => ({ ...question, ...(key.get(question.id) || {}) })) };
}

// Ticked boxes of an answer area that still has its markers: the quiz note
// itself, or a copy of its Markdown in a comment.
export function parseAnswers(markdown) {
  const text = String(markdown ?? '');
  if (!text.includes(QUIZ_ANSWER_MARKER)) return null;
  const selections = new Map();
  const multiSelected = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(?:<!--\s*([a-z0-9]{1,4}):([a-e])\s*-->)?/i);
    if (!match || !match[2] || match[1].toLowerCase() !== 'x') continue;
    const question = match[2].toLowerCase();
    if (selections.has(question)) multiSelected.add(question);
    else selections.set(question, match[3].toLowerCase());
  }
  return { selections, multiSelected };
}

// A copy of the rendered quiz loses the hidden markers, since GitLab copies what
// it shows. The copy still has the question numbers and the option letters.
export function parseCheckedLines(markdown) {
  let question = null;
  const selections = new Map();
  const multiSelected = new Set();
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const heading = line.match(/^\s*(?:\*\*)?Q(\d{1,2})[.、:：]/i);
    if (heading) {
      question = 'q' + Number(heading[1]);
      continue;
    }
    const checked = line.match(/^\s*[-*]\s*\[[xX]\]\s*([A-Ea-e])[.、)）]/);
    if (!checked || !question) continue;
    if (selections.has(question)) multiSelected.add(question);
    else selections.set(question, checked[1].toLowerCase());
  }
  return selections.size ? { selections, multiSelected } : null;
}

// Only picks of questions and options the quiz has.
function known(parsed, quiz) {
  if (!parsed) return null;
  const valid = new Map(quiz.questions.map((question) => [question.id, new Set(question.options.map((option) => option.id))]));
  const selections = new Map([...parsed.selections].filter(([question, option]) => valid.get(question)?.has(option)));
  const multiSelected = new Set([...parsed.multiSelected].filter((question) => valid.has(question)));
  return selections.size || multiSelected.size ? { selections, multiSelected } : null;
}

function authorAnswer(body, quiz) {
  const text = String(body || '');
  const marked = known(parseAnswers(text), quiz);
  if (marked) return marked;
  const copied = known(parseCheckedLines(text), quiz);
  if (copied) return copied;
  const short = shortFormAnswers(text, quiz.questions.length);
  if (!short) return null;
  const selections = new Map();
  for (const [index, answer] of short) {
    if (typeof answer.choice === 'number') selections.set(quiz.questions[index].id, String.fromCharCode(97 + answer.choice));
  }
  return known({ selections, multiSelected: new Set() }, quiz);
}

// The current quiz: the newest note with a meta marker of this schema version.
// A note by the PR author is a copy, never the quiz. When the newest quiz note
// no longer rebuilds to its own id (someone edited its questions), the PR has
// no readable quiz.
export function findPublishedQuiz(notes, { authorId } = {}) {
  for (let index = (notes || []).length - 1; index >= 0; index -= 1) {
    const note = notes[index];
    if (!note || note.system || (authorId !== undefined && authorId !== null && note.author?.id === authorId)) continue;
    const meta = parseQuizMeta(note.body);
    if (!meta || meta.schemaVersion !== QUIZ_SCHEMA_VERSION) continue;
    const quiz = readQuiz(note.body);
    return quiz && quizId(quiz) === meta.quizId ? { note, meta, quiz } : null;
  }
  return null;
}

// Quizzes the PR has had, of any schema version.
export function countQuizzes(notes, { authorId } = {}) {
  const ids = new Set();
  for (const note of notes || []) {
    if (!note || note.system || (authorId !== undefined && authorId !== null && note.author?.id === authorId)) continue;
    const meta = parseQuizMeta(note.body);
    if (meta) ids.add(meta.quizId);
  }
  return ids.size;
}

// The author's answers to the current quiz. A comment by the PR author posted
// after the quiz wins: a copy of the answer area, a copy of the rendered quiz,
// or a reply such as "1A 2C". Otherwise the boxes ticked on the quiz note,
// which do not show who ticked them.
export function findSubmission({ notes, current, authorId }) {
  const quizNoteId = Number(current.note.id) || 0;
  if (authorId !== undefined && authorId !== null) {
    for (let index = (notes || []).length - 1; index >= 0; index -= 1) {
      const note = notes[index];
      if (!note || note.system || note.id === current.note.id || note.author?.id !== authorId) continue;
      if (quizNoteId && Number(note.id) < quizNoteId) continue;
      const parsed = authorAnswer(note.body, current.quiz);
      if (parsed) return { source: 'author-comment', stamp: 'note:' + note.id, ...parsed };
    }
  }
  const inPlace = known(parseAnswers(current.note.body), current.quiz);
  return inPlace ? { source: 'in-place', stamp: 'note:' + current.note.id + '@' + (current.note.updated_at || ''), ...inPlace } : null;
}

// What was picked, per question. No grading: the answers are public.
export function summarizeSubmission(quiz, submission) {
  const selections = submission?.selections instanceof Map ? submission.selections : new Map();
  const multiSelected = submission?.multiSelected instanceof Set ? submission.multiSelected : new Set();
  const answers = quiz.questions.map((question) => ({ id: question.id, selected: multiSelected.has(question.id) ? null : selections.get(question.id) ?? null, multiSelected: multiSelected.has(question.id) }));
  return { quizId: quizId(quiz), total: answers.length, answeredCount: answers.filter((answer) => answer.selected !== null).length, answers };
}

function answerList(summary) {
  return summary.answers.map((answer) => answer.id + '=' + (answer.multiSelected ? '*' : answer.selected ?? ''));
}

export function findLatestResponse(notes, key) {
  const pattern = new RegExp('<!--\\s*' + QUIZ_RESPONSE_MARKER + ':\\s*(\\{.*?\\})\\s*-->', 's');
  for (let index = (notes || []).length - 1; index >= 0; index -= 1) {
    const match = String(notes[index]?.body ?? '').match(pattern);
    if (!match) continue;
    try {
      const response = JSON.parse(match[1]);
      if (response?.quizId === key) return { note: notes[index], response };
    } catch {
      // a malformed marker is not a record
    }
  }
  return null;
}

// A record is posted when the picks or where they came from changed since the
// last record; ticking a box off and on again posts nothing new.
export function submissionChanged(recorded, summary, source) {
  if (!recorded) return true;
  return recorded.response?.source !== source || JSON.stringify(recorded.response?.answers || []) !== JSON.stringify(answerList(summary));
}

export function renderRecordNote(summary, { author = null, source = 'in-place', stamp = '', lang = DEFAULT_LANGUAGE } = {}) {
  const count = { answered: summary.answeredCount, total: summary.total };
  const head = source === 'author-comment'
    ? t(lang, 'record.by_comment', { who: author ? '@' + author : t(lang, 'record.author'), ...count })
    : t(lang, 'record.in_place', count);
  const lines = [head, '', t(lang, 'record.table_head'), '| --- | --- |'];
  for (const answer of summary.answers) lines.push('| ' + answer.id.toUpperCase() + ' | ' + (answer.multiSelected ? t(lang, 'record.multi') : answer.selected ? answer.selected.toUpperCase() : t(lang, 'record.none')) + ' |');
  lines.push('', t(lang, 'record.footer'));
  lines.push('', '<!-- ' + QUIZ_RESPONSE_MARKER + ': ' + JSON.stringify({ quizId: summary.quizId, source, stamp, answers: answerList(summary) }) + ' -->', '');
  return lines.join('\n');
}

// A quiz kept in the summary state by plugin versions before 0.7.0: sealed
// answers in a resolvable discussion. Such a PR keeps it untouched.
export function isLegacyQuiz(quiz) {
  return Boolean(quiz) && quiz.v !== 2;
}

// What prepare decides for this round, from the PR's comments.
export function quizRound({ notes, authorId, scope, config, legacy }) {
  const current = findPublishedQuiz(notes, { authorId });
  const answered = Boolean(current && findSubmission({ notes, current, authorId }));
  const quizzes = countQuizzes(notes, { authorId });
  const decision = decideQuiz({ scope, config, legacy, current, answered, quizzes });
  return { ...decision, current: current ? { id: current.meta.quizId, note_id: current.note.id } : null, answered, quizzes };
}

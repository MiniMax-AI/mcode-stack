import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeQuiz, quizConfig } from '../core/quiz.mjs';
import { countQuizzes, findLatestResponse, findPublishedQuiz, findSubmission, isLegacyQuiz, parseQuizBlock, parseQuizMeta, QUIZ_ANSWER_MARKER, QUIZ_KEY_MARKER, quizId, quizRound, readQuiz, renderAnswerBlock, renderQuizNote, renderRecordNote, submissionChanged, summarizeSubmission } from '../core/quiz-note.mjs';
import { embedState, extractState } from '../core/state.mjs';

const question = (dimension, prompt, options, answer = 0) => ({ dimension, prompt, options, answer_index: answer, explanation: '后保存的会覆盖先保存的，不做合并。', evidence: [{ path: 'internal/session/title.go', line: 40 }] });
const { questions } = normalizeQuiz({
  questions: [
    question('boundary', '两个窗口同时改同一个会话的标题，最后留下哪个？', ['先改的那个窗口的标题', '后保存的那个窗口的标题', '两个标题都留下，变成两条'], 1),
    question('design-intent', '为什么这次把重试放到调用方，而不是下载函数里？', ['调用方知道请求能不能重复发', '下载函数里放不下更多代码', '这样出错时日志会少一些']),
    question('failure-mode', '下载到一半网络断了，用户再点一次下载会怎样？', ['从头重新下载整个文件', '接着上次的进度继续下载', '提示文件已存在，不再下载'], 1),
  ],
}, { count: 3, lang: 'zh' });
const quiz = { questions };
const scope = { code_lines: 300, code_files: 5, files_hash: '0123456789abcdef', file_keys: ['a1', 'b2', 'c3', 'd4', 'e5'] };
const BOT = 999;
const AUTHOR = 77;
const body = renderQuizNote(quiz, { generatedAtSha: 'f'.repeat(40), scope, lang: 'zh' });
const quizNote = (text = body, extra = {}) => ({ id: 100, author: { id: BOT }, body: text, updated_at: 't0', ...extra });
const tick = (text, pairs) => pairs.reduce((out, [qid, oid]) => out.replace('- [ ] <!-- ' + qid + ':' + oid + ' -->', '- [x] <!-- ' + qid + ':' + oid + ' -->'), text);
const current = (notes) => findPublishedQuiz(notes, { authorId: AUTHOR });

test('the quiz note is plain: short intro, flat answer area, the key collapsed at the end, no hashes', () => {
  assert.match(body, /^### 作者答题\n\n这次改动有几处容易出问题，下面几道题帮你确认一遍。直接勾选，答完可以展开最下面的答案对照。不影响合入。\n/);
  assert.ok(body.indexOf(QUIZ_ANSWER_MARKER) < body.indexOf('<details>'), 'ticking re-renders the note, so the answer area is never collapsed');
  assert.equal(body.split('<details>').length - 1, 1);
  assert.ok(body.indexOf('<summary>答案对照</summary>') < body.indexOf(QUIZ_KEY_MARKER));
  const visible = body.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visible, new RegExp(quizId(quiz) + '|题目指纹|mcode-review|review\\.mjs|流水线'));
  for (const item of questions) {
    assert.match(body, new RegExp('\\*\\*' + item.id.toUpperCase() + '\\.\\*\\* ' + item.prompt));
    assert.match(body, new RegExp('\\*\\*' + item.id.toUpperCase() + '\\.\\*\\* 答案：' + item.correct_option_id.toUpperCase()));
  }
  assert.match(body, /参考：\x60internal\/session\/title\.go:40\x60/);
  assert.match(renderQuizNote(quiz, { scope, again: true, lang: 'zh' }), /代码改动比较大，题目重新出了一遍，之前的题不用再答。这次改动有几处/);
});

test('render and parse round trip: the note rebuilds to its own id and keeps the scope it was written for', () => {
  const meta = parseQuizMeta(body);
  assert.equal(meta.schemaVersion, 3);
  assert.equal(meta.quizId, quizId(quiz));
  assert.deepEqual([meta.codeLines, meta.codeFileCount, meta.filesHash, meta.fileKeys], [300, 5, '0123456789abcdef', scope.file_keys]);
  const rebuilt = parseQuizBlock(body);
  assert.equal(quizId(rebuilt), meta.quizId);
  assert.deepEqual(rebuilt.questions.map((item) => item.options), questions.map((item) => item.options));
  const found = current([quizNote()]);
  assert.equal(found.note.id, 100);
  assert.equal(current([quizNote(body.replace(questions[0].prompt, '改过的题目，和原来的不一样了吗？'))]), null, 'an edited quiz is not the quiz any more');
  assert.equal(current([quizNote(body, { author: { id: AUTHOR } })]), null, 'a copy by the PR author is not the quiz');
});

test('all three answer forms are read: ticks on the quiz, a copied answer area, a short reply', () => {
  const inPlace = [quizNote(tick(body, [['q1', 'b']]), { updated_at: 't1' })];
  const ticked = findSubmission({ notes: inPlace, current: current(inPlace), authorId: AUTHOR });
  assert.equal(ticked.source, 'in-place');
  assert.equal(ticked.stamp, 'note:100@t1');
  assert.deepEqual([...ticked.selections], [['q1', 'b']]);

  const copied = [quizNote(), { id: 101, author: { id: AUTHOR }, body: tick(renderAnswerBlock(quiz), [['q2', 'a'], ['q3', 'b']]) }];
  const pasted = findSubmission({ notes: copied, current: current(copied), authorId: AUTHOR });
  assert.equal(pasted.source, 'author-comment');
  assert.deepEqual([...pasted.selections], [['q2', 'a'], ['q3', 'b']]);

  // A copy of the rendered note loses the hidden markers; numbers and letters remain.
  const rendered = [quizNote(), { id: 102, author: { id: AUTHOR }, body: '**Q1.** 两个窗口\n- [ ] A. 先改的\n- [x] B. 后保存的\n\n**Q3.** 下载\n- [x] C. 提示' }];
  assert.deepEqual([...findSubmission({ notes: rendered, current: current(rendered), authorId: AUTHOR }).selections], [['q1', 'b'], ['q3', 'c']]);

  const reply = [quizNote(), { id: 103, author: { id: AUTHOR }, body: '1B 2a 3C' }];
  const short = findSubmission({ notes: reply, current: current(reply), authorId: AUTHOR });
  assert.equal(short.stamp, 'note:103');
  assert.deepEqual([...short.selections], [['q1', 'b'], ['q2', 'a'], ['q3', 'c']]);

  for (const text of ['fixed in 2a3b4c', 'LGTM，1A 的问题我看过了', '- [x] 随便勾一个']) {
    const notes = [quizNote(), { id: 104, author: { id: AUTHOR }, body: text }];
    assert.equal(findSubmission({ notes, current: current(notes), authorId: AUTHOR }), null, text);
  }
  const others = [quizNote(), { id: 105, author: { id: 5 }, body: '1A 2A 3A' }, { id: 90, author: { id: AUTHOR }, body: '1A 2A 3A' }];
  assert.equal(findSubmission({ notes: others, current: current(others), authorId: AUTHOR }), null, 'another user, or an answer older than the quiz, does not count');
});

test('two ticks on one question count as no answer, and the record never grades', () => {
  const notes = [quizNote(tick(body, [['q1', 'a'], ['q1', 'b'], ['q2', 'c']]))];
  const found = current(notes);
  const summary = summarizeSubmission(found.quiz, findSubmission({ notes, current: found, authorId: AUTHOR }));
  assert.equal(summary.answeredCount, 1);
  assert.deepEqual(summary.answers.map((item) => [item.id, item.selected, item.multiSelected]), [['q1', null, true], ['q2', 'c', false], ['q3', null, false]]);
  const record = renderRecordNote(summary, { author: 'dev', source: 'in-place', stamp: 'note:100@t1', lang: 'zh' });
  assert.match(record, /^\*\*答题记录\*\*：题目上勾选了 1\/3 题。/);
  assert.match(record, /\| Q1 \| 选了多个，不算 \|\n\| Q2 \| C \|\n\| Q3 \| 没答 \|/);
  assert.match(renderRecordNote(summary, { author: 'dev', source: 'author-comment', lang: 'zh' }), /@dev 在评论里答了 1\/3 题。/);
  // English, the default.
  const english = renderRecordNote(summary, { author: 'dev', source: 'in-place', stamp: 'note:100@t1' });
  assert.match(english, /^\*\*Quiz answers\*\*: 1 of 3 ticked on the quiz\.\n\n\| Question \| Choice \|\n\| --- \| --- \|\n\| Q1 \| several ticked, not counted \|\n\| Q2 \| C \|\n\| Q3 \| no answer \|\n\nThe answer key is at the bottom of the quiz comment\. This does not affect merging\.\n/);
  assert.match(renderRecordNote(summary, { author: 'dev', source: 'author-comment' }), /^\*\*Quiz answers\*\*: @dev answered 1 of 3 in a comment\./);
  assert.match(renderRecordNote(summary, { source: 'author-comment' }), /^\*\*Quiz answers\*\*: the author answered 1 of 3 in a comment\./);
  for (const banned of ['correct', 'wrong', 'score', 'passed', 'graded']) assert.doesNotMatch(english, new RegExp(banned, 'i'));
  assert.equal(findLatestResponse([{ id: 121, author: { id: BOT }, body: english }], summary.quizId).response.source, 'in-place', 'the record marker does not depend on the language');
  for (const banned of ['答对', '答错', '正确率', '通过', '判分']) assert.doesNotMatch(record, new RegExp(banned));
  const recorded = findLatestResponse([...notes, { id: 120, author: { id: BOT }, body: record }], summary.quizId);
  assert.equal(recorded.note.id, 120);
  assert.equal(submissionChanged(recorded, summary, 'in-place'), false, 'unchanged picks are not recorded twice');
  assert.equal(submissionChanged(recorded, summary, 'author-comment'), true);
  const moreTicks = summarizeSubmission(found.quiz, { selections: new Map([['q2', 'c'], ['q3', 'a']]), multiSelected: new Set() });
  assert.equal(submissionChanged(recorded, moreTicks, 'in-place'), true);
  assert.equal(submissionChanged(null, summary, 'in-place'), true);
});

test('a quiz note an earlier quiz job published is the current quiz, and its record is found', () => {
  const theirs = readFileSync(new URL('./fixtures/quiz-author-note.md', import.meta.url), 'utf8');
  const theirRecord = readFileSync(new URL('./fixtures/quiz-author-record.md', import.meta.url), 'utf8');
  const notes = [{ id: 10, author: { id: 55 }, body: tick(theirs, [['q1', 'c']]), updated_at: 't9' }, { id: 11, author: { id: 55 }, body: theirRecord }];
  const found = current(notes);
  assert.equal(found.meta.quizId, 'd9ad7585caa1');
  assert.equal(quizId(found.quiz), 'd9ad7585caa1');
  assert.equal(found.quiz.questions.length, 3);
  const submission = findSubmission({ notes, current: found, authorId: AUTHOR });
  assert.equal(submission.source, 'in-place');
  const summary = summarizeSubmission(found.quiz, submission);
  assert.equal(summary.answeredCount, 1);
  assert.deepEqual(findLatestResponse(notes, 'd9ad7585caa1').response.answers, ['q1=c', 'q2=', 'q3=a']);
  // Its record was for other picks, so this round records the new ones.
  assert.equal(submissionChanged(findLatestResponse(notes, 'd9ad7585caa1'), summary, 'in-place'), true);
  assert.equal(countQuizzes([...notes, quizNote()], { authorId: AUTHOR }), 2);
  const older = { id: 5, author: { id: 55 }, body: theirs.replace('"schemaVersion":3', '"schemaVersion":2').replaceAll('d9ad7585caa1', 'aaaaaaaaaaaa') };
  assert.equal(countQuizzes([older, ...notes], { authorId: AUTHOR }), 2, 'quizzes of earlier versions count toward the cap');
  assert.equal(current([older]), null, 'but are not the current quiz');
  // Its answer key reads too, so a later card update can show the answers.
  assert.deepEqual(found.quiz.questions.map((item) => item.correct_option_id), ['c', 'a', 'b']);
  assert.equal(found.quiz.questions[0].explanation, '草稿会保存，但发送状态不会恢复，要用户手动重试。');
});

test('prepare writes a quiz only for a needed PR that has none, or after a big change nobody answered', () => {
  const config = quizConfig({ quiz: { enabled: true } });
  const needed = { needed: true, reason: 'size', code_lines: 300, code_files: 5, files_hash: scope.files_hash, file_keys: scope.file_keys };
  const round = (notes, extra = {}) => quizRound({ notes, authorId: AUTHOR, scope: { ...needed, ...extra }, config, legacy: false });
  assert.deepEqual([round([]).generate, round([]).why, round([]).current], [true, 'first', null]);
  assert.equal(round([quizNote()]).why, 'kept');
  assert.equal(round([quizNote()]).current.note_id, 100);
  assert.equal(round([quizNote()], { code_lines: 500 }).why, 'regenerate-lines');
  assert.equal(round([quizNote(tick(body, [['q1', 'a']]))], { code_lines: 500 }).why, 'answered');
  assert.equal(round([quizNote()], { file_keys: ['a1', 'b2', 'x', 'y', 'z'] }).why, 'regenerate-files');
  const three = [1, 2, 3].map((n) => quizNote(body.replace(quizId(quiz), 'q' + n), { id: n }));
  assert.equal(round(three).why, 'cap', 'a PR whose newest quiz is unreadable but has had three quizzes gets no fourth');
  assert.equal(quizRound({ notes: [], authorId: AUTHOR, scope: needed, config, legacy: true }).why, 'legacy');
});

test('a sealed quiz of an older version is recognised, and its summary note still parses', () => {
  const legacy = { head_sha: 'a'.repeat(40), questions: [{ id: 'Q1-abcdef', title: '锁会怎样？', options: ['a', 'b'], commitment: 'c'.repeat(64), sealed: 'x.y.z.w', status: 'pending' }], graded: false, discussion_id: 'd1', note_id: 55, card_message_id: null };
  const state = extractState('<!-- mcode-review:summary -->\n## MCode Review\n\n' + embedState({ v: 1, round: 2, quiz: legacy }));
  assert.equal(state.round, 2);
  assert.equal(isLegacyQuiz(state.quiz), true);
  assert.equal(isLegacyQuiz({ v: 2, id: 'abc', note_id: 1, card_message_id: null }), false);
  assert.equal(isLegacyQuiz(null), false);
});

const inEnglish = (item) => ({ ...item, explanation: 'The later save overwrites the earlier one; nothing is merged.' });
const english = normalizeQuiz({
  questions: [
    question('boundary', 'Two windows rename the same session at once. Which title stays?', ['The one renamed first', 'The one saved last', 'Both, as two sessions'], 1),
    question('design-intent', 'Why does the caller retry now, not the download function?', ['Only the caller knows a retry is safe', 'The download function has no room left', 'It writes fewer log lines']),
    question('failure-mode', 'The network drops halfway through a download. The user clicks again. What happens?', ['The whole file downloads again', 'It resumes where it stopped', 'It says the file already exists'], 1),
  ].map(inEnglish),
}, { count: 3 }).questions;

test('an English quiz note: same layout and markers, English text, and it parses back with its answer key', () => {
  const quizEn = { questions: english };
  const note = renderQuizNote(quizEn, { generatedAtSha: 'f'.repeat(40), scope });
  assert.match(note, /^### Author quiz\n\nA few parts of this change are easy to get wrong\. These questions help you check them\. Tick your answers here, then open the answer key at the bottom\. This does not affect merging\.\n/);
  assert.match(note, /<summary>Answer key<\/summary>\n\n<!-- mcode-author-quiz-key -->\n\*\*Q1\.\*\* Answer: [A-C]\n\n> /);
  assert.match(note, /See \x60internal\/session\/title\.go:40\x60/);
  assert.match(renderQuizNote(quizEn, { scope, again: true }), /\n\nThe code changed a lot, so the questions were written again\. You do not need to answer the earlier ones\. A few parts of this change/);
  assert.doesNotMatch(note.replace(/<!--[\s\S]*?-->/g, ''), /[\u3400-\u9fff]/);
  const found = current([quizNote(note)]);
  assert.equal(found.meta.quizId, quizId(quizEn));
  assert.deepEqual(found.quiz.questions.map((item) => [item.correct_option_id, item.explanation]), english.map((item) => [item.correct_option_id, item.explanation]));
  const ticked = [quizNote(tick(note, [['q2', 'a']])), { id: 101, author: { id: AUTHOR }, body: 'answers: 1B 3c' }];
  assert.deepEqual([...findSubmission({ notes: ticked, current: current(ticked), authorId: AUTHOR }).selections], [['q1', 'b'], ['q3', 'c']]);
});

test('a Chinese quiz note still reads, with its answer key, after the setting changed to English', () => {
  // The quiz was posted while the setting was zh; this round runs in English.
  const notes = [quizNote(tick(body, [['q1', 'b']])), { id: 101, author: { id: AUTHOR }, body: 'answers: Q2 A, Q3 B' }];
  const found = current(notes);
  assert.equal(found.meta.quizId, quizId(quiz));
  assert.deepEqual(found.quiz.questions.map((item) => item.correct_option_id), questions.map((item) => item.correct_option_id));
  assert.equal(found.quiz.questions[0].explanation, '后保存的会覆盖先保存的，不做合并。');
  const submission = findSubmission({ notes, current: found, authorId: AUTHOR });
  const record = renderRecordNote(summarizeSubmission(found.quiz, submission), { author: 'dev', source: submission.source, lang: 'en' });
  assert.match(record, /^\*\*Quiz answers\*\*: @dev answered 2 of 3 in a comment\./);
  // An English answer key heading reads the same way, in either case.
  const mixed = body.replace(/答案：([A-E])/g, 'answer: $1');
  assert.deepEqual(readQuiz(mixed).questions.map((item) => item.correct_option_id), questions.map((item) => item.correct_option_id));
  assert.deepEqual(readQuiz(body.replace(/答案：([A-E])/g, 'Correct answer: $1')).questions.map((item) => item.correct_option_id), questions.map((item) => item.correct_option_id));
});

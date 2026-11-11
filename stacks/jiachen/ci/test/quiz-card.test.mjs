import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_OPTION_CHARS, MAX_OPTIONS, MAX_QUESTIONS, MAX_STEM_CHARS, MAX_STEM_WORDS, normalizeQuiz } from '../core/quiz.mjs';
import { authorEmails, CARD_EXPLANATION_CHARS, parseEmailAliases, quizCard, renderCard } from '../core/quiz-card.mjs';
import { CARD_REJECTED, deliverFirstAccepted } from '../core/feishu.mjs';
import { readQuiz, renderQuizNote } from '../core/quiz-note.mjs';

const { questions } = normalizeQuiz({
  questions: [
    { dimension: 'boundary', prompt: '两个窗口同时改同一个会话的标题，最后留下哪个？', options: ['先改的那个窗口的标题', '后保存的那个窗口的标题', '两个标题都留下，变成两条'], answer_index: 1, explanation: '后保存的会覆盖先保存的，不做合并。', evidence: [{ path: 'internal/session/title.go', line: 40 }] },
    { dimension: 'design-intent', prompt: '为什么这次把重试放到调用方，而不是下载函数里？', options: ['调用方知道请求能不能重复发', '下载函数里放不下更多代码', '这样出错时日志会少一些'], answer_index: 0, explanation: '只有调用方知道这次请求能不能重复发。', evidence: [] },
    { dimension: 'failure-mode', prompt: '下载到一半网络断了，用户再点一次下载会怎样？', options: ['从头重新下载整个文件', '接着上次的进度继续下载', '提示文件已存在，不再下载'], answer_index: 1, explanation: '下载会从上次断开的位置接着下。', evidence: [] },
  ],
}, { count: 3, lang: 'zh' });
const quiz = { questions };
const panels = (card) => card.body.elements.filter((element) => element.tag === 'collapsible_panel');

test('cards are JSON 2.0, can be updated in place, and say how to use them', () => {
  const card = renderCard(quizCard({ iid: 42, url: 'https://g/mr/42#note_100', quiz, summary: null }), 'zh');
  assert.equal(card.schema, '2.0');
  assert.equal(card.config.update_multi, true);
  assert.equal(card.header.title.content, 'PR !42 作者答题');
  assert.equal(card.header.subtitle.content, 'PR 作者在 PR 里勾选作答。其他人可以先自己想，再点开看答案。');
  assert.equal(card.body.elements[0].content, '作者还没有作答。');
  assert.match(card.body.elements[1].content, /^\*\*Q1\. 两个窗口同时改同一个会话的标题，最后留下哪个？\*\*\nA\. .+\nB\. .+\nC\. .+$/);
  assert.equal(card.body.elements.at(-1).text.content, '去 PR 答题');
  assert.equal(card.body.elements.at(-1).behaviors[0].default_url, 'https://g/mr/42#note_100');
  assert.equal(renderCard(quizCard({ iid: 1, url: 'u', quiz, summary: { answeredCount: 2 } }), 'zh').body.elements[0].content, '作者已答 2/3 题。');
});

test('each question has one collapsed panel with the correct option and the explanation', () => {
  const card = renderCard(quizCard({ iid: 8123, url: 'u', quiz, summary: null }), 'zh');
  assert.equal(panels(card).length, questions.length);
  panels(card).forEach((panel, index) => {
    const question = questions[index];
    const correct = question.options.findIndex((option) => option.id === question.correct_option_id);
    assert.equal(panel.expanded, false);
    assert.equal(panel.header.title.content, '看答案');
    assert.equal(panel.elements[0].content, '答案：' + String.fromCharCode(65 + correct) + '. ' + question.options[correct].text + '\n' + question.explanation);
    assert.equal(card.body.elements.indexOf(panel), 2 + index * 2, 'the panel sits right under its question');
  });
});

test('a card rebuilt from the quiz note, as a later update does, still has the answers', () => {
  const reread = readQuiz(renderQuizNote(quiz, { scope: {} }));
  assert.deepEqual(reread.questions.map((item) => [item.correct_option_id, item.explanation]), questions.map((item) => [item.correct_option_id, item.explanation]));
  assert.deepEqual(panels(renderCard(quizCard({ iid: 1, url: 'u', quiz: reread, summary: null }))), panels(renderCard(quizCard({ iid: 1, url: 'u', quiz, summary: null }))));
  const withoutKey = { questions: questions.map(({ correct_option_id, explanation, ...rest }) => rest) };
  assert.equal(panels(renderCard(quizCard({ iid: 1, url: 'u', quiz: withoutKey, summary: null }))).length, 0, 'no key, no panel');
});

test('ten questions at the longest stem, options and explanation stay under the 30 KB card limit', () => {
  const longest = (count) => '长'.repeat(count);
  const big = { questions: Array.from({ length: MAX_QUESTIONS }, (_, index) => ({
    id: 'q' + (index + 1),
    prompt: longest(MAX_STEM_CHARS),
    options: Array.from({ length: MAX_OPTIONS }, (__, optionIndex) => ({ id: 'abcde'[optionIndex], text: longest(MAX_OPTION_CHARS) })),
    correct_option_id: 'e',
    explanation: longest(800),
  })) };
  const card = renderCard(quizCard({ iid: 99999, url: 'https://gitlab.example.com/acme/app/-/merge_requests/99999#note_9999999', quiz: big, summary: { answeredCount: 10 } }));
  const content = JSON.stringify(card);
  const request = JSON.stringify({ content });
  assert.ok(Buffer.byteLength(content) < 30 * 1024, Buffer.byteLength(content) + ' bytes');
  assert.ok(Buffer.byteLength(request) < 30 * 1024, Buffer.byteLength(request) + ' bytes in the request body');
  assert.equal([...panels(card)[0].elements[0].content.split('\n')[1]].length, CARD_EXPLANATION_CHARS, 'a long explanation is cut, ending in …');
  assert.ok(panels(card)[0].elements[0].content.endsWith('…'));
});

test('the card @ mentions the PR author when an email is known, and reads as before without one', () => {
  const card = renderCard(quizCard({ iid: 1, url: 'u', quiz, summary: null, mention: 'carol@example.com' }), 'zh');
  assert.equal(card.body.elements[0].content, '<at email=carol@example.com></at> 请到 PR 里勾选作答。');
  const answered = renderCard(quizCard({ iid: 1, url: 'u', quiz, summary: { answeredCount: 2 }, mention: 'carol@example.com' }), 'zh');
  assert.equal(answered.body.elements[0].content, '<at email=carol@example.com></at> 已答 2/3 题。');
  assert.equal(renderCard(quizCard({ iid: 1, url: 'u', quiz, summary: null }), 'zh').body.elements[0].content, '作者还没有作答。');
  // English, the default.
  assert.equal(renderCard(quizCard({ iid: 1, url: 'u', quiz, summary: null, mention: 'carol@example.com' })).body.elements[0].content, '<at email=carol@example.com></at> Please answer in the PR.');
  assert.equal(renderCard(quizCard({ iid: 1, url: 'u', quiz, summary: { answeredCount: 2 }, mention: 'carol@example.com' })).body.elements[0].content, '<at email=carol@example.com></at> Answered 2 of 3.');
});

test('the author email candidates: commit emails with the GitLab username first, then commits under that name, then the username at each domain', () => {
  const domains = ['example.com', 'other.io'];
  const commit = (author_name, author_email) => ({ author_name, author_email });
  assert.deepEqual(authorEmails({ username: 'Alice', commits: [commit('x', 'mac@MacBook-Pro.local'), commit('y', 'someone-else@example.com'), commit('z', 'Alice@Example.com')], domains: ['example.com'] }), ['alice@example.com'], 'the guess repeats the commit email, once is enough');
  assert.deepEqual(authorEmails({ username: 'Judy', commits: [], domains: ['example.com'] }), ['judy@example.com']);
  // The commit email of this author is not the one Feishu knows, so the guess has to stay behind it.
  assert.deepEqual(authorEmails({ username: 'bob', commits: [commit('bob', 'robert@example.com')], domains: ['example.com'] }), ['robert@example.com', 'bob@example.com']);
  assert.deepEqual(authorEmails({ username: 'Ivan', commits: [commit('Ivan', 'ivan@other.io'), commit('Ivan', 'ivan.p@example.com')], domains }), ['ivan@other.io', 'ivan.p@example.com', 'ivan@example.com'], 'every allowed domain counts, in the order of the commits');
  assert.deepEqual(authorEmails({ username: 'Frank', commits: [commit('Frank', 'Frank@typo.example')], domains: ['example.com'] }), ['frank@example.com'], 'a domain outside the list is never tried');
});

test('a commit by someone else in the PR is never taken for the author', () => {
  const commits = [{ author_name: 'grace', author_email: 'grace@example.com' }, { author_name: 'grace', author_email: 'grace@example.com' }];
  assert.deepEqual(authorEmails({ username: 'Ivan', commits, domains: ['example.com'] }), ['ivan@example.com']);
});

test('without domains nobody is mentioned, and an email that is not plain never reaches the card', () => {
  assert.deepEqual(authorEmails({ username: 'Alice', commits: [{ author_email: 'alice@example.com' }], domains: [] }), []);
  assert.deepEqual(authorEmails({ username: 'x', commits: [{ author_email: 'x@example.com></at><at id=all' }], domains: ['example.com'] }), ['x@example.com']);
  assert.deepEqual(authorEmails({ username: 'x></at>', commits: [], domains: ['example.com'] }), []);
});

test('a project or group bot has no person behind its name: its PR uses the commit email when one person made all the commits', () => {
  const one = [{ author_name: 'oscar', author_email: 'oscar@example.com' }, { author_name: 'oscar', author_email: 'oscar@example.com' }, { author_name: 'ci', author_email: 'ci@elsewhere.dev' }];
  // GitLab names project bots project_<id>_bot_<suffix> and group bots the same
  // way with "group"; the group one is put together here from those parts.
  const groupBot = 'group_2_bot_def456';
  assert.deepEqual(authorEmails({ username: 'project_1_bot_abc123', commits: one, domains: ['example.com'] }), ['oscar@example.com']);
  assert.deepEqual(authorEmails({ username: groupBot, commits: one, domains: ['example.com'] }), ['oscar@example.com']);
  const two = [...one, { author_name: 'erin', author_email: 'erin@example.com' }];
  assert.deepEqual(authorEmails({ username: 'project_1_bot_abc123', commits: two, domains: ['example.com'] }), [], 'a sync of several people has no one to ask');
  assert.deepEqual(authorEmails({ username: 'project_1_bot_abc123', commits: [], domains: ['example.com'] }), []);
});

test('the alias table comes first and needs no allowed domain: some contact emails cannot be worked out from commits or usernames', () => {
  const aliases = parseEmailAliases('carol=real.name@example.com, Dave = other@elsewhere.dev');
  const domains = ['example.com'];
  const commits = [{ author_name: 'carol', author_email: 'carol@example.com' }];
  assert.deepEqual(authorEmails({ username: 'carol', commits, domains, aliases }), ['real.name@example.com', 'carol@example.com'], 'the other candidates stay behind it, in case the table is out of date');
  assert.deepEqual(authorEmails({ username: 'dave', commits: [], domains, aliases }), ['other@elsewhere.dev', 'dave@example.com']);
  assert.deepEqual(authorEmails({ username: 'DAVE', commits: [], domains, aliases }), ['other@elsewhere.dev', 'dave@example.com'], 'GitLab usernames ignore case');
  assert.deepEqual(authorEmails({ username: 'erin', commits: [], domains, aliases }), ['erin@example.com']);
  assert.deepEqual(authorEmails({ username: 'erin', commits: [], domains }), ['erin@example.com'], 'the table is optional');
  assert.deepEqual(authorEmails({ username: 'carol', commits: [{ author_email: 'real.name@example.com' }], domains, aliases }), ['real.name@example.com', 'carol@example.com'], 'an email is tried once');
  assert.deepEqual(authorEmails({ username: 'carol', commits, domains: [], aliases }), [], 'without domains nobody is mentioned');
  const bot = parseEmailAliases('project_1_bot_abc=owner@example.com');
  assert.deepEqual(authorEmails({ username: 'project_1_bot_abc', commits: [], domains, aliases: bot }), ['owner@example.com'], 'a bot can be listed too');
});

test('an alias entry that is not a plain email is dropped', () => {
  assert.deepEqual([...parseEmailAliases('a=a@example.com,b=b@example.com></at><at id=all,c,=d@example.com,,e=,f=g@example.com=h')], [['a', 'a@example.com']]);
  assert.equal(parseEmailAliases('').size, 0);
  assert.equal(parseEmailAliases(undefined).size, 0);
  assert.deepEqual(authorEmails({ username: 'constructor', commits: [], domains: ['example.com'], aliases: parseEmailAliases('') }), ['constructor@example.com'], 'a username is only a key');
});

test('Feishu rejects a card for an email it does not know: the next card goes out, the last one has no mention', async () => {
  const rejected = (error) => Object.assign(new Error(error), { code: CARD_REJECTED });
  const sent = [];
  const known = async (card) => {
    sent.push(card);
    if (card === 'robert' || card === 'nobody') throw rejected('invalid user resource');
    return 'om_' + card;
  };
  assert.deepEqual(await deliverFirstAccepted(known, ['robert', 'bob', 'plain']), { result: 'om_bob', index: 1 });
  assert.deepEqual(sent, ['robert', 'bob'], 'nothing is tried after the first card Feishu accepts');
  assert.deepEqual(await deliverFirstAccepted(known, ['nobody', 'plain']), { result: 'om_plain', index: 1 });
  assert.deepEqual(await deliverFirstAccepted(known, ['plain']), { result: 'om_plain', index: 0 });
  await assert.rejects(deliverFirstAccepted(async () => { throw rejected('bad card'); }, ['a', 'plain']), /bad card/, 'the last card has nothing behind it');
  let calls = 0;
  await assert.rejects(deliverFirstAccepted(async () => { calls += 1; throw Object.assign(new Error('rate limited'), { code: 99991400 }); }, ['a', 'plain']), /rate limited/);
  assert.equal(calls, 1, 'another error is not retried');
});

test('the card in English: same layout, English labels, and it stays under the size limit', () => {
  const { questions: english } = normalizeQuiz({
    questions: [
      { dimension: 'boundary', prompt: 'Two windows rename the same session at once. Which title stays?', options: ['The one renamed first', 'The one saved last', 'Both, as two sessions'], answer_index: 1, explanation: 'The later save overwrites the earlier one; nothing is merged.', evidence: [] },
      { dimension: 'design-intent', prompt: 'Why does the caller retry now, not the download function?', options: ['Only the caller knows a retry is safe', 'The download function has no room left', 'It writes fewer log lines'], answer_index: 0, explanation: 'Only the caller knows whether the request can be sent twice.', evidence: [] },
      { dimension: 'failure-mode', prompt: 'The network drops halfway through a download. The user clicks again. What happens?', options: ['The whole file downloads again', 'It resumes where it stopped', 'It says the file already exists'], answer_index: 1, explanation: 'The download resumes from where it stopped.', evidence: [] },
    ],
  }, { count: 3 });
  const card = renderCard(quizCard({ iid: 42, url: 'https://g/mr/42#note_100', quiz: { questions: english }, summary: null }));
  assert.equal(card.header.title.content, 'PR !42 author quiz');
  assert.equal(card.header.subtitle.content, 'The PR author answers in the PR. Everyone else can think it through first, then open the answers.');
  assert.equal(card.body.elements[0].content, 'The author has not answered yet.');
  assert.match(card.body.elements[1].content, /^\*\*Q1\. Two windows rename the same session at once\. Which title stays\?\*\*\nA\. .+\nB\. .+\nC\. .+$/);
  assert.equal(panels(card)[0].header.title.content, 'Show answer');
  assert.match(panels(card)[0].elements[0].content, /^Answer: [A-C]\. The one saved last\nThe later save overwrites/);
  assert.equal(card.body.elements.at(-1).text.content, 'Answer in the PR');
  assert.equal(renderCard(quizCard({ iid: 1, url: 'u', quiz: { questions: english }, summary: { answeredCount: 2 } })).body.elements[0].content, 'The author answered 2 of 3.');
  // The longest English text the quiz keeps: the note cuts a stem to 400 and an
  // option to 240 characters, the card an explanation to CARD_EXPLANATION_CHARS.
  const words = (count, size) => Array.from({ length: count }, () => 'w'.repeat(size)).join(' ');
  assert.ok(words(MAX_STEM_WORDS, 8).length >= 400);
  const big = { questions: Array.from({ length: MAX_QUESTIONS }, (_, index) => ({
    id: 'q' + (index + 1),
    prompt: words(MAX_STEM_WORDS, 8).slice(0, 400),
    options: Array.from({ length: MAX_OPTIONS }, (__, optionIndex) => ({ id: 'abcde'[optionIndex], text: words(20, 12).slice(0, 240) })),
    correct_option_id: 'e',
    explanation: words(200, 8),
  })) };
  const content = JSON.stringify(renderCard(quizCard({ iid: 99999, url: 'https://gitlab.example.com/acme/app/-/merge_requests/99999#note_9999999', quiz: big, summary: { answeredCount: 10 } })));
  assert.ok(Buffer.byteLength(JSON.stringify({ content })) < 30 * 1024, Buffer.byteLength(JSON.stringify({ content })) + ' bytes in the request body');
});

test('the card names the PR the way its host does', () => {
  assert.equal(renderCard(quizCard({ iid: 42, ref: '#42', url: 'u', quiz, summary: null })).header.title.content, 'PR #42 author quiz');
  assert.equal(renderCard(quizCard({ iid: 42, url: 'u', quiz, summary: null }), 'zh').header.title.content, 'PR !42 作者答题', 'GitLab when no ref is given');
});

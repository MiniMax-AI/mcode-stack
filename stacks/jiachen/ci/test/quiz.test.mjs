import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { codeTokens, decideQuiz, MAX_OPENING_CLAUSE_WORDS, MAX_OPTION_CHARS, MAX_OPTION_CODE_TOKENS, MAX_OPTION_WORDS, MAX_STEM_CHARS, MAX_STEM_CODE_TOKENS, MAX_STEM_WORDS, normalizeQuiz, plainLanguageProblems, quizConfig, quizScope, revealsAnswerByLength, rewriteRequest, shouldRegenerate } from '../core/quiz.mjs';
import { mergeProfiles } from '../core/triage.mjs';
import { readJson } from '../core/util.mjs';

const repo = (name) => mergeProfiles(readJson(new URL('../config/repos/default.json', import.meta.url)), name === 'default' ? {} : readJson(new URL('../config/repos/' + name + '.json', import.meta.url)));
const file = (path, additions, deletions = 0, extra = {}) => ({ path, additions, deletions, status: 'M', mechanical: false, ...extra });
const scopeOf = (name, files, sourceBranch = 'feat/x') => quizScope({ files, profile: repo(name), sourceBranch });

test('product code leaves out docs, tests and generated files, for Go as well as TypeScript', () => {
  const go = scopeOf('example', [
    file('internal/im/forward.go', 60, 20),
    file('internal/im/forward_test.go', 300),
    file('internal/im/testdata/case.json', 50),
    file('idl/gen/api.pb.go', 900),
    file('internal/mocks/store.go', 40),
    file('internal/im/mock_client.go', 40),
    file('internal/model/zz_generated.deepcopy.go', 80),
    file('internal/model/types_gen.go', 30),
    file('vendor/github.com/x/y.go', 500),
    file('go.sum', 20, 0, { mechanical: true }),
    file('docs/im.md', 30),
  ]);
  assert.equal(go.code_files, 1);
  assert.equal(go.code_lines, 80);
  assert.deepEqual(go.files, ['internal/im/forward.go']);
  const ts = scopeOf('example', [
    file('packages/ui/src/panel.tsx', 10),
    file('packages/ui/src/panel.test.tsx', 200),
    file('packages/ui/src/__snapshots__/panel.snap', 40),
    file('packages/api-client/generated/service.ts', 400),
    file('packages/ui/src/bindings.gen.ts', 30),
    file('e2e/specs/login.json', 30),
    file('changelogs/1.2.0.md', 10),
  ]);
  assert.equal(ts.code_files, 1);
  assert.equal(ts.code_lines, 10);
});

test('which PRs get a quiz: size, risk path, docs only, disabled repository, skipped branch', () => {
  const four = ['a', 'b', 'c', 'd'].map((name) => file('internal/' + name + '.go', 5));
  const cases = [
    ['example', [file('internal/a.go', 100, 20)], 'feat/x', true, 'size'],
    ['example', four, 'feat/x', true, 'size'],
    ['example', [file('internal/a.go', 60), file('internal/a_test.go', 400), file('api/x.pb.go', 900)], 'feat/x', false, 'small'],
    ['example', [file('packages/session-auth/src/token.ts', 6, 2)], 'feat/x', true, 'risk'],
    ['example', [file('README.md', 500), file('docs/guide.md', 300), file('ci/README.md', 20)], 'feat/x', false, 'no-product-code'],
    ['example', [file('internal/handler/a.go', 500)], 'feat/x', true, 'size'],
    ['example', [file('internal/handler/a.go', 500)], 'dev', false, 'skipped-branch'],
    ['example', [file('internal/service/a.go', 500)], 'main', false, 'skipped-branch'],
    ['default', [file('src/a.ts', 500)], 'feat/x', false, 'disabled'],
    ['example', [file('packages/app/src/a.ts', 500)], 'chore/sync-main-into-dev-0911', false, 'skipped-branch'],
    ['example', [file('packages/app/src/a.ts', 500)], 'release/1.4', false, 'skipped-branch'],
    ['example', [file('packages/app/src/a.ts', 500)], 'feature/release/notes', true, 'size'],
    ['example', [file('packages/app/src/a.ts', 500)], 'hotfix/session-leak', true, 'size'],
  ];
  for (const [name, files, branch, needed, reason] of cases) {
    const scope = scopeOf(name, files, branch);
    assert.equal(scope.needed, needed, name + ' ' + branch + ' ' + files.map((item) => item.path).join(','));
    assert.equal(scope.reason, reason, name + ' ' + branch);
  }
  assert.equal(scopeOf('example', [file('internal/a.go', 100, 20)]).why, '120 lines of product code changed in 1 file');
  assert.equal(scopeOf('example', [file('packages/session-auth/src/token.ts', 6, 2)]).why, 'it changes these risk paths: Permissions and authentication');
  // The default rule pack names its risk areas in both languages.
  const withQuiz = mergeProfiles(repo('default'), { quiz: { enabled: true } });
  const scopeIn = (lang, files) => quizScope({ files, profile: withQuiz, sourceBranch: 'feat/x', lang });
  assert.equal(scopeIn('zh', [file('internal/a.go', 100, 20)]).why, '产品代码改了 120 行、1 个文件');
  assert.equal(scopeIn('zh', [file('src/auth/token.ts', 6, 2)]).why, '改了风险路径：权限和认证');
  assert.equal(scopeIn('en', [file('src/auth/token.ts', 6, 2)]).why, 'it changes these risk paths: Permissions and authentication');
  assert.deepEqual(scopeIn('zh', [file('src/auth/token.ts', 6, 2)]).risk, ['权限和认证']);
});

test('quiz settings fall back to the defaults and stay inside their bounds', () => {
  const config = quizConfig({ quiz: { enabled: true, questions: 40, min_code_lines: 'x', skip_source_branches: ['^ok/', '('] } });
  assert.equal(config.questions, 10);
  assert.equal(config.min_code_lines, 120);
  assert.equal(config.max_per_mr, 3);
  assert.deepEqual(config.skip_source_branches.map(String), ['/^ok\\//']);
  assert.equal(quizConfig({ quiz: { questions: 1 } }).questions, 3);
  assert.equal(quizConfig({}).enabled, false);
  assert.equal(quizConfig(repo('example')).questions, 4);
});

// The Bad and Good example of ci/prompts/quiz.zh.md and the Chinese section of
// the pr-quiz skill.
const BAD_STEM = '手机端 NoteEditor 通过 syncQueue.flush 提交用户离线时写下的草稿，SyncWorker 已经启动但当前笔记本的 lastSyncedAt 字段还没写入，此时编辑器顶部呈现回执怎样？';
const GOOD_STEM = '离线时写的草稿要同步上去，但这个笔记本还从没同步过。用户这时会看到什么？';
const GOOD_OPTIONS = ['先显示草稿，同步完再更新', '先不显示，等同步完再显示', '提示同步失败，让用户重试'];

test('the bad example question is rejected and its plain rewrite is accepted', () => {
  assert.deepEqual(codeTokens(BAD_STEM), ['syncQueue.flush', 'NoteEditor', 'SyncWorker', 'lastSyncedAt']);
  const problems = plainLanguageProblems({ prompt: BAD_STEM, options: GOOD_OPTIONS }, 'zh');
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /4 code names/);
  assert.match(problems.join('\n'), /104 characters/);
  assert.match(problems.join('\n'), /此时/);
  assert.deepEqual(codeTokens(GOOD_STEM), []);
  assert.deepEqual(plainLanguageProblems({ prompt: GOOD_STEM, options: GOOD_OPTIONS }, 'zh'), []);
  const raw = (prompt) => ({ dimension: 'failure-mode', prompt, options: GOOD_OPTIONS, answer_index: 0, explanation: '草稿先显示出来，同步完成后再换成服务器上的版本。', evidence: [] });
  const { questions, rejected } = normalizeQuiz({ questions: [raw(BAD_STEM), raw(GOOD_STEM)] }, { lang: 'zh' });
  assert.deepEqual(questions.map((question) => question.prompt), [GOOD_STEM]);
  assert.equal(rejected[0].index, 0);
});

test('an option states only the result; reasons, 此时 and 当……时 openings are rejected', () => {
  const option = '回退为本地 draftCache 呈现，因为它的 isDirty 初始为 true';
  assert.match(plainLanguageProblems({ prompt: GOOD_STEM, options: [option, '先显示空白', '直接报错'] }, 'zh').join(), /gives a reason \(因为\)/);
  for (const word of ['由于', '所以', '从而', '导致']) assert.equal(plainLanguageProblems({ prompt: GOOD_STEM, options: ['重试一次' + word + '变慢', '直接报错', '先显示空白'] }, 'zh').length, 1, word);
  assert.match(plainLanguageProblems({ prompt: '当用户关掉窗口时，没发完的消息会怎样？' }, 'zh').join(), /当……时/);
  assert.match(plainLanguageProblems({ prompt: '下载失败了，此时页面会怎样？' }, 'zh').join(), /此时/);
  assert.deepEqual(plainLanguageProblems({ prompt: '当前会话下载失败了，页面会显示什么？' }, 'zh'), [], '当前 is not an opening');
  assert.deepEqual(plainLanguageProblems({ prompt: '用户关掉窗口，这时没发完的消息会怎样？' }, 'zh'), []);
});

test('code names are counted the way a reader sees them', () => {
  assert.deepEqual(codeTokens('调用 \x60retry()\x60 后 src/a/b.ts 和 user_id 会怎样'), ['\x60retry()\x60', 'src/a/b.ts', 'user_id']);
  assert.deepEqual(codeTokens('GitLab 的 PR 合入后 OAuth 令牌和 API 会怎样？'), []);
  assert.deepEqual(codeTokens('Node.js 升级后 iOS 用户、A/B 测试和 TCP/IP 会怎样'), []);
  assert.deepEqual(codeTokens('HTTPClient 和 refresh() 和 config.yaml'), ['config.yaml', 'HTTPClient', 'refresh()']);
  assert.equal(plainLanguageProblems({ prompt: GOOD_STEM, options: ['x'.repeat(MAX_OPTION_CHARS + 1), '先显示空白', '直接报错'] }, 'zh').length, 1);
  assert.equal(plainLanguageProblems({ prompt: '页'.repeat(MAX_STEM_CHARS + 1) }, 'zh').length, 1);
  assert.equal(MAX_STEM_CODE_TOKENS, 2);
  assert.equal(MAX_OPTION_CODE_TOKENS, 1);
});

const question = (dimension, prompt, options, answer = 0) => ({ dimension, prompt, options, answer_index: answer, explanation: '只有调用方知道这次请求能不能重复发。', evidence: [{ path: './internal/a.go', line: 12 }] });
const PLAIN = [
  question('boundary', '两个窗口同时改同一个会话的标题，最后留下哪个？', ['先改的那个窗口的标题', '后保存的那个窗口的标题', '两个标题都留下，变成两条'], 1),
  question('impact-surface', '这次改了会话列表的排序，哪些地方会跟着变？', ['侧栏和搜索结果都会变', '只有侧栏的顺序会变', '只有搜索结果的顺序会变']),
  question('boundary', '会话标题是空的，侧栏里会显示什么？', ['显示“未命名会话”', '显示会话的创建时间', '这一行直接不显示']),
  question('design-intent', '为什么这次把重试放到调用方，而不是下载函数里？', ['调用方知道请求能不能重复发', '下载函数里放不下更多代码', '这样出错时日志会少一些']),
  question('failure-mode', '下载到一半网络断了，用户再点一次下载会怎样？', ['从头重新下载整个文件', '接着上次的进度继续下载', '提示文件已存在，不再下载'], 1),
];

test('normalization keeps the contract: ids, letters, shuffled options, at least half on intent or failure', () => {
  const { questions, rejected, stats } = normalizeQuiz({ questions: PLAIN }, { count: 4, lang: 'zh' });
  assert.deepEqual(rejected, []);
  assert.deepEqual(stats, { written: 5, accepted: 5, kept: 4, dropped: 0, core: 2 });
  // Four of five: both core questions stay, then the others in the model's order.
  assert.deepEqual(questions.map((item) => item.dimension), ['boundary', 'impact-surface', 'design-intent', 'failure-mode']);
  assert.deepEqual(questions.map((item) => item.id), ['q1', 'q2', 'q3', 'q4']);
  for (const [index, item] of questions.entries()) {
    const source = PLAIN[[0, 1, 3, 4][index]];
    assert.deepEqual(item.options.map((option) => option.id), ['a', 'b', 'c']);
    assert.deepEqual(item.options.map((option) => option.text).sort(), [...source.options].sort());
    assert.equal(item.options.find((option) => option.id === item.correct_option_id).text, source.options[source.answer_index]);
  }
  assert.deepEqual(normalizeQuiz({ questions: PLAIN }, { count: 4, lang: 'zh' }).questions, questions, 'the same answer gives the same quiz');
  assert.ok(questions.some((item) => item.correct_option_id !== 'a'), 'the correct option is not always first');
  assert.deepEqual(questions[0].evidence, [{ path: 'internal/a.go', line: 12 }]);
});

test('broken questions are dropped with their reasons, and fewer than three usable ones ask for a rewrite', () => {
  const lettered = { ...PLAIN[1], options: ['A. 侧栏和搜索结果都会变', 'B. 只有侧栏的顺序会变', 'C. 只有搜索结果的顺序会变'] };
  const broken = [
    { ...PLAIN[0], dimension: 'trivia' },
    { ...PLAIN[3], options: ['只有一个选项', '两个'] },
    { ...PLAIN[4], answer_index: 7 },
    { ...PLAIN[2], explanation: '' },
    { ...PLAIN[3], prompt: '这次改动改了哪个文件的超时配置？' },
    lettered,
  ];
  const result = normalizeQuiz({ questions: broken }, { count: 4, lang: 'zh' });
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].options.some((option) => /^[A-C]\./.test(option.text)), false, 'letters the model wrote are removed');
  assert.deepEqual(result.rejected.map((item) => item.index), [0, 1, 2, 3, 4]);
  assert.match(result.rejected[4].reasons.join(), /recall a name/);
  // The rewrite request is in the quiz's language; the reasons are in English for the model.
  const request = rewriteRequest(result, { ask: 5, lang: 'zh' });
  assert.match(request, /^你上一条回复里有些题目不能用：\n- 第 1 题（"两个窗口同时改同一个会话的标题，最后留下哪个？"）：dimension is not one of/);
  assert.match(request, /现在只剩 1 道能用的题，至少需要 3 道。请重新出 5 道题/);
  assert.match(request, /简体中文的通俗表达规则/);
  assert.match(request, /只回复符合输出 schema 的 JSON 对象/);
  const english = rewriteRequest(result, { ask: 5 });
  assert.match(english, /^Some questions in your previous reply cannot be used:\n- Question 1 \("两个窗口同时改同一个会话的标题，最后留下哪个？"\): dimension is not one of/);
  assert.match(english, /Only 1 usable question is left, and the quiz needs at least 3\. Write the quiz again with 5 questions/);
  assert.match(english, /Follow the plain-language rules for English in the pr-quiz skill/);
  assert.match(english, /Reply with only the JSON object/);
  assert.match(rewriteRequest({ questions: [], rejected: [] }, { ask: 5 }), /Only 0 usable questions are left/);
});

test('a question whose answer is clearly the longest option goes last, after the intent and failure quota', () => {
  const tell = question('design-intent', '为什么重试放在调用方？', ['短', '因为调用方知道这次请求能不能安全地重复发送', '也短']);
  assert.equal(revealsAnswerByLength({ ...tell, answer_index: 1 }), true);
  assert.equal(revealsAnswerByLength(PLAIN[0]), false);
  const longest = question('boundary', '下载到一半网络断了，再点一次会怎样？', ['重下', '接着上次的进度继续下载', '报错'], 1);
  const { questions } = normalizeQuiz({ questions: [longest, PLAIN[0], PLAIN[1], PLAIN[3], PLAIN[4]] }, { count: 4, lang: 'zh' });
  assert.equal(questions.length, 4);
  assert.equal(questions.some((item) => item.prompt === longest.prompt), false);
});

const meta = { quizId: 'abc', codeLines: 400, codeFileCount: 6, filesHash: 'h1', fileKeys: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'] };
const scopeWith = (lines, keys, extra = {}) => ({ needed: true, reason: 'size', code_lines: lines, code_files: keys.length, files_hash: 'h1', file_keys: keys, ...extra });
const enabled = quizConfig({ quiz: { enabled: true } });

test('a later push asks again only after a big change, before anyone answered, and at most three times', () => {
  const keys = meta.fileKeys;
  const decide = (scope, extra = {}) => decideQuiz({ scope, config: enabled, legacy: false, current: { meta }, answered: false, quizzes: 1, ...extra });
  assert.equal(decide(scopeWith(430, keys)).why, 'kept');
  assert.equal(decide(scopeWith(550, keys)).why, 'regenerate-lines');
  assert.equal(decide(scopeWith(400, [...keys.slice(0, 4), 'n1'])).why, 'regenerate-files', 'two removed and one added is three');
  assert.equal(decide(scopeWith(400, [...keys.slice(0, 5), 'n1'])).why, 'kept');
  assert.equal(decide(scopeWith(900, keys), { answered: true }).why, 'answered');
  assert.equal(decide(scopeWith(900, keys), { quizzes: 3 }).why, 'cap');
  assert.equal(decideQuiz({ scope: scopeWith(400, keys), config: enabled, current: null, quizzes: 0 }).why, 'first');
  assert.equal(decideQuiz({ scope: scopeWith(400, keys), config: enabled, current: null, quizzes: 3 }).why, 'cap');
  assert.equal(decideQuiz({ scope: scopeWith(400, keys), config: enabled, legacy: true, current: null, quizzes: 0 }).why, 'legacy');
  assert.equal(decideQuiz({ scope: { ...scopeWith(400, keys), needed: false, reason: 'small' }, config: enabled, current: { meta }, quizzes: 1 }).why, 'small');
  assert.equal(decideQuiz({ scope: scopeWith(400, keys), config: quizConfig({}), current: null, quizzes: 0 }).why, 'disabled');
});

test('quiz notes without a file list compare file counts, as the earlier quiz job did', () => {
  const old = { quizId: 'abc', codeLines: 400, codeFileCount: 6, filesHash: 'h1' };
  assert.equal(shouldRegenerate({ meta: old, scope: { code_lines: 420, code_files: 9, files_hash: 'h2' }, config: enabled }).regenerate, true);
  assert.equal(shouldRegenerate({ meta: old, scope: { code_lines: 420, code_files: 6, files_hash: 'h2' }, config: enabled }).regenerate, false, 'renames alone do not ask again');
  assert.equal(shouldRegenerate({ meta: old, scope: { code_lines: 420, code_files: 9, files_hash: 'h1' }, config: enabled }).regenerate, false);
});

test('the prompt and the skill state the wording rules the checks enforce', () => {
  const prompt = readFileSync(new URL('../prompts/quiz.zh.md', import.meta.url), 'utf8');
  const skill = readFileSync(new URL('../../skills/pr-quiz/SKILL.md', import.meta.url), 'utf8');
  for (const text of [prompt, skill]) {
    for (const word of ['因为', '由于', '所以', '从而', '导致', '此时', '当……时', '在……时', '不是……而是……', '顿号', '呈现', '回执', '退化为', '回退为', BAD_STEM, GOOD_STEM]) assert.ok(text.includes(word), word);
  }
  assert.match(skill, new RegExp('longer than ' + MAX_STEM_CHARS + ' characters, has more than ' + MAX_STEM_CODE_TOKENS + ' code names'));
  assert.match(skill, new RegExp('longer than ' + MAX_OPTION_CHARS + ' characters, with more than ' + MAX_OPTION_CODE_TOKENS + ' code name'));
  for (const placeholder of ['{{ask}}', '{{count}}', '{{quota}}', '{{reason}}', '{{files}}']) assert.ok(prompt.includes(placeholder), placeholder);
});

// The Bad and Good example of ci/prompts/quiz.en.md and the English section of
// the pr-quiz skill.
const BAD_STEM_EN = 'When the mobile NoteEditor flushes the drafts that the user wrote while offline through syncQueue.flush, and the SyncWorker has already started but the lastSyncedAt field of the current notebook has not been written yet, what does the header at the top of the editor render at this point?';
const BAD_OPTION_EN = 'Falls back to rendering the local draftCache because its isDirty flag starts as true';
const GOOD_STEM_EN = 'A draft written offline needs to sync, but this notebook has never synced. What does the user see?';
const GOOD_OPTIONS_EN = ['The draft, updated after the sync', 'Nothing until the sync finishes', 'A sync error and a retry button'];
const REASON_WORDS_EN = ['because', 'since', 'due to', 'so that', 'therefore', 'which causes', 'leading to', 'as a result'];
const wordsOf = (count) => Array.from({ length: count }, (_, index) => 'word' + index).join(' ');

test('English: the bad example question is rejected for each of its problems and its plain rewrite is accepted', () => {
  const problems = plainLanguageProblems({ prompt: BAD_STEM_EN, options: [BAD_OPTION_EN, ...GOOD_OPTIONS_EN.slice(1)] }).join('\n');
  assert.match(problems, /the stem has 4 code names \(syncQueue\.flush, NoteEditor, SyncWorker, lastSyncedAt\)/);
  assert.match(problems, /the stem is 48 words, at most 45/);
  assert.match(problems, /the stem uses "at this point"/);
  assert.match(problems, /the stem opens with a 15-word "When \.\.\." clause, at most 8/);
  assert.match(problems, /option 1 has 2 code names \(draftCache, isDirty\)/);
  assert.match(problems, /option 1 gives a reason \(because\)/);
  assert.deepEqual(plainLanguageProblems({ prompt: GOOD_STEM_EN, options: GOOD_OPTIONS_EN }), []);
  const raw = (prompt) => ({ dimension: 'failure-mode', prompt, options: GOOD_OPTIONS_EN, answer_index: 0, explanation: 'The draft shows first and is replaced by the server copy after the sync.', evidence: [] });
  const { questions, rejected } = normalizeQuiz({ questions: [raw(BAD_STEM_EN), raw(GOOD_STEM_EN)] });
  assert.deepEqual(questions.map((question) => question.prompt), [GOOD_STEM_EN]);
  assert.equal(rejected[0].index, 0);
});

test('English: each plain-language rule rejects a bad example and keeps a good one', () => {
  const problems = (prompt, options = GOOD_OPTIONS_EN) => plainLanguageProblems({ prompt, options }, 'en').join('\n');
  const keeps = (prompt, options) => assert.equal(problems(prompt, options), '', prompt + ' | ' + options);
  // A stem over MAX_STEM_WORDS words.
  assert.match(problems(wordsOf(MAX_STEM_WORDS + 1) + '?'), new RegExp('the stem is ' + (MAX_STEM_WORDS + 1) + ' words, at most ' + MAX_STEM_WORDS));
  keeps(wordsOf(MAX_STEM_WORDS) + '?');
  // Code names in the stem: the limit and the counting are shared with Chinese.
  assert.match(problems('The user calls \x60retry()\x60 while user_id and SyncWorker are unset. What happens?'), /the stem has 3 code names/);
  keeps('The user calls \x60retry()\x60 on a closed session. What happens?');
  // "at this point", "at this moment".
  assert.match(problems('The upload failed. What does the page show at this point?'), /uses "at this point"/);
  assert.match(problems('The upload failed. What does the page show at this moment?'), /uses "at this moment"/);
  keeps('The upload failed. What does the page show now?');
  // A long opening "When/While/Once ..." clause; a short one is fine.
  assert.match(problems('When the user closes the window before the last message is sent, what happens to it?'), /opens with a 12-word "When \.\.\." clause/);
  assert.match(problems('While a sync from another device is still running in the background, the user edits the note. What happens?'), /"While \.\.\." clause/);
  assert.match(problems('Once the retry budget for the whole session has been used up completely, what does the user see?'), /"Once \.\.\." clause/);
  keeps('When the upload fails, what does the user see?');
  keeps('The user closes the window before the message is sent. What happens to it?');
  // An option over MAX_OPTION_WORDS words.
  assert.match(problems(GOOD_STEM_EN, [wordsOf(MAX_OPTION_WORDS + 1), 'Nothing changes', 'An error shows']), new RegExp('option 1 is ' + (MAX_OPTION_WORDS + 1) + ' words, at most ' + MAX_OPTION_WORDS));
  keeps(GOOD_STEM_EN, [wordsOf(MAX_OPTION_WORDS), 'Nothing changes', 'An error shows']);
  // Two or more code names in an option.
  assert.match(problems(GOOD_STEM_EN, ['It calls \x60flush()\x60 on syncQueue.flush', 'Nothing changes', 'An error shows']), /option 1 has 2 code names/);
  keeps(GOOD_STEM_EN, ['It calls \x60flush()\x60 once', 'Nothing changes', 'An error shows']);
  // An option that gives a reason.
  for (const word of REASON_WORDS_EN) assert.match(problems(GOOD_STEM_EN, ['It retries, ' + word + ' the cache is cold', 'Nothing changes', 'An error shows']), new RegExp('option 1 gives a reason \\(' + word + '\\)'), word);
  keeps(GOOD_STEM_EN, ['It retries once, then shows an error', 'Nothing changes', 'An error shows']);
  // Each language checks its own rules only.
  assert.deepEqual(plainLanguageProblems({ prompt: '下载失败了，此时页面会怎样？' }, 'en'), []);
  assert.deepEqual(plainLanguageProblems({ prompt: 'The upload failed. What does the page show at this point?' }, 'zh'), []);
  assert.equal(MAX_OPENING_CLAUSE_WORDS, 8);
});

test('English: memory questions are dropped, a question about behavior is kept', () => {
  const ask = (prompt) => ({ dimension: 'impact-surface', prompt, options: GOOD_OPTIONS_EN, answer_index: 0, explanation: 'Only the caller knows whether the request can be sent twice.', evidence: [] });
  const memory = ['Which file holds the new timeout setting?', 'Which function did this change rename?', 'Which method now checks the token?', 'Which variable keeps the retry count?', 'Which class owns the cache now?', 'Which line sets the default limit?', 'What is the new helper called?', 'What is it called in the settings code?'];
  const { questions, rejected } = normalizeQuiz({ questions: [...memory.map(ask), ask('Which users see the new banner first?')] });
  assert.deepEqual(rejected.map((item) => item.prompt), memory);
  for (const item of rejected) assert.match(item.reasons.join(), /recall a name or a place in the diff/);
  assert.deepEqual(questions.map((question) => question.prompt), ['Which users see the new banner first?']);
});

test('the English prompt and the English section of the skill state the rules the checks enforce', () => {
  const prompt = readFileSync(new URL('../prompts/quiz.en.md', import.meta.url), 'utf8');
  const zh = readFileSync(new URL('../prompts/quiz.zh.md', import.meta.url), 'utf8');
  const skill = readFileSync(new URL('../../skills/pr-quiz/SKILL.md', import.meta.url), 'utf8');
  const section = skill.slice(skill.indexOf('### English'), skill.indexOf('### Simplified Chinese'));
  assert.ok(skill.indexOf('### English') > 0 && section.length > 0, 'the skill has an English section before the Chinese one');
  assert.match(prompt, /plain-language rules for English/);
  assert.match(prompt, /Write questions, options and explanations in English\./);
  for (const text of [prompt, section]) {
    for (const word of ['because', 'since', 'due to', 'so that', 'therefore', 'leading to', 'at this point', '"When ...', 'not X but Y', BAD_STEM_EN, BAD_OPTION_EN, GOOD_STEM_EN]) assert.ok(text.includes(word), word);
  }
  for (const word of REASON_WORDS_EN) assert.ok(section.includes('"' + word + '"'), word);
  assert.match(section, new RegExp('longer than ' + MAX_STEM_WORDS + ' words, has more than ' + MAX_STEM_CODE_TOKENS + ' code names'));
  assert.match(section, new RegExp('clause longer than ' + MAX_OPENING_CLAUSE_WORDS + ' words'));
  assert.match(section, new RegExp('longer than ' + MAX_OPTION_WORDS + ' words, with more than ' + MAX_OPTION_CODE_TOKENS + ' code name'));
  // The two prompts differ only where the language does.
  const shape = (text) => text.split('\n').map((line) => (line.match(/\{\{\w+\}\}/g) || []).join(' '));
  assert.deepEqual(shape(prompt), shape(zh), 'same lines and placeholders');
});

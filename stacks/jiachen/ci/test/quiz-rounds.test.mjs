// End-to-end author quiz rounds. The real prepare, lens, quiz, publish and grade
// subcommands run as child processes against a throwaway repository, as in
// rounds.test.mjs. Only the outside systems are fakes: the GitLab API, served
// from this process, and the mcode binary, whose answers each test scripts.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { embedState, extractState, SUMMARY_MARKER } from '../core/state.mjs';

const REVIEW = fileURLToPath(new URL('../review.mjs', import.meta.url));
const BOT = 1000;
const AUTHOR = 7;
const IID = 9;
const lines = (name, count) => Array.from({ length: count }, (_, i) => 'export const ' + name + i + ' = ' + i + ';').join('\n') + '\n';
const HEAD1 = { 'src/a.js': lines('a', 5), 'src/b.js': lines('b', 5), 'src/c.js': lines('c', 5), 'src/d.js': lines('d', 5), 'src/a.test.js': lines('t', 40) };
// Each version is the whole tree on top of the base commit.
const VERSIONS = {
  base: { 'README.md': '# demo\n' },
  head1: HEAD1,
  head2: { ...HEAD1, 'src/a.js': lines('a', 6) },
  head3: { ...HEAD1, 'src/e.js': lines('e', 160) },
  head4: { ...HEAD1, 'src/e.js': lines('e', 160), 'src/f.js': lines('f', 160) },
};

const question = (dimension, prompt, options, answer = 0) => ({ dimension, prompt, options, answer_index: answer, explanation: 'Only the caller knows whether the request can be sent twice.', evidence: [{ path: 'src/a.js', line: 1 }] });
// English is the default language.
const PLAIN = [
  question('boundary', 'Two windows rename the same session at once. Which title stays?', ['The one renamed first', 'The one saved last', 'Both, as two sessions'], 1),
  question('impact-surface', 'This change sorts the session list differently. What else changes with it?', ['The sidebar and the search results', 'Only the sidebar order', 'Only the search result order']),
  question('boundary', 'A session has an empty title. What does the sidebar show?', ['"Untitled session"', 'The time it was created', 'No row at all']),
  question('design-intent', 'Why does the caller retry now, not the download function?', ['Only the caller knows a retry is safe', 'The download function has no room left', 'It writes fewer log lines']),
  question('failure-mode', 'The network drops halfway through a download. The user clicks again. What happens?', ['The whole file downloads again', 'It resumes where it stopped', 'It says the file already exists'], 1),
];
const CODE_HEAVY = PLAIN.map((item) => ({ ...item, prompt: 'At this point NoteEditor calls syncQueue.flush and lastSyncedAt is empty. ' + item.prompt }));
const zhQuestion = (dimension, prompt, options, answer = 0) => ({ ...question(dimension, prompt, options, answer), explanation: '只有调用方知道这次请求能不能重复发。' });
const PLAIN_ZH = [
  zhQuestion('boundary', '两个窗口同时改同一个会话的标题，最后留下哪个？', ['先改的那个窗口的标题', '后保存的那个窗口的标题', '两个标题都留下，变成两条'], 1),
  zhQuestion('impact-surface', '这次改了会话列表的排序，哪些地方会跟着变？', ['侧栏和搜索结果都会变', '只有侧栏的顺序会变', '只有搜索结果的顺序会变']),
  zhQuestion('boundary', '会话标题是空的，侧栏里会显示什么？', ['显示“未命名会话”', '显示会话的创建时间', '这一行直接不显示']),
  zhQuestion('design-intent', '为什么这次把重试放到调用方，而不是下载函数里？', ['调用方知道请求能不能重复发', '下载函数里放不下更多代码', '这样出错时日志会少一些']),
  zhQuestion('failure-mode', '下载到一半网络断了，用户再点一次下载会怎样？', ['从头重新下载整个文件', '接着上次的进度继续下载', '提示文件已存在，不再下载'], 1),
];

function fixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'mcode-review-quiz-rounds-'));
  const repo = path.join(root, 'repo');
  const origin = path.join(root, 'origin.git');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', origin]);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  git('remote', 'add', 'origin', origin);
  const shas = {};
  for (const [name, files] of Object.entries(VERSIONS)) {
    if (name !== 'base') git('checkout', '-q', '--detach', shas.base);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', name);
    shas[name] = git('rev-parse', 'HEAD');
  }
  git('push', '-q', 'origin', shas.base + ':refs/heads/main');
  return { root, repo, shas };
}

function fakeGitLab() {
  const db = { mr: null, notes: [], discussions: [] };
  let seq = 5000;
  db.addNote = (body, author = { id: BOT, username: 'review-bot' }) => {
    const note = { id: ++seq, body, author, system: false, resolvable: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    db.notes.push(note);
    return note;
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const body = raw ? JSON.parse(raw) : null;
      const reply = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const route = url.pathname.replace(/^\/api\/v4/, '');
      const list = (items) => reply(200, Number(url.searchParams.get('page') || '1') === 1 ? items : []);
      if (route === '/user') return reply(200, { id: BOT, username: 'review-bot' });
      const scoped = route.match(/^\/projects\/[^/]+\/merge_requests\/\d+(\/.*)?$/);
      if (!scoped) return reply(404, { message: 'not faked: ' + route });
      const rest = scoped[1] || '';
      let match;
      if (req.method === 'GET' && rest === '') return reply(200, db.mr);
      if (req.method === 'GET' && rest === '/pipelines') return reply(200, []);
      if (req.method === 'GET' && rest === '/notes') return list(db.notes);
      if (req.method === 'POST' && rest === '/notes') return reply(201, db.addNote(body.body));
      if (req.method === 'PUT' && (match = rest.match(/^\/notes\/(\d+)$/))) {
        const note = db.notes.find((item) => item.id === Number(match[1]));
        note.body = body.body;
        return reply(200, note);
      }
      if (req.method === 'GET' && rest === '/discussions') return list(db.discussions);
      if (req.method === 'POST' && rest === '/discussions') {
        const discussion = { id: 'd' + (++seq), notes: [{ id: ++seq, body: body.body, author: { id: BOT }, system: false, resolvable: true, resolved: false }] };
        db.discussions.push(discussion);
        return reply(201, discussion);
      }
      return reply(404, { message: 'not faked: ' + req.method + ' ' + route });
    });
  });
  return { db, server };
}

// Stands in for mcode exec. A review direction finds nothing; the quiz answers
// script.quiz, or script.quizAgain when the call continues its session.
const FAKE_MCODE = String.raw`#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const work = path.resolve(__dirname, '..', '..', '..');
const script = JSON.parse(fs.readFileSync(path.join(work, 'fake-mcode.json'), 'utf8'));
let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
const schema = path.basename(flag('--output-schema') || '');
const session = flag('--session');
fs.appendFileSync(path.join(work, 'fake-mcode-calls.jsonl'), JSON.stringify({ schema, session, prompt: input }) + '\n');
if (schema.startsWith('quiz') && script.quiz === 'fail') {
  process.stdout.write(JSON.stringify({ type: 'exec.result', status: 'failed', error: { message: 'upstream API error (529): 529 no eligible account' } }) + '\n');
  process.exit(4);
}
const answer = schema.startsWith('quiz') ? (session ? script.quizAgain : script.quiz) : schema.startsWith('verify') ? { results: [] } : { summary: '', findings: [], needs_human: [], claims: [] };
fs.writeFileSync(flag('--output-last-message'), JSON.stringify(answer));
process.stdout.write(JSON.stringify({ type: 'exec.result', status: 'succeeded', sessionId: 'quiz-session', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } }) + '\n');
`;

function review(command, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REVIEW, command], { cwd, env });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function setup(t) {
  const { root, repo, shas } = fixtureRepo();
  const gitlab = fakeGitLab();
  await new Promise((resolve) => gitlab.server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    gitlab.server.close();
    rmSync(root, { recursive: true, force: true });
  });
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    CI_PROJECT_DIR: repo,
    CI_API_V4_URL: 'http://127.0.0.1:' + gitlab.server.address().port + '/api/v4',
    CI_PROJECT_ID: '1',
    CI_MERGE_REQUEST_IID: String(IID),
    MCODE_REVIEW_GITLAB_TOKEN: 'gitlab-token-for-tests',
    MCODE_REVIEW_API_KEY: 'model-key-for-tests',
    MCODE_REVIEW_BASE_URL: 'https://gateway.example/v1',
    MCODE_REVIEW_LENS: 'general',
    MCODE_REVIEW_REPO_PROFILE: 'example',
    MCODE_REVIEW_PLUGIN_REF: '0123456789abcdef0123456789abcdef01234567',
    MCODE_REVIEW_TEMPLATE_VERSION: '1',
    MCODE_REVIEW_HOST: 'gitlab',
    CI_JOB_TOKEN: 'job-token-for-tests',
  };
  return { repo, shas, gitlab, env };
}

function push(fx, head) {
  execFileSync('git', ['push', '-q', '-f', 'origin', fx.shas[head] + ':refs/merge-requests/' + IID + '/head'], { cwd: fx.repo });
  fx.gitlab.db.mr = {
    iid: IID, sha: fx.shas[head], title: 'feat: retries', description: '## 验证\n单测\n## 回滚方式\nrevert', web_url: 'https://gitlab.example/g/p/-/merge_requests/' + IID,
    author: { id: AUTHOR, username: 'dev' }, source_branch: 'feat/retries', target_branch: 'main', draft: false,
    diff_refs: { base_sha: fx.shas.base, start_sha: fx.shas.base, head_sha: fx.shas[head] },
  };
}

// One pipeline: prepare, the lens, the quiz, publish. prepareEnv: variables only
// prepare sees.
async function round(fx, head, pipeline, script = { quiz: { questions: PLAIN } }, prepareEnv = {}) {
  rmSync(path.join(fx.repo, '.mcode-review'), { recursive: true, force: true });
  push(fx, head);
  const env = { ...fx.env, CI_PIPELINE_ID: String(pipeline), CI_COMMIT_SHA: fx.shas[head] };
  const prepare = await review('prepare', { ...env, ...prepareEnv }, fx.repo);
  assert.equal(prepare.code, 0, prepare.out);
  const work = path.join(fx.repo, '.mcode-review');
  const bin = path.join(work, 'npm', 'node_modules', '.bin', 'mcode');
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(bin, FAKE_MCODE);
  chmodSync(bin, 0o755);
  writeFileSync(path.join(work, 'fake-mcode.json'), JSON.stringify(script));
  const lens = await review('lens', env, fx.repo);
  assert.equal(lens.code, 0, lens.out);
  const quiz = await review('quiz', env, fx.repo);
  assert.equal(quiz.code, 0, quiz.out);
  const publish = await review('publish', env, fx.repo);
  assert.equal(publish.code, 0, publish.out);
  const callLog = path.join(work, 'fake-mcode-calls.jsonl');
  const calls = existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { prepare, quiz, publish, calls, plan: JSON.parse(readFileSync(path.join(work, 'plan.json'), 'utf8')) };
}

const quizNotes = (fx) => fx.gitlab.db.notes.filter((note) => note.body.includes('<!-- mcode-author-quiz-meta: '));
const records = (fx) => fx.gitlab.db.notes.filter((note) => note.body.includes('mcode-author-quiz-meta-response'));
const summaryBody = (fx) => fx.gitlab.db.notes.find((note) => note.body.includes(SUMMARY_MARKER))?.body || '';
const quizLine = (fx) => (summaryBody(fx).match(/### Author quiz\n\n(.+)/) || [])[1];
const quizLineZh = (fx) => (summaryBody(fx).match(/### 作者答题\n\n(.+)/) || [])[1];
const tick = (note, pairs) => {
  for (const [qid, oid] of pairs) note.body = note.body.replace('- [ ] <!-- ' + qid + ':' + oid + ' -->', '- [x] <!-- ' + qid + ':' + oid + ' -->');
  note.updated_at = new Date().toISOString();
};

test('the first round posts the quiz as one plain note and links it from the summary', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, 'head1', 201);
  assert.deepEqual([result.plan.quiz.needed, result.plan.quiz.generate, result.plan.quiz.decision], [true, true, 'first']);
  assert.equal(result.plan.quiz.scope.code_files, 4, 'the test file is not product code');
  const [note] = quizNotes(fx);
  assert.ok(note, result.publish.out);
  assert.equal(fx.gitlab.db.discussions.some((discussion) => discussion.notes[0].body.includes('mcode-author-quiz')), false, 'no resolvable thread');
  assert.match(note.body, /^### Author quiz\n\nA few parts of this change are easy to get wrong\./);
  assert.equal((note.body.match(/- \[ \] <!-- q\d:[a-e] -->/g) || []).length, 12, 'four questions of three options');
  assert.equal(quizLine(fx), 'The author quiz is in [this comment](https://gitlab.example/g/p/-/merge_requests/' + IID + '#note_' + note.id + '): not answered yet.');
  assert.equal(extractState(summaryBody(fx)).quiz.id, JSON.parse(note.body.match(/mcode-author-quiz-meta: (\{.*?\}) -->/)[1]).quizId);
  const prompt = result.calls.find((call) => call.schema === 'quiz.schema.json').prompt;
  assert.match(prompt, /This PR gets a quiz because: 20 lines of product code changed in 4 files\./);
  assert.match(prompt, /including its plain-language rules for English\./);
  assert.match(prompt, /Write questions, options and explanations in English\./);
  assert.match(prompt, /Write 5 questions; the pipeline keeps up to 4\. At least 3 of them/);
  assert.doesNotMatch(prompt, /src\/a\.test\.js/);
});

test('answers are recorded once each time they change, by publish or right away by grade', async (t) => {
  const fx = await setup(t);
  await round(fx, 'head1', 201);
  const [note] = quizNotes(fx);
  tick(note, [['q1', 'a']]);
  const env = { ...fx.env, CI_PIPELINE_ID: '202' };
  const graded = await review('grade', env, fx.repo);
  assert.equal(graded.code, 0, graded.out);
  assert.equal(records(fx).length, 1);
  assert.match(records(fx)[0].body, /^\*\*Quiz answers\*\*: 1 of 4 ticked on the quiz\./);
  const again = await review('grade', env, fx.repo);
  assert.match(again.out, /no new answers since the last record/);
  assert.equal(records(fx).length, 1, 'unchanged picks are not recorded twice');
  fx.gitlab.db.addNote('1B 2A 3C 4A', { id: AUTHOR, username: 'dev' });
  const result = await round(fx, 'head2', 203);
  assert.equal(result.plan.quiz.decision, 'answered');
  assert.equal(quizNotes(fx).length, 1);
  assert.equal(records(fx).length, 2);
  assert.match(records(fx)[1].body, /^\*\*Quiz answers\*\*: @dev answered 4 of 4 in a comment\./);
  assert.match(quizLine(fx), /: 4 of 4 answered\.$/);
});

test('a big push before anyone answered asks again; once answered, it does not', async (t) => {
  const fx = await setup(t);
  await round(fx, 'head1', 201);
  const small = await round(fx, 'head2', 202);
  assert.equal(small.plan.quiz.decision, 'kept');
  assert.equal(quizNotes(fx).length, 1);
  const big = await round(fx, 'head3', 203);
  assert.equal(big.plan.quiz.decision, 'regenerate-lines');
  assert.equal(quizNotes(fx).length, 2);
  assert.match(quizNotes(fx)[1].body, /The code changed a lot, so the questions were written again\. You do not need to answer the earlier ones\./);
  assert.match(quizLine(fx), new RegExp('#note_' + quizNotes(fx)[1].id + '\\)'));
  tick(quizNotes(fx)[1], [['q2', 'b']]);
  const answered = await round(fx, 'head4', 204);
  assert.equal(answered.plan.quiz.decision, 'answered');
  assert.deepEqual(answered.calls.filter((call) => call.schema === 'quiz.schema.json'), [], 'no model call');
  assert.equal(quizNotes(fx).length, 2);
});

test('too few plain questions are rewritten once in the same session', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, 'head1', 201, { quiz: { questions: CODE_HEAVY }, quizAgain: { questions: PLAIN } });
  const quizCalls = result.calls.filter((call) => call.schema === 'quiz.schema.json');
  assert.deepEqual(quizCalls.map((call) => call.session), ['', 'quiz-session']);
  assert.match(quizCalls[1].prompt, /^Some questions in your previous reply cannot be used:\n- Question 1 /);
  assert.match(quizCalls[1].prompt, /code names \(syncQueue\.flush, NoteEditor, lastSyncedAt\)/);
  assert.match(result.quiz.out, /the checks dropped 5 of 5, then 0 of 5/);
  assert.equal(quizNotes(fx).length, 1);
});

test('a quiz the model could not write fails open: no note, one line in the summary', async (t) => {
  const fx = await setup(t);
  const result = await round(fx, 'head1', 201, { quiz: 'fail' });
  assert.match(result.quiz.out, /quiz generation failed/);
  assert.equal(quizNotes(fx).length, 0);
  assert.equal(quizLine(fx), 'No quiz could be written this round; the next round tries again.');
  const next = await round(fx, 'head2', 202);
  assert.equal(next.plan.quiz.decision, 'first', 'the next round tries again');
  assert.equal(quizNotes(fx).length, 1);
});

test('a PR with a sealed quiz of an older version keeps it and gets no new one', async (t) => {
  const fx = await setup(t);
  const sealed = { head_sha: 'a'.repeat(40), questions: [{ id: 'Q1-abcdef', title: '锁会怎样？', options: ['a', 'b'], commitment: 'c'.repeat(64), sealed: 'x.y.z.w', status: 'pending' }], graded: false, discussion_id: 'd1', note_id: 4999, card_message_id: null };
  fx.gitlab.db.addNote('<!-- mcode-review:summary -->\n## MCode Review\n\n' + embedState({ v: 1, round: 1, lenses: {}, files: {}, history: [], quiz: sealed }));
  const result = await round(fx, 'head1', 201);
  assert.equal(result.plan.quiz.decision, 'legacy');
  assert.equal(quizNotes(fx).length, 0);
  assert.equal(quizLine(fx), 'The old quiz is in [this thread](https://gitlab.example/g/p/-/merge_requests/' + IID + '#note_4999) and is no longer graded.');
  assert.deepEqual(extractState(summaryBody(fx)).quiz, sealed, 'the sealed quiz stays in the state as it was');
});

test('prepare stops when the plugin version is not a commit, and says why in plain words', async (t) => {
  const fx = await setup(t);
  push(fx, 'head1');
  for (const ref of ['main', 'v0.7.0']) {
    const result = await review('prepare', { ...fx.env, MCODE_REVIEW_PLUGIN_REF: ref, CI_PIPELINE_ID: '201' }, fx.repo);
    assert.notEqual(result.code, 0);
    assert.match(result.out, new RegExp('MCODE_REVIEW_PLUGIN_REF is "' + ref.replace('.', '\\.') + '", which is not a 40-character commit SHA\\.'));
    assert.doesNotMatch(result.out, /\n\s+at /, 'no stack trace');
  }
  assert.equal(fx.gitlab.db.notes.length, 0, 'nothing was posted');
});

test('the grade job of an older child pipeline exits cleanly without a plan or a quiz', async (t) => {
  const fx = await setup(t);
  push(fx, 'head1');
  const result = await review('grade', { ...fx.env, CI_PIPELINE_ID: '201' }, fx.repo);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /this PR has no quiz/);
  const off = await review('grade', { ...fx.env, MCODE_REVIEW_REPO_PROFILE: 'default' }, fx.repo);
  assert.equal(off.code, 0, off.out);
  assert.match(off.out, /the author quiz is off for this repository/);
});

// The language changes between rounds: a quiz posted in Chinese is still the
// PR's quiz when the next rounds run in English.
test('a Chinese pipeline writes the quiz in Chinese, and a later English round reads it and records the answers in English', async (t) => {
  const fx = await setup(t);
  const first = await round(fx, 'head1', 201, { quiz: { questions: PLAIN_ZH } }, { MCODE_REVIEW_LANGUAGE: 'zh' });
  assert.equal(first.plan.language, 'zh');
  const [note] = quizNotes(fx);
  assert.match(note.body, /^### 作者答题\n\n这次改动有几处容易出问题，下面几道题帮你确认一遍。/);
  assert.match(note.body, /\n\*\*Q1\.\*\* 答案：[A-C]\n/);
  assert.equal(quizLineZh(fx), '作者答题见[这条评论](https://gitlab.example/g/p/-/merge_requests/' + IID + '#note_' + note.id + ')，还没有作答。');
  const prompt = first.calls.find((call) => call.schema === 'quiz.schema.json').prompt;
  assert.ok(prompt.startsWith(readFileSync(new URL('../prompts/quiz.zh.md', import.meta.url), 'utf8').split('{{pr_ref}}')[0]), 'the Chinese prompt');
  assert.match(prompt, /This PR gets a quiz because: 产品代码改了 20 行、4 个文件\./);
  assert.match(prompt, /Write questions, options and explanations in Simplified Chinese\./);
  // The author ticks one answer; grade runs with the setting back at English.
  tick(note, [['q1', 'a']]);
  const graded = await review('grade', { ...fx.env, CI_PIPELINE_ID: '202' }, fx.repo);
  assert.equal(graded.code, 0, graded.out);
  assert.match(records(fx)[0].body, /^\*\*Quiz answers\*\*: 1 of 4 ticked on the quiz\./);
  // The next round runs in English: it keeps the Chinese quiz and reads its answers.
  fx.gitlab.db.addNote('answers: 1A 2B 3C', { id: AUTHOR, username: 'dev' });
  const next = await round(fx, 'head2', 203);
  assert.equal(next.plan.language, 'en');
  assert.equal(next.plan.quiz.decision, 'answered');
  assert.equal(quizNotes(fx).length, 1);
  assert.match(records(fx)[1].body, /^\*\*Quiz answers\*\*: @dev answered 3 of 4 in a comment\./);
  assert.match(summaryBody(fx), /## MCode Review: /);
  assert.equal(quizLine(fx), 'The author quiz is in [this comment](https://gitlab.example/g/p/-/merge_requests/' + IID + '#note_' + note.id + '): 3 of 4 answered.');
});

test('a Chinese quiz with too few plain questions is rewritten in Chinese', async (t) => {
  const fx = await setup(t);
  const heavy = PLAIN_ZH.map((item) => ({ ...item, prompt: '此时 NoteEditor 调用 syncQueue.flush 后 lastSyncedAt 为空，' + item.prompt }));
  const result = await round(fx, 'head1', 201, { quiz: { questions: heavy }, quizAgain: { questions: PLAIN_ZH } }, { MCODE_REVIEW_LANGUAGE: 'zh' });
  const quizCalls = result.calls.filter((call) => call.schema === 'quiz.schema.json');
  assert.deepEqual(quizCalls.map((call) => call.session), ['', 'quiz-session']);
  assert.match(quizCalls[1].prompt, /^你上一条回复里有些题目不能用：\n- 第 1 题（/);
  assert.match(quizCalls[1].prompt, /the stem uses 此时 or opens with 当……时/);
  assert.match(quizCalls[1].prompt, /遵守 pr-quiz skill 里简体中文的通俗表达规则/);
  assert.equal(quizNotes(fx).length, 1);
});

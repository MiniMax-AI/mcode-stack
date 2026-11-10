import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS_BOT, GitHub, normalizeLogin } from '../core/github.mjs';
import { readThreadIndex, threadMarker } from '../core/threads.mjs';
import { serveGitHub } from './fake-github.mjs';

const HEAD = 'c'.repeat(40);
const TIP = 'b'.repeat(40);
const MERGE_BASE = 'a'.repeat(40);

async function setup(t) {
  const github = await serveGitHub(t);
  github.db.pr = { number: 5, title: 'feat: x', body: null, html_url: 'https://github.example/acme/app/pull/5', draft: false, user: { login: 'Dev' }, head: { sha: HEAD, ref: 'feat', repo: { full_name: 'acme/app' } }, base: { sha: TIP, ref: 'main' } };
  github.db.mergeBase = MERGE_BASE;
  const client = (options = {}) => new GitHub({ apiUrl: github.url(), graphqlUrl: github.url() + '/graphql', token: 'gh-token', repository: 'acme/app', ...options });
  return { db: github.db, client };
}

test('logins compare without case and without the [bot] suffix REST adds', () => {
  assert.equal(normalizeLogin('github-actions[bot]'), 'github-actions');
  assert.equal(normalizeLogin('GitHub-Actions'), 'github-actions');
  assert.equal(normalizeLogin(' Alice '), 'alice');
  assert.equal(normalizeLogin(undefined), '');
  assert.equal(ACTIONS_BOT, 'github-actions[bot]');
});

test('the bot is MCODE_REVIEW_BOT_LOGIN, else the user of the token, else github-actions when GET /user is closed to the token', async (t) => {
  const { db, client } = await setup(t);
  assert.deepEqual(await client().currentUser(), { id: 'github-actions', username: 'github-actions[bot]', app: true }, 'the workflow token');
  db.user = 'review-bot';
  assert.deepEqual(await client().currentUser(), { id: 'review-bot', username: 'review-bot', app: false }, "a bot account's token");
  const calls = db.calls.length;
  assert.deepEqual(await client({ botLogin: 'Acme-Review[bot]' }).currentUser(), { id: 'acme-review', username: 'Acme-Review[bot]', app: true }, 'an app named by MCODE_REVIEW_BOT_LOGIN');
  assert.equal(db.calls.length, calls, 'no GET /user when the login is given');
});

test('a PR reads as a merge request whose base is the merge base from the compare API, not the tip of the target', async (t) => {
  const { db, client } = await setup(t);
  const mr = await client().mergeRequest(5);
  assert.deepEqual(mr.diff_refs, { base_sha: MERGE_BASE, start_sha: TIP, head_sha: HEAD });
  assert.deepEqual([mr.iid, mr.sha, mr.title, mr.description, mr.source_branch, mr.target_branch, mr.draft, mr.web_url], [5, HEAD, 'feat: x', '', 'feat', 'main', false, 'https://github.example/acme/app/pull/5']);
  assert.deepEqual(mr.author, { id: 'dev', username: 'Dev' });
  assert.deepEqual(db.calls.map((call) => call.method + ' ' + call.path), ['GET /repos/acme/app/pulls/5', 'GET /repos/acme/app/compare/' + TIP + '...' + HEAD]);
  assert.equal(db.calls[0].auth, 'Bearer gh-token');
});

test('PR comments read back as notes, and the summary comment is created and updated in place', async (t) => {
  const { db, client } = await setup(t);
  db.addComment('a person writes', 'Alice');
  const gh = client();
  const created = await gh.createNote(5, 'summary');
  assert.deepEqual([created.author, created.system], [{ id: 'github-actions', username: 'github-actions[bot]' }, false]);
  await gh.updateNote(5, created.id, 'summary 2');
  const notes = await gh.notes(5);
  assert.deepEqual(notes.map((note) => [note.author.id, note.body]), [['alice', 'a person writes'], ['github-actions', 'summary 2']]);
  assert.ok(db.calls.some((call) => call.method === 'PATCH' && call.path === '/repos/acme/app/issues/comments/' + created.id));
});

test('review threads read back as GitLab discussions over every page; an app resolution is the bot only when the bot is an app', async (t) => {
  const { db, client } = await setup(t);
  const marker = (id) => 'body\n\n' + threadMarker({ id, kind: 'finding', title: id, path: 'a.js', line: 1, severity: 'P1', lens: 'general' });
  const open = db.addThread({ body: marker('F-aaaaaa') });
  db.replyAs(open, 'why?', 'alice');
  db.replyAs(open, 'because', 'github-actions');
  const byApp = db.addThread({ body: marker('F-bbbbbb') });
  byApp.isResolved = true;
  const byPerson = db.addThread({ body: marker('F-cccccc'), resolvedBy: 'alice' });
  const discussions = await client().discussions(5);
  assert.deepEqual(discussions.map((item) => item.id), [open.id + '#' + open.comments[0].databaseId, byApp.id + '#' + byApp.comments[0].databaseId, byPerson.id + '#' + byPerson.comments[0].databaseId]);
  assert.deepEqual(discussions[0].notes.map((note) => [note.author.id, note.resolvable, note.resolved, note.body.slice(0, 7)]), [['github-actions', true, false, 'body\n\n<'], ['alice', true, false, 'why?'], ['github-actions', true, false, 'because']]);
  const queries = db.calls.filter((call) => call.path === '/graphql').map((call) => call.body);
  assert.equal(queries.filter((query) => /reviewThreads/.test(query.query)).length, 2, 'three threads, two to a page');
  assert.deepEqual(queries.filter((query) => /node\(id/.test(query.query)).map((query) => query.variables), [{ id: open.id, after: '2' }], 'the third comment of the first thread');
  const index = readThreadIndex(discussions, 'github-actions');
  assert.deepEqual([...index.values()].map((thread) => [thread.id, thread.resolved, thread.resolvedByBot, thread.resolvedBy?.username || null, thread.humanReplies.length]), [
    ['F-aaaaaa', false, false, null, 1],
    ['F-bbbbbb', true, true, 'github-actions[bot]', 0],
    ['F-cccccc', true, false, 'alice', 0],
  ]);
  // A bot account posts with a user's token: an app that resolved a thread was someone else.
  db.user = 'review-bot';
  const asUser = await client().discussions(5);
  assert.equal(asUser[1].notes[0].resolved_by, null);
});

test('a thread goes on a line, else on a whole file; replies go to its first comment, and GraphQL resolves and reopens it', async (t) => {
  const { db, client } = await setup(t);
  db.files = ['a.js'];
  const gh = client();
  const line = await gh.createDiscussion(5, 'on a line', { position_type: 'text', base_sha: MERGE_BASE, start_sha: TIP, head_sha: HEAD, new_path: 'a.js', old_path: 'a.js', new_line: 3 });
  const posts = () => db.calls.filter((call) => call.method === 'POST' && call.path === '/repos/acme/app/pulls/5/comments').map((call) => call.body);
  assert.deepEqual(posts()[0], { body: 'on a line', commit_id: HEAD, path: 'a.js', line: 3, side: 'RIGHT' });
  assert.deepEqual(line, { id: '#' + db.threads[0].comments[0].databaseId, notes: [{ id: db.threads[0].comments[0].databaseId }] });
  await gh.createDiscussion(5, 'on a file', null, { path: 'a.js', head_sha: HEAD });
  assert.deepEqual(posts()[1], { body: 'on a file', commit_id: HEAD, path: 'a.js', subject_type: 'file' });
  await assert.rejects(gh.createDiscussion(5, 'nowhere', null, { path: '', head_sha: HEAD }), /no thread on a pull request as a whole/);
  const [discussion] = await gh.discussions(5);
  await gh.replyDiscussion(5, discussion.id, 'still there');
  assert.ok(db.calls.some((call) => call.method === 'POST' && call.path === '/repos/acme/app/pulls/5/comments/' + db.threads[0].comments[0].databaseId + '/replies'));
  assert.deepEqual(db.threads[0].comments.map((comment) => comment.body), ['on a line', 'still there']);
  await gh.resolveDiscussion(5, discussion.id, true);
  assert.equal(db.threads[0].isResolved, true);
  await gh.resolveDiscussion(5, discussion.id, false);
  assert.equal(db.threads[0].isResolved, false);
  const mutations = db.calls.filter((call) => call.path === '/graphql' && /mutation/.test(call.body.query));
  assert.deepEqual(mutations.map((call) => [/unresolveReviewThread/.test(call.body.query) ? 'unresolve' : 'resolve', call.body.variables.id]), [['resolve', db.threads[0].id], ['unresolve', db.threads[0].id]]);
  db.forbidResolve = true;
  await assert.rejects(gh.resolveDiscussion(5, discussion.id, true), /GitHub GraphQL -> 200: Resource not accessible by integration \(a token resolves or reopens a review thread only with contents: write as well as pull-requests: write\)/);
  await assert.rejects(Promise.resolve().then(() => gh.replyDiscussion(5, '#', 'x')), /has no first comment to reply to/);
});

test('commit authors read back as GitLab lists them, for the quiz card', async (t) => {
  const { db, client } = await setup(t);
  db.commits = [{ sha: 'd'.repeat(40), commit: { author: { name: 'Dev', email: 'dev@example.com' } } }];
  assert.deepEqual(await client().mergeRequestCommits(5), [{ author_email: 'dev@example.com', author_name: 'Dev' }]);
});

// Replaces fetch for one test; each outcome is an error to throw or a response.
function stubFetch(t, outcomes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next?.body ?? {}), { status: next?.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}
const networkError = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code }) });

test('requests carry the token, the API version and a user agent; a query is retried, a mutation that may have arrived is not', async (t) => {
  const gh = new GitHub({ token: 'gh-token', repository: 'acme/app' });
  const calls = stubFetch(t, [{ body: { login: 'review-bot' } }]);
  await gh.currentUser();
  assert.equal(calls[0].url, 'https://api.github.com/user');
  assert.deepEqual(calls[0].init.headers, { Authorization: 'Bearer gh-token', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mcode-review' });
  const query = stubFetch(t, [networkError('ECONNRESET'), { body: { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } } }]);
  assert.deepEqual(await gh.discussions(5), []);
  assert.equal(query.length, 2);
  assert.equal(query[1].url, 'https://api.github.com/graphql');
  const mutation = stubFetch(t, [networkError('ECONNRESET')]);
  await assert.rejects(gh.resolveDiscussion(5, 'PRRT_1#2'), /GitHub GraphQL: fetch failed \(ECONNRESET: socket\)/);
  assert.equal(mutation.length, 1, 'the server may have received it');
  stubFetch(t, [{ status: 422, body: { message: 'Validation Failed' } }]);
  await assert.rejects(gh.createNote(5, 'x'), (error) => error.status === 422 && /GitHub POST \/repos\/acme\/app\/issues\/5\/comments -> 422/.test(error.message));
});

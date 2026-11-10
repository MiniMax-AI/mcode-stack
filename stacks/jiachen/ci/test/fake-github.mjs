// The parts of the GitHub REST and GraphQL APIs the review uses, served from
// the test process, with comments and review threads kept in memory across
// rounds. It behaves as github.com does where the review depends on it: REST
// names the bot "github-actions[bot]" and GraphQL "github-actions"; GET /user is
// closed to the workflow token; a thread an app resolves through GraphQL reads
// back with resolvedBy null; a comment holds at most 65,536 characters; review
// comments go only on files the PR changes; and GraphQL connections come in
// pages, pageSize items long here so that tests reach the next page.
import http from 'node:http';

export const BOT_REST = 'github-actions[bot]';
export const BOT_GRAPHQL = 'github-actions';
export const COMMENT_LIMIT = 65536;

export function fakeGitHub({ owner = 'acme', name = 'app', pageSize = 2 } = {}) {
  // pr: the pull request as GET /pulls/<n> returns it; mergeBase: what the
  // compare API answers; files: the paths review comments may go on (all when
  // null); user: the login GET /user answers, or null for the workflow token.
  const db = { pr: null, mergeBase: null, files: null, comments: [], threads: [], commits: [], calls: [], user: null, forbidResolve: false };
  let seq = 1000;
  const now = () => new Date().toISOString();
  const restUser = (login) => ({ login, type: login.endsWith('[bot]') ? 'Bot' : 'User' });

  // A comment on the PR; the bot's when no login is given.
  db.addComment = (body, login = BOT_REST) => {
    const comment = { id: ++seq, body, user: restUser(login), created_at: now(), updated_at: now() };
    db.comments.push(comment);
    return comment;
  };
  // A review thread whose first comment is by login (GraphQL form).
  db.addThread = ({ body, login = BOT_GRAPHQL, path = 'a.js', line = 1, resolvedBy } = {}) => {
    const thread = { id: 'PRRT_' + ++seq, isResolved: resolvedBy !== undefined, resolvedBy: resolvedBy ? { login: resolvedBy } : null, path, line, subjectType: line ? 'LINE' : 'FILE', commit: null, comments: [] };
    thread.comments.push({ databaseId: ++seq, body, author: { login }, createdAt: now() });
    db.threads.push(thread);
    return thread;
  };
  // A person resolves a thread, or replies in it.
  db.resolveAs = (thread, login) => Object.assign(thread, { isResolved: true, resolvedBy: { login } });
  db.replyAs = (thread, body, login) => thread.comments.push({ databaseId: ++seq, body, author: { login }, createdAt: now() });

  const page = (items, after) => {
    const start = after ? Number(after) : 0;
    const nodes = items.slice(start, start + pageSize);
    return { nodes, pageInfo: { hasNextPage: start + nodes.length < items.length, endCursor: String(start + nodes.length) } };
  };
  const threadNode = (thread) => ({ id: thread.id, isResolved: thread.isResolved, resolvedBy: thread.resolvedBy, comments: page(thread.comments, null) });
  const findThread = (id) => db.threads.find((thread) => thread.id === id);

  function graphql({ query, variables }, reply) {
    const error = (message, type) => reply(200, { data: null, errors: [{ message, ...(type ? { type } : {}) }] });
    if (/unresolveReviewThread/.test(query)) {
      const thread = findThread(variables.id);
      if (!thread) return error('Could not resolve to a node with the global id of ' + variables.id);
      Object.assign(thread, { isResolved: false, resolvedBy: null });
      return reply(200, { data: { unresolveReviewThread: { thread: { id: thread.id, isResolved: false } } } });
    }
    if (/resolveReviewThread/.test(query)) {
      if (db.forbidResolve) return error('Resource not accessible by integration', 'FORBIDDEN');
      const thread = findThread(variables.id);
      if (!thread) return error('Could not resolve to a node with the global id of ' + variables.id);
      // resolvedBy is a User; an app that resolves leaves it empty.
      Object.assign(thread, { isResolved: true, resolvedBy: null });
      return reply(200, { data: { resolveReviewThread: { thread: { id: thread.id, isResolved: true } } } });
    }
    if (/reviewThreads/.test(query)) {
      if (variables.owner !== owner || variables.name !== name || variables.number !== db.pr?.number) return error('Could not resolve to a PullRequest with the number of ' + variables.number);
      const connection = page(db.threads, variables.after);
      return reply(200, { data: { repository: { pullRequest: { reviewThreads: { ...connection, nodes: connection.nodes.map(threadNode) } } } } });
    }
    if (/node\(id/.test(query)) {
      const thread = findThread(variables.id);
      return thread ? reply(200, { data: { node: { comments: page(thread.comments, variables.after) } } }) : error('no such node');
    }
    return error('not faked');
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const body = raw ? JSON.parse(raw) : null;
      db.calls.push({ method: req.method, path: url.pathname, search: url.search, body, auth: req.headers.authorization || null });
      const reply = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      // Answers 422 and returns true when the body is over the limit.
      const tooLong = () => {
        if (String(body?.body || '').length <= COMMENT_LIMIT) return false;
        reply(422, { message: 'Validation Failed', errors: [{ field: 'body', code: 'custom', message: 'body is too long (maximum is 65536 characters)' }] });
        return true;
      };
      if (url.pathname === '/graphql') return graphql(body, reply);
      if (url.pathname === '/user') return db.user ? reply(200, restUser(db.user)) : reply(403, { message: 'Resource not accessible by integration' });
      const prefix = '/repos/' + owner + '/' + name;
      if (!url.pathname.startsWith(prefix + '/')) return reply(404, { message: 'Not Found' });
      const route = url.pathname.slice(prefix.length);
      const number = db.pr?.number;
      let match;
      if (req.method === 'GET' && route === '/pulls/' + number) return reply(200, db.pr);
      if (req.method === 'GET' && (match = route.match(/^\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/))) return reply(200, { base_commit: { sha: match[1] }, merge_base_commit: { sha: db.mergeBase } });
      if (req.method === 'GET' && route === '/issues/' + number + '/comments') {
        const pageNumber = Number(url.searchParams.get('page') || '1');
        const per = Number(url.searchParams.get('per_page') || '30');
        return reply(200, db.comments.slice((pageNumber - 1) * per, pageNumber * per));
      }
      if (req.method === 'POST' && route === '/issues/' + number + '/comments') {
        if (tooLong()) return;
        return reply(201, db.addComment(body.body));
      }
      if (req.method === 'PATCH' && (match = route.match(/^\/issues\/comments\/(\d+)$/))) {
        const comment = db.comments.find((item) => item.id === Number(match[1]));
        if (!comment) return reply(404, { message: 'Not Found' });
        if (tooLong()) return;
        Object.assign(comment, { body: body.body, updated_at: now() });
        return reply(200, comment);
      }
      if (req.method === 'POST' && route === '/pulls/' + number + '/comments') {
        const fileLevel = body.subject_type === 'file';
        const known = new Set(['body', 'commit_id', 'path', ...(fileLevel ? ['subject_type'] : ['line', 'side'])]);
        if (!body.commit_id || !body.path || Object.keys(body).some((key) => !known.has(key)) || (!fileLevel && (!Number.isInteger(body.line) || body.side !== 'RIGHT'))) return reply(422, { message: 'Validation Failed', request: body });
        if (db.files && !db.files.includes(body.path)) return reply(422, { message: 'Validation Failed', errors: ['path could not be resolved'] });
        if (tooLong()) return;
        const thread = db.addThread({ body: body.body, path: body.path, line: fileLevel ? null : body.line });
        thread.commit = body.commit_id;
        const first = thread.comments[0];
        return reply(201, { id: first.databaseId, node_id: 'PRRC_' + first.databaseId, path: body.path, line: thread.line, subject_type: fileLevel ? 'file' : 'line', body: body.body, user: restUser(BOT_REST) });
      }
      if (req.method === 'POST' && (match = route.match(/^\/pulls\/(\d+)\/comments\/(\d+)\/replies$/))) {
        // Only a thread's first comment takes replies.
        const thread = db.threads.find((item) => item.comments[0].databaseId === Number(match[2]));
        if (!thread || Number(match[1]) !== number) return reply(404, { message: 'Not Found' });
        if (tooLong()) return;
        const comment = { databaseId: ++seq, body: body.body, author: { login: BOT_GRAPHQL }, createdAt: now() };
        thread.comments.push(comment);
        return reply(201, { id: comment.databaseId, body: body.body, in_reply_to_id: Number(match[2]), user: restUser(BOT_REST) });
      }
      if (req.method === 'GET' && route === '/pulls/' + number + '/commits') return reply(200, db.commits);
      return reply(404, { message: 'not faked: ' + req.method + ' ' + route });
    });
  });
  return { db, server, url: () => 'http://127.0.0.1:' + server.address().port };
}

// Starts the fake and stops it after the test.
export async function serveGitHub(t, options) {
  const github = fakeGitHub(options);
  await new Promise((resolve) => github.server.listen(0, '127.0.0.1', resolve));
  t.after(() => github.server.close());
  return github;
}

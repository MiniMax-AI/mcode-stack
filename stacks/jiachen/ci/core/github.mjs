import { sendWithRetry } from './http.mjs';
import { log } from './util.mjs';

// The GitHub REST and GraphQL APIs, answering in the shapes the GitLab client
// returns, so the verdict, thread and state logic reads both hosts the same way:
// a PR as a merge request (iid, sha, diff_refs...), its comments as notes, its
// review threads as discussions. GitHub has no pipeline or job API here: a later
// round's unpublished lens results are not reused on GitHub.

// REST names a bot "github-actions[bot]", GraphQL "github-actions". Logins are
// compared lowercased and without the suffix; the normalized login is the id.
export function normalizeLogin(login) {
  return String(login ?? '').trim().toLowerCase().replace(/\[bot\]$/, '');
}

// The bot behind the automatic GITHUB_TOKEN. GET /user is closed to it, and to
// every GitHub App token.
export const ACTIONS_BOT = 'github-actions[bot]';

const person = (login) => (login ? { id: normalizeLogin(login), username: String(login) } : null);

// A thread id carries the GraphQL id of the thread, which resolving needs, and
// the REST id of its first comment, which replying needs: "<thread>#<comment>".
const threadPart = (id) => String(id ?? '').split('#')[0];
const commentPart = (id) => String(id ?? '').split('#')[1] || '';

const COMMENT_FIELDS = 'fragment comment on PullRequestReviewComment { databaseId body createdAt author { login } }';
const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved resolvedBy { login } comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { ...comment } } }
      }
    }
  }
}
${COMMENT_FIELDS}`;
const COMMENTS_QUERY = `query($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequestReviewThread { comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ...comment } } } }
}
${COMMENT_FIELDS}`;
const RESOLVE = 'mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }';
const UNRESOLVE = 'mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }';
const MAX_PAGES = 30;

const issueComment = (comment) => ({ id: comment.id, body: comment.body || '', author: person(comment.user?.login), system: false, created_at: comment.created_at || '', updated_at: comment.updated_at || '' });

export class GitHub {
  // repository: owner/name. botLogin: the login the token posts as, when GET
  // /user cannot tell (a GitHub App token); empty for a user's token.
  constructor({ apiUrl = 'https://api.github.com', graphqlUrl = 'https://api.github.com/graphql', token, repository, botLogin = '' }) {
    this.apiUrl = String(apiUrl).replace(/\/$/, '');
    this.graphqlUrl = graphqlUrl;
    this.token = token;
    [this.owner, this.name] = String(repository).split('/');
    this.botLogin = String(botLogin || '').trim();
    this.bot = null;
  }

  headers(json) {
    return { Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mcode-review', ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }

  async request(method, pathname, body) {
    const label = 'GitHub ' + method + ' ' + pathname.split('?')[0];
    const response = await sendWithRetry(label, this.apiUrl + pathname, { method, headers: this.headers(Boolean(body)), body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) {
      const text = await response.text();
      throw Object.assign(new Error(label + ' -> ' + response.status + ': ' + text.slice(0, 400)), { status: response.status });
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async paginate(pathname, maxPages = MAX_PAGES) {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const sep = pathname.includes('?') ? '&' : '?';
      const batch = await this.request('GET', pathname + sep + 'per_page=100&page=' + page);
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  // A query is a read and is retried like one; a mutation is a write.
  async graphql(query, variables, { mutation = false } = {}) {
    const response = await sendWithRetry('GitHub GraphQL', this.graphqlUrl, { method: 'POST', headers: this.headers(true), body: JSON.stringify({ query, variables }) }, { read: !mutation });
    const text = await response.text();
    let answer = null;
    try {
      answer = JSON.parse(text);
    } catch {
      // reported below with the raw text
    }
    if (!response.ok || !answer || answer.errors?.length) {
      const message = answer?.errors?.length ? answer.errors.map((error) => error.message).join('; ') : text;
      throw new Error('GitHub GraphQL -> ' + response.status + ': ' + String(message).slice(0, 400));
    }
    return answer.data;
  }

  repo(suffix) {
    return '/repos/' + encodeURIComponent(this.owner) + '/' + encodeURIComponent(this.name) + suffix;
  }

  // The account this token posts as: MCODE_REVIEW_BOT_LOGIN when set, else GET
  // /user, which answers for a user's token only. With the automatic
  // GITHUB_TOKEN, or any GitHub App token, it fails, and the bot is taken to be
  // github-actions. app: the bot is a GitHub App, not a user account.
  async currentUser() {
    if (this.bot) return this.bot;
    let login = this.botLogin;
    let app = /\[bot\]$/i.test(login) || normalizeLogin(login) === normalizeLogin(ACTIONS_BOT);
    if (!login) {
      try {
        login = (await this.request('GET', '/user')).login;
        app = false;
      } catch (error) {
        if (!error.status) throw error;
        login = ACTIONS_BOT;
        app = true;
        log('GET /user is not open to this token (' + error.status + '), so the bot is taken to be ' + ACTIONS_BOT + '. If MCODE_REVIEW_GITHUB_TOKEN belongs to a GitHub App, set MCODE_REVIEW_BOT_LOGIN to its login, such as my-app[bot].');
      }
    }
    this.bot = { ...person(login), app };
    return this.bot;
  }

  // The merge base comes from the compare API: pull.base.sha is the tip of the
  // target branch, which may have moved on since the branch was cut.
  async mergeRequest(number) {
    const pr = await this.request('GET', this.repo('/pulls/' + number));
    const compare = await this.request('GET', this.repo('/compare/' + pr.base.sha + '...' + pr.head.sha + '?per_page=1'));
    return {
      iid: pr.number,
      sha: pr.head.sha,
      title: pr.title || '',
      description: pr.body || '',
      web_url: pr.html_url,
      author: person(pr.user?.login),
      source_branch: pr.head.ref,
      target_branch: pr.base.ref,
      draft: Boolean(pr.draft),
      diff_refs: { base_sha: compare.merge_base_commit.sha, start_sha: pr.base.sha, head_sha: pr.head.sha },
    };
  }

  // The PR's comments (issue comments), oldest first.
  async notes(number) {
    return (await this.paginate(this.repo('/issues/' + number + '/comments'))).map(issueComment);
  }

  async createNote(number, body) {
    return issueComment(await this.request('POST', this.repo('/issues/' + number + '/comments'), { body }));
  }

  async updateNote(number, noteId, body) {
    return issueComment(await this.request('PATCH', this.repo('/issues/comments/' + noteId), { body }));
  }

  // The PR's review threads, every page of threads and of their comments.
  // resolvedBy is a User: a thread a GitHub App resolved reads back without one.
  // Only this bot resolves threads with an app token, so when the bot is an app
  // such a thread counts as resolved by the bot; a person always shows.
  async discussions(number) {
    const bot = await this.currentUser();
    const threads = [];
    let after = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await this.graphql(THREADS_QUERY, { owner: this.owner, name: this.name, number: Number(number), after });
      const connection = data.repository.pullRequest.reviewThreads;
      threads.push(...connection.nodes);
      if (!connection.pageInfo.hasNextPage) break;
      after = connection.pageInfo.endCursor;
    }
    const result = [];
    for (const thread of threads) {
      const comments = [...thread.comments.nodes];
      let cursor = thread.comments.pageInfo.hasNextPage ? thread.comments.pageInfo.endCursor : null;
      for (let page = 0; cursor && page < MAX_PAGES; page += 1) {
        const connection = (await this.graphql(COMMENTS_QUERY, { id: thread.id, after: cursor })).node.comments;
        comments.push(...connection.nodes);
        cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      }
      const resolver = !thread.isResolved ? null : thread.resolvedBy ? person(thread.resolvedBy.login) : bot.app ? { id: bot.id, username: bot.username } : null;
      result.push({
        id: thread.id + '#' + (comments[0]?.databaseId ?? ''),
        notes: comments.map((comment) => ({ id: comment.databaseId, body: comment.body || '', author: person(comment.author?.login), system: false, resolvable: true, resolved: thread.isResolved, resolved_by: resolver, created_at: comment.createdAt || '' })),
      });
    }
    return result;
  }

  // A thread on a line (position, as the GitLab client takes it: new_path,
  // new_line, head_sha), or else on a whole file (place: path, head_sha):
  // GitHub has no resolvable thread on a PR as a whole.
  async createDiscussion(number, body, position, place) {
    const target = position
      ? { commit_id: position.head_sha, path: position.new_path, line: position.new_line, side: 'RIGHT' }
      : place?.path ? { commit_id: place.head_sha, path: place.path, subject_type: 'file' } : null;
    if (!target) throw new Error('GitHub has no thread on a pull request as a whole, and no changed file was given to put this one on');
    const comment = await this.request('POST', this.repo('/pulls/' + number + '/comments'), { body, ...target });
    return { id: '#' + comment.id, notes: [{ id: comment.id }] };
  }

  replyDiscussion(number, discussionId, body) {
    const first = commentPart(discussionId);
    if (!first) throw new Error('thread ' + discussionId + ' has no first comment to reply to');
    return this.request('POST', this.repo('/pulls/' + number + '/comments/' + first + '/replies'), { body });
  }

  // GitHub resolves and reopens a thread only for a token that may also write
  // contents; the error says so.
  async resolveDiscussion(number, discussionId, resolved = true) {
    try {
      return await this.graphql(resolved ? RESOLVE : UNRESOLVE, { id: threadPart(discussionId) }, { mutation: true });
    } catch (error) {
      if (!/not accessible/i.test(error.message)) throw error;
      throw new Error(error.message + ' (a token resolves or reopens a review thread only with contents: write as well as pull-requests: write)', { cause: error });
    }
  }

  // As GitLab lists a merge request's commits: author_email, author_name.
  async mergeRequestCommits(number) {
    return (await this.paginate(this.repo('/pulls/' + number + '/commits'), 5)).map((commit) => ({ author_email: commit.commit?.author?.email || '', author_name: commit.commit?.author?.name || '' }));
  }
}

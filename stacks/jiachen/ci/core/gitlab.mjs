import { sendWithRetry } from './http.mjs';

// The GitLab REST API, in the shapes the rest of the pipeline reads. A PR is a
// merge request here; iid is its number within the project.
export class GitLab {
  // token: a bot or personal token. Jobs that run a model hold no such token and
  // pass the CI job token instead, which can read this project's job artifacts.
  constructor({ apiUrl, token, jobToken, projectId }) {
    this.apiUrl = String(apiUrl).replace(/\/$/, '');
    this.auth = token ? { 'PRIVATE-TOKEN': token } : { 'JOB-TOKEN': jobToken };
    this.projectId = projectId;
  }

  send(method, pathname, body) {
    return sendWithRetry('GitLab ' + method + ' ' + pathname.split('?')[0], this.apiUrl + pathname, {
      method,
      headers: { ...this.auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async request(method, pathname, body, { raw = false, allow404 = false } = {}) {
    const response = await this.send(method, pathname, body);
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text();
      throw new Error('GitLab ' + method + ' ' + pathname.split('?')[0] + ' -> ' + response.status + ': ' + text.slice(0, 400));
    }
    if (raw) return Buffer.from(await response.arrayBuffer());
    if (response.status === 204) return null;
    return response.json();
  }

  async paginate(pathname, maxPages = 30) {
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

  project(suffix) {
    return '/projects/' + encodeURIComponent(this.projectId) + suffix;
  }

  currentUser() {
    return this.request('GET', '/user');
  }

  mergeRequest(iid) {
    return this.request('GET', this.project('/merge_requests/' + iid));
  }

  notes(iid) {
    return this.paginate(this.project('/merge_requests/' + iid + '/notes?sort=asc&order_by=created_at'));
  }

  discussions(iid) {
    return this.paginate(this.project('/merge_requests/' + iid + '/discussions'));
  }

  discussion(iid, discussionId) {
    return this.request('GET', this.project('/merge_requests/' + iid + '/discussions/' + discussionId));
  }

  createNote(iid, body) {
    return this.request('POST', this.project('/merge_requests/' + iid + '/notes'), { body });
  }

  updateNote(iid, noteId, body) {
    return this.request('PUT', this.project('/merge_requests/' + iid + '/notes/' + noteId), { body });
  }

  // position: a line of the diff. Without one the thread is on the merge request
  // as a whole; GitLab needs no file for that, so the place the GitHub client
  // falls back to is not used here.
  createDiscussion(iid, body, position) {
    return this.request('POST', this.project('/merge_requests/' + iid + '/discussions'), position ? { body, position } : { body });
  }

  replyDiscussion(iid, discussionId, body) {
    return this.request('POST', this.project('/merge_requests/' + iid + '/discussions/' + discussionId + '/notes'), { body });
  }

  resolveDiscussion(iid, discussionId, resolved = true) {
    return this.request('PUT', this.project('/merge_requests/' + iid + '/discussions/' + discussionId + '?resolved=' + resolved));
  }

  mergeRequestCommits(iid) {
    return this.paginate(this.project('/merge_requests/' + iid + '/commits'), 5);
  }

  mergeRequestPipelines(iid) {
    return this.request('GET', this.project('/merge_requests/' + iid + '/pipelines?per_page=20'));
  }

  bridges(pipelineId) {
    return this.request('GET', this.project('/pipelines/' + pipelineId + '/bridges?per_page=100'));
  }

  jobs(pipelineId) {
    return this.request('GET', this.project('/pipelines/' + pipelineId + '/jobs?per_page=100'));
  }

  artifactFile(jobId, file) {
    return this.request('GET', this.project('/jobs/' + jobId + '/artifacts/' + file.split('/').map(encodeURIComponent).join('/')), undefined, { raw: true, allow404: true });
  }
}

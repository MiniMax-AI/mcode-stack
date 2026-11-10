import { GitHub } from './github.mjs';
import { GitLab } from './gitlab.mjs';
import { ConfigError } from './util.mjs';

// The code host a pipeline runs on, and everything the pipeline reads from its
// environment, as one context. GitHub Actions and GitLab CI name the same facts
// differently; the rest of the pipeline sees only this context and the client.
export const HOSTS = Object.freeze(['github', 'gitlab']);

// MCODE_REVIEW_HOST when it is set, else the CI system the job runs in.
export function detectHost(environment = process.env) {
  const value = String(environment.MCODE_REVIEW_HOST ?? '').trim().toLowerCase();
  if (value) {
    if (HOSTS.includes(value)) return value;
    throw new ConfigError('MCODE_REVIEW_HOST is "' + value.slice(0, 40) + '"; set it to github or gitlab.');
  }
  if (environment.GITHUB_ACTIONS === 'true') return 'github';
  if (environment.GITLAB_CI === 'true') return 'gitlab';
  throw new ConfigError('This is neither GitHub Actions nor GitLab CI: set MCODE_REVIEW_HOST to github or gitlab.');
}

// A link to a comment on the PR (kind note: the summary, the quiz) or to the
// first comment of a review thread (kind thread). Without an id, the PR itself.
// A plan written before plans named their host is a GitLab one.
export function commentLink(host, webUrl, id, kind = 'note') {
  if (!webUrl) return '';
  if (!id) return webUrl;
  if (host === 'github') return webUrl + (kind === 'thread' ? '#discussion_r' : '#issuecomment-') + id;
  return webUrl + '#note_' + id;
}

function reader(environment) {
  const get = (name, fallback = '') => {
    const value = environment[name];
    return value === undefined || value === '' ? fallback : String(value);
  };
  const need = (name) => {
    const value = get(name);
    if (!value) throw new Error('missing environment variable ' + name);
    return value;
  };
  const number = (name) => {
    const value = Number(need(name));
    if (!Number.isInteger(value) || value <= 0) throw new ConfigError(name + ' is "' + get(name).slice(0, 40) + '", which is not a PR number.');
    return value;
  };
  return { get, need, number };
}

// Every input of the pipeline that differs by host. Fields that a job may not
// have (the PR number, the API token) are read when they are used.
export function hostContext(environment = process.env) {
  const host = detectHost(environment);
  const { get, need, number } = reader(environment);
  const link = (webUrl, id, kind) => commentLink(host, webUrl, id, kind);
  if (host === 'github') {
    const server = get('GITHUB_SERVER_URL', 'https://github.com').replace(/\/$/, '');
    const repository = get('GITHUB_REPOSITORY');
    const runId = get('GITHUB_RUN_ID');
    const api = get('GITHUB_API_URL', 'https://api.github.com');
    return {
      host,
      name: 'GitHub',
      projectDir: get('GITHUB_WORKSPACE', process.cwd()),
      api,
      project: repository,
      number: () => number('MCODE_REVIEW_PR'),
      pipelineId: Number(runId) || 0,
      pipelineUrl: repository && runId ? server + '/' + repository + '/actions/runs/' + runId : '',
      // The PR head the workflow run is for.
      headSha: get('MCODE_REVIEW_HEAD_SHA'),
      cleanRemote: repository ? server + '/' + repository + '.git' : '',
      headRef: (n) => 'refs/pull/' + n + '/head',
      ref: (n) => '#' + n,
      link,
      // An issue or review comment holds at most 65,536 characters.
      commentLimit: 65536,
      templateFile: 'ci/github/mcode-review.yml',
      client: () => new GitHub({ apiUrl: api, graphqlUrl: get('GITHUB_GRAPHQL_URL', 'https://api.github.com/graphql'), token: need('MCODE_REVIEW_GITHUB_TOKEN'), repository: need('GITHUB_REPOSITORY'), botLogin: get('MCODE_REVIEW_BOT_LOGIN') }),
      // GitHub keeps no lens results of later rounds that never published.
      jobClient: () => null,
    };
  }
  const server = get('CI_SERVER_URL');
  const projectPath = get('CI_PROJECT_PATH');
  return {
    host,
    name: 'GitLab',
    projectDir: get('CI_PROJECT_DIR', process.cwd()),
    api: get('CI_API_V4_URL'),
    project: get('CI_PROJECT_ID'),
    number: () => number('CI_MERGE_REQUEST_IID'),
    pipelineId: Number(get('CI_PIPELINE_ID', '0')) || 0,
    pipelineUrl: get('CI_PIPELINE_URL'),
    headSha: get('CI_MERGE_REQUEST_SOURCE_BRANCH_SHA') || get('CI_COMMIT_SHA'),
    cleanRemote: server && projectPath ? server + '/' + projectPath + '.git' : '',
    headRef: (n) => 'refs/merge-requests/' + n + '/head',
    ref: (n) => '!' + n,
    link,
    // A note holds at most 1,000,000 characters.
    commentLimit: 1000000,
    templateFile: 'ci/gitlab/review.gitlab-ci.yml',
    client: () => new GitLab({ apiUrl: need('CI_API_V4_URL'), token: need('MCODE_REVIEW_GITLAB_TOKEN'), projectId: need('CI_PROJECT_ID') }),
    // Lens jobs hold no bot token; the CI job token reads this project's job
    // artifacts, the lens results of later rounds that never published.
    jobClient: () => (get('CI_JOB_TOKEN') ? new GitLab({ apiUrl: need('CI_API_V4_URL'), jobToken: get('CI_JOB_TOKEN'), projectId: need('CI_PROJECT_ID') }) : null),
  };
}

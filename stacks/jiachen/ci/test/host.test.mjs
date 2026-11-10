import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitHub } from '../core/github.mjs';
import { GitLab } from '../core/gitlab.mjs';
import { commentLink, detectHost, hostContext } from '../core/host.mjs';
import { ConfigError } from '../core/util.mjs';

test('the host is MCODE_REVIEW_HOST, else the CI system, else an error that says what to set', () => {
  assert.equal(detectHost({ MCODE_REVIEW_HOST: 'github' }), 'github');
  assert.equal(detectHost({ MCODE_REVIEW_HOST: ' GitLab ', GITHUB_ACTIONS: 'true' }), 'gitlab', 'the setting wins');
  assert.equal(detectHost({ GITHUB_ACTIONS: 'true' }), 'github');
  assert.equal(detectHost({ GITLAB_CI: 'true' }), 'gitlab');
  assert.throws(() => detectHost({}), (error) => error instanceof ConfigError && /set MCODE_REVIEW_HOST to github or gitlab/.test(error.message));
  assert.throws(() => detectHost({ MCODE_REVIEW_HOST: 'svn' }), /MCODE_REVIEW_HOST is "svn"; set it to github or gitlab/);
});

const GITHUB = { GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: '/work/app', GITHUB_REPOSITORY: 'acme/app', GITHUB_RUN_ID: '9876543210', MCODE_REVIEW_PR: '42', MCODE_REVIEW_HEAD_SHA: 'a'.repeat(40) };

test('GitHub: one context from the Actions environment, with the defaults of github.com', () => {
  const ctx = hostContext(GITHUB);
  assert.deepEqual([ctx.host, ctx.name, ctx.projectDir, ctx.api, ctx.project, ctx.number(), ctx.pipelineId, ctx.headSha], ['github', 'GitHub', '/work/app', 'https://api.github.com', 'acme/app', 42, 9876543210, 'a'.repeat(40)]);
  assert.equal(ctx.pipelineUrl, 'https://github.com/acme/app/actions/runs/9876543210');
  assert.equal(ctx.cleanRemote, 'https://github.com/acme/app.git');
  assert.deepEqual([ctx.headRef(42), ctx.ref(42), ctx.commentLimit, ctx.templateFile], ['refs/pull/42/head', '#42', 65536, 'ci/github/mcode-review.yml']);
  assert.equal(ctx.link('https://github.com/acme/app/pull/42', 7, 'note'), 'https://github.com/acme/app/pull/42#issuecomment-7');
  assert.equal(ctx.link('https://github.com/acme/app/pull/42', 8, 'thread'), 'https://github.com/acme/app/pull/42#discussion_r8');
  assert.equal(ctx.jobClient(), null, 'no reuse of unpublished lens results on GitHub');
  assert.throws(() => ctx.client(), /missing environment variable MCODE_REVIEW_GITHUB_TOKEN/);
  const client = hostContext({ ...GITHUB, MCODE_REVIEW_GITHUB_TOKEN: 't', MCODE_REVIEW_BOT_LOGIN: 'my-app[bot]' }).client();
  assert.ok(client instanceof GitHub);
  assert.deepEqual([client.owner, client.name, client.graphqlUrl, client.botLogin], ['acme', 'app', 'https://api.github.com/graphql', 'my-app[bot]']);
  assert.throws(() => hostContext({ ...GITHUB, MCODE_REVIEW_PR: 'abc' }).number(), (error) => error instanceof ConfigError && /MCODE_REVIEW_PR is "abc", which is not a PR number/.test(error.message));
});

test('GitHub Enterprise: the server and API addresses come from the environment', () => {
  const ctx = hostContext({ ...GITHUB, GITHUB_SERVER_URL: 'https://ghe.example/', GITHUB_API_URL: 'https://ghe.example/api/v3', GITHUB_GRAPHQL_URL: 'https://ghe.example/api/graphql', MCODE_REVIEW_GITHUB_TOKEN: 't' });
  assert.equal(ctx.cleanRemote, 'https://ghe.example/acme/app.git');
  assert.equal(ctx.pipelineUrl, 'https://ghe.example/acme/app/actions/runs/9876543210');
  assert.deepEqual([ctx.client().apiUrl, ctx.client().graphqlUrl], ['https://ghe.example/api/v3', 'https://ghe.example/api/graphql']);
});

test('GitLab: the same context from GitLab CI variables', () => {
  const env = { GITLAB_CI: 'true', CI_PROJECT_DIR: '/builds/g/p', CI_API_V4_URL: 'https://gitlab.example/api/v4', CI_PROJECT_ID: '12', CI_MERGE_REQUEST_IID: '5', CI_PIPELINE_ID: '777', CI_PIPELINE_URL: 'https://gitlab.example/g/p/-/pipelines/777', CI_SERVER_URL: 'https://gitlab.example', CI_PROJECT_PATH: 'g/p', CI_COMMIT_SHA: 'c'.repeat(40), CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: 'd'.repeat(40) };
  const ctx = hostContext(env);
  assert.deepEqual([ctx.host, ctx.name, ctx.projectDir, ctx.api, ctx.project, ctx.number(), ctx.pipelineId, ctx.pipelineUrl], ['gitlab', 'GitLab', '/builds/g/p', 'https://gitlab.example/api/v4', '12', 5, 777, 'https://gitlab.example/g/p/-/pipelines/777']);
  assert.equal(ctx.headSha, 'd'.repeat(40), 'the source branch head of a merged-results pipeline');
  assert.equal(hostContext({ ...env, CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: '' }).headSha, 'c'.repeat(40));
  assert.deepEqual([ctx.cleanRemote, ctx.headRef(5), ctx.ref(5), ctx.commentLimit, ctx.templateFile], ['https://gitlab.example/g/p.git', 'refs/merge-requests/5/head', '!5', 1000000, 'ci/gitlab/review.gitlab-ci.yml']);
  assert.equal(ctx.link('https://gitlab.example/g/p/-/merge_requests/5', 7, 'note'), 'https://gitlab.example/g/p/-/merge_requests/5#note_7');
  assert.equal(ctx.link('https://gitlab.example/g/p/-/merge_requests/5', 8, 'thread'), 'https://gitlab.example/g/p/-/merge_requests/5#note_8');
  assert.equal(ctx.jobClient(), null, 'no job token, no reuse');
  const jobs = hostContext({ ...env, CI_JOB_TOKEN: 'job' }).jobClient();
  assert.ok(jobs instanceof GitLab);
  assert.deepEqual(jobs.auth, { 'JOB-TOKEN': 'job' });
  assert.deepEqual(hostContext({ ...env, MCODE_REVIEW_GITLAB_TOKEN: 'bot' }).client().auth, { 'PRIVATE-TOKEN': 'bot' });
  assert.throws(() => ctx.client(), /missing environment variable MCODE_REVIEW_GITLAB_TOKEN/);
});

test('links: a plan written before plans named their host links as GitLab did, and no id links the PR', () => {
  assert.equal(commentLink(undefined, 'https://gitlab.example/g/p/-/merge_requests/5', 9), 'https://gitlab.example/g/p/-/merge_requests/5#note_9');
  assert.equal(commentLink('github', 'https://github.com/acme/app/pull/5', null), 'https://github.com/acme/app/pull/5');
  assert.equal(commentLink('github', '', 9), '');
});

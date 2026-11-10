import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitLab } from '../core/gitlab.mjs';

// Replaces fetch for one test. Each outcome is an error to throw or a response
// to return; every call is recorded.
function stubFetch(t, outcomes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(init.method + ' ' + new URL(url).pathname);
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = {} } = next || {};
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

// The shape Node's fetch throws when a connection fails.
const networkError = (code, message) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(message), { code }) });
const gitlab = () => new GitLab({ apiUrl: 'https://gitlab.example/api/v4', token: 't', projectId: '1' });

test('a read on a connection the server already closed is sent again', async (t) => {
  const calls = stubFetch(t, [networkError('UND_ERR_SOCKET', 'other side closed'), { body: { username: 'bot' } }]);
  assert.equal((await gitlab().currentUser()).username, 'bot');
  assert.equal(calls.length, 2);
});

test('a write is sent again only when the connection was gone before it was written', async (t) => {
  const calls = stubFetch(t, [networkError('EPIPE', 'write EPIPE'), { status: 201, body: { id: 1 } }]);
  assert.equal((await gitlab().createNote(5, 'x')).id, 1);
  assert.equal(calls.length, 2);

  const reset = stubFetch(t, [networkError('ECONNRESET', 'read ECONNRESET')]);
  await assert.rejects(gitlab().createNote(5, 'x'), /ECONNRESET: read ECONNRESET/);
  assert.equal(reset.length, 1, 'the server may have received it');
});

test('HTTP errors are not retried', async (t) => {
  const calls = stubFetch(t, [{ status: 500, body: { message: 'boom' } }]);
  await assert.rejects(gitlab().createNote(5, 'x'), /-> 500/);
  assert.equal(calls.length, 1);
});

test('after the last attempt the error names the cause', async (t) => {
  const closed = () => networkError('UND_ERR_SOCKET', 'other side closed');
  const calls = stubFetch(t, [closed(), closed(), closed()]);
  await assert.rejects(gitlab().currentUser(), /GitLab GET \/user: fetch failed \(UND_ERR_SOCKET: other side closed\)/);
  assert.equal(calls.length, 3);
});

test('a job without a bot token reads artifacts with the CI job token', async (t) => {
  let headers;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    headers = init.headers;
    return new Response(JSON.stringify({ status: 'complete' }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = original; });
  const buffer = await new GitLab({ apiUrl: 'https://gitlab.example/api/v4', jobToken: 'job', projectId: '1' }).artifactFile(9, '.mcode-review/out/lens-general.json');
  assert.equal(JSON.parse(buffer.toString('utf8')).status, 'complete');
  assert.deepEqual(headers, { 'JOB-TOKEN': 'job' });
});

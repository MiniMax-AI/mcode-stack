import { log } from './util.mjs';

// Errors from a request that never reached the server: the connection was
// already closed when the request was written. prepare blocks the event loop for
// minutes while it runs git, a proxy or the host drops the idle keep-alive
// connection meanwhile, and the next request reuses it. A read is retried on any
// network error; a write only on these, so a write the server may have received
// is never sent twice. HTTP errors are never retried.
const NOT_SENT = new Set(['UND_ERR_SOCKET', 'EPIPE']);
const ATTEMPTS = 3;

// label names the request in errors and logs, such as "GitLab GET /user".
// read: the request only reads (a GET, or a GraphQL query sent as a POST).
export async function sendWithRetry(label, url, init, { read = init.method === 'GET' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      const cause = error?.cause;
      const detail = label + ': ' + error.message + (cause ? ' (' + (cause.code || cause.name || 'cause') + ': ' + cause.message + ')' : '');
      const retry = error instanceof TypeError && attempt < ATTEMPTS && (read || NOT_SENT.has(cause?.code));
      if (!retry) throw new Error(detail, { cause: error });
      log(detail + '; retrying ' + attempt + '/' + (ATTEMPTS - 1));
      // Waiting also lets Node drop the dead connection before the retry.
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

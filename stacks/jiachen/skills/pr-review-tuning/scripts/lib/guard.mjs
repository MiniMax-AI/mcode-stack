// Loaded with node --import by backtest.mjs for prepare and publish: GitHub and
// GitLab may be read, never written. GET and HEAD pass, and POST to a GraphQL
// endpoint whose body is a query; anything else throws before it is sent.
const realFetch = globalThis.fetch;

export function allowed(method, url, body) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return true;
  if (verb !== 'POST' || !/\/graphql(?:$|[?#])/.test(String(url))) return false;
  try {
    const query = JSON.parse(String(body || '')).query || '';
    return typeof query === 'string' && !/^\s*mutation\b/.test(query.replace(/^\s*#.*$/gm, ''));
  } catch {
    return false;
  }
}

globalThis.fetch = async (input, init = {}) => {
  const method = init.method || (input && typeof input === 'object' && input.method) || 'GET';
  const url = String(input && typeof input === 'object' && input.url ? input.url : input);
  if (!allowed(method, url, init.body)) {
    const message = '[backtest guard] blocked ' + String(method).toUpperCase() + ' ' + url.split('?')[0];
    process.stderr.write(message + '\n');
    throw new Error(message);
  }
  return realFetch(input, init);
};

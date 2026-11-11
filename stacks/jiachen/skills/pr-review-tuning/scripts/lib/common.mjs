// Shared helpers for collect.mjs and backtest.mjs: tokens, a small HTTP client
// that only reads, and the hidden markers MCode Review writes into comments.
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

export const SUMMARY_MARKER = '<!-- mcode-review:summary -->';
const STATE_RE = /<!-- mcode-review:state ([A-Za-z0-9+/=]+) -->/;
const THREAD_RE = /<!-- mcode-review:thread ([A-Za-z0-9+/=]+) -->/;
export const QUIZ_META_RE = /<!--\s*mcode-author-quiz-meta:\s*\{/;
export const QUIZ_RESPONSE_RE = /<!--\s*mcode-author-quiz-meta-response:\s*\{/;

// Markers hold gzip + base64 JSON. A marker that does not decode is not one.
export function unpack(text) {
  try {
    return JSON.parse(gunzipSync(Buffer.from(text, 'base64')).toString('utf8'));
  } catch {
    return null;
  }
}

export function stateOf(body) {
  const match = String(body || '').match(STATE_RE);
  return match ? unpack(match[1]) : null;
}

export function threadMetaOf(body) {
  const match = String(body || '').match(THREAD_RE);
  return match ? unpack(match[1]) : null;
}

// GitHub REST says "github-actions[bot]", GraphQL says "github-actions": compare
// logins lowercased and without the suffix.
export function normLogin(login) {
  return login ? String(login).trim().toLowerCase().replace(/\[bot\]$/, '') : null;
}

// A human reply as short text: no hidden markers, no HTML, one line, 300 chars.
export function shortText(body) {
  return String(body || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function cli(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim().split('\n').pop().trim();
}

// The token for reading the host: --token, the environment, else the CLI's login.
export function resolveToken({ host, token, apiUrl }) {
  if (token) return token;
  if (host === 'github') return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || cli('gh', ['auth', 'token']);
  const hostname = new URL(apiUrl).hostname;
  return process.env.GITLAB_TOKEN || cli('glab', ['config', 'get', 'token', '--host', hostname]) || cli('glab', ['auth', 'token', '--hostname', hostname]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reads only: GET requests, and POST for GraphQL queries (never a mutation).
// Network errors and 5xx are retried a few times; 404 gives null.
export class Reader {
  constructor({ headers, attempts = 4, delayMs = 400 }) {
    this.headers = headers;
    this.attempts = attempts;
    this.delayMs = delayMs;
    this.calls = 0;
  }

  async request(url, { method = 'GET', body } = {}) {
    if (method !== 'GET' && !(method === 'POST' && body && !/^\s*mutation\b/.test(body.query || ''))) throw new Error('refusing to send ' + method + ' ' + url);
    let lastError = null;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      this.calls += 1;
      try {
        const response = await fetch(url, { method, headers: { ...this.headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        if (response.status === 404) return null;
        if (response.status >= 500) throw new Error(method + ' ' + url.split('?')[0] + ' -> ' + response.status);
        if (!response.ok) {
          const text = await response.text();
          const error = new Error(method + ' ' + url.split('?')[0] + ' -> ' + response.status + ': ' + text.slice(0, 300));
          error.fatal = true;
          throw error;
        }
        return response.json();
      } catch (error) {
        if (error.fatal) throw error;
        lastError = error;
        if (attempt < this.attempts) await sleep(this.delayMs * attempt);
      }
    }
    throw lastError;
  }

  async pages(url, { pageSize = 100, maxPages = 50, until } = {}) {
    const all = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const batch = await this.request(url + (url.includes('?') ? '&' : '?') + 'per_page=' + pageSize + '&page=' + page);
      if (!Array.isArray(batch) || !batch.length) break;
      all.push(...batch);
      if (batch.length < pageSize || (until && until(batch))) break;
    }
    return all;
  }
}

// Earlier PR numbers that a PR's title or description names as fixed, reverted
// or as the one that introduced the bug. Approximate: phrases in English and
// Chinese around a #123 or !123 reference. On GitLab only !123 names a merge
// request; on GitHub #123 may be an issue, so collect.mjs keeps only numbers that
// are PRs.
const REF = '(?:[\\w.-]+\\/[\\w.-]+)?([#!])(\\d+)';
const FIX_PATTERNS = [
  new RegExp('\\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?|revert(?:s|ed)?|regression (?:from|in|of|caused by)|introduced (?:by|in)|broken (?:by|in)|caused by|follow[- ]?up (?:to|of|for|on))\\s*:?\\s*(?:pr|mr|pull request|merge request)?\\s*' + REF, 'gi'),
  new RegExp('(?:修复|修正|回滚|还原|撤销|修)\\s*了?\\s*' + REF, 'g'),
  new RegExp('由\\s*' + REF + '\\s*(?:引入|带来|导致|造成)', 'g'),
  new RegExp(REF + '\\s*(?:引入|带来|导致|造成)的?', 'g'),
];

export function findFixes(text, { host, self } = {}) {
  const found = new Set();
  for (const pattern of FIX_PATTERNS) {
    for (const match of String(text || '').matchAll(pattern)) {
      const sigil = match[1];
      const number = Number(match[2]);
      if (!number || number === Number(self)) continue;
      if (host === 'gitlab' && sigil !== '!') continue;
      if (host === 'github' && sigil !== '#') continue;
      found.add(number);
    }
  }
  return [...found].sort((a, b) => a - b);
}

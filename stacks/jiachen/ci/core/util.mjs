import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

// A failure whose message says everything; the job log shows it without a stack.
export class ConfigError extends Error {}

export function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error('missing environment variable ' + name);
  return value;
}

export function log(...args) {
  console.log('[mcode-review]', ...args);
}

export function run(cmd, args, { cwd, input, allowFail = false, env: childEnv, timeoutMs } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    input,
    encoding: 'utf8',
    env: childEnv ?? process.env,
    maxBuffer: 512 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error && !allowFail) throw result.error;
  const code = result.status ?? -1;
  if (code !== 0 && !allowFail) {
    throw new Error(cmd + ' ' + args.join(' ') + ' exited ' + code + ': ' + String(result.stderr || '').slice(0, 2000));
  }
  return { code, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function packJson(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
}

export function unpackJson(text) {
  return JSON.parse(gunzipSync(Buffer.from(text, 'base64')).toString('utf8'));
}

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export function writeText(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value);
}

// Untrusted PR text goes into prompts as data: drop HTML comments, tags and
// invisible characters that can hide instructions.
export function sanitizeUntrusted(text) {
  return String(text ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
}

// Model output is posted by the bot: neutralise slash commands (GitLab quick
// actions), raw HTML and images so a prompt-injected model cannot act through
// the comment.
export function sanitizeForComment(text) {
  return String(text ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image removed]')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/^(\s*)\//gm, '$1\u200B/');
}

const REGEX_SPECIAL = new Set(['.', '+', '^', '$', '(', ')', '{', '}', '|', '[', ']', '\\']);

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        const alternatives = glob.slice(i + 1, end).split(',').map((part) => globToRegExp(part).source.slice(1, -1));
        re += '(?:' + alternatives.join('|') + ')';
        i = end;
        continue;
      }
    }
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += REGEX_SPECIAL.has(ch) ? '\\' + ch : ch;
    }
  }
  return new RegExp('^' + re + '$');
}

export function matchAny(file, globs = []) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

const CREDENTIAL_NAME_RE = /TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|JWT|AUTH|(^|_)KEY($|_)/i;

// GitLab injects every unscoped project and group variable into every job, so a
// model job can see far more than the model key. Treat every variable whose name
// looks like a credential as secret; public keys are meant to be seen.
export function credentialValues(variables = process.env) {
  return Object.entries(variables)
    .filter(([name, value]) => CREDENTIAL_NAME_RE.test(name) && !/PUBLIC_KEY$/i.test(name) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value);
}

// A model with a shell can read its job's variables. Strip their values from
// everything a model job writes, so a prompt-injected model cannot leak them
// through findings or quiz text.
export function redactSecrets(value, secrets) {
  const list = secrets.filter((secret) => secret && secret.length >= 8);
  if (!list.length) return value;
  let text = JSON.stringify(value);
  for (const secret of list) text = text.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]');
  return JSON.parse(text);
}

// The plugin version must be a commit. A branch or tag name would move the
// version under PRs that are already running.
export function pluginRefProblem(ref) {
  const value = String(ref ?? '').trim();
  if (/^[0-9a-f]{40}$/i.test(value)) return null;
  if (!value) return 'MCODE_REVIEW_PLUGIN_REF is not set. Set it, in the workflow file on GitHub or in the dispatch job on GitLab, to a 40-character commit SHA of the mcode-stack repository.';
  return 'MCODE_REVIEW_PLUGIN_REF is "' + value.slice(0, 80) + '", which is not a 40-character commit SHA. A branch or tag name would move the plugin version along with it; set it to a commit of mcode-stack.';
}

// The version of the CI files a project copies (ci/github/mcode-review.yml,
// ci/gitlab/review.gitlab-ci.yml). Each sets MCODE_REVIEW_TEMPLATE_VERSION to
// it; raise it whenever a copy from an older commit would no longer work with
// this code, and prepare tells the project to copy the file again.
export const TEMPLATE_VERSION = '1';

// file: the CI file in the plugin; ref: the plugin commit the job runs.
export function templateVersionProblem(value, { file, ref }) {
  const version = String(value ?? '').trim();
  if (version === TEMPLATE_VERSION) return null;
  return 'your copy of ' + file + ' is from another plugin version; copy it again from commit ' + (ref || 'MCODE_REVIEW_PLUGIN_REF') + '. Its MCODE_REVIEW_TEMPLATE_VERSION is ' + (version ? "'" + version.slice(0, 40) + "'" : 'missing') + "; this plugin needs '" + TEMPLATE_VERSION + "'.";
}

export function shortSha(sha) {
  return String(sha || '').slice(0, 10);
}

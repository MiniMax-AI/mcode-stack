import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { log, run } from './util.mjs';

// The registry fails now and then; retry a few times and keep npm's own
// error, which is the only clue when it does not recover.
export function installMcode({ prefix, version, registry, attempts = 3 }) {
  const bin = path.join(prefix, 'node_modules', '.bin', 'mcode');
  if (existsSync(bin)) return bin;
  mkdirSync(prefix, { recursive: true });
  const args = ['install', '--no-fund', '--no-audit', '--loglevel=error', '--prefix', prefix, '@minimax-ai/code@' + version, '--registry', registry];
  let error = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run('npm', args, { allowFail: true });
    if (result.code === 0 && existsSync(bin)) return bin;
    error = String(result.stderr || result.error || 'exit ' + result.code).trim().slice(-1500);
    log('npm install @minimax-ai/code@' + version + ' failed (attempt ' + attempt + '/' + attempts + '): ' + error.slice(-300));
  }
  throw new Error('npm install @minimax-ai/code@' + version + ' failed: ' + error);
}

// The runtime data dir holds a plugin built for the model jobs: mcode treats
// <data>/plugins/<name>/.claude-plugin/plugin.json as an enabled local plugin
// and loads the skills under its skills/. The stack in pluginDir holds other
// skills too; only the ones CI uses (skills) are copied, under plugin.name.
export function prepareRuntime({ root, pluginDir, plugin, skills }) {
  rmSync(root, { recursive: true, force: true });
  const dataDir = path.join(root, 'data');
  const home = path.join(root, 'home');
  for (const dir of [dataDir, home, path.join(home, '.config'), path.join(home, '.cache')]) mkdirSync(dir, { recursive: true });
  const target = path.join(dataDir, 'plugins', plugin.name);
  mkdirSync(path.join(target, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(target, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: plugin.name, version: plugin.version, description: plugin.description }, null, 2) + '\n');
  for (const skill of skills) cpSync(path.join(pluginDir, 'skills', skill), path.join(target, 'skills', skill), { recursive: true });
  return { root, dataDir, home, pluginDir: target };
}

// The gateway serves a model through more than one API. A model's spec in
// models.json names the API it is reached through ("api"); the provider's api is
// the default. Each API becomes its own custom provider in the runtime config.
export function providerIdFor(modelsConfig, model) {
  const provider = modelsConfig.provider;
  const api = modelsConfig.models?.[model]?.api || provider.api;
  return api === provider.api ? provider.id : provider.id + '-' + api;
}

export function writeRuntimeConfig({ file, apiKey, baseUrl, modelsConfig }) {
  const provider = modelsConfig.provider;
  const providers = {};
  for (const [id, spec] of Object.entries(modelsConfig.models)) {
    const api = spec.api || provider.api;
    const providerId = providerIdFor(modelsConfig, id);
    providers[providerId] ||= { name: provider.name + (api === provider.api ? '' : ' (' + api + ')'), api, options: { authMode: 'api-key', apiKey, baseURL: baseUrl, headers: provider.headers || {} }, models: {} };
    providers[providerId].models[id] = { name: id, reasoning: true, tool_call: true, limit: { context: spec.context, output: spec.output }, thinking: { effortOptions: spec.efforts } };
  }
  const first = Object.keys(modelsConfig.models)[0];
  const config = {
    custom_provider: providers,
    defaultModel: 'custom_provider:' + providerIdFor(modelsConfig, first) + '/' + first,
    permissionMode: 'default',
    // MCode up to 0.7.1: when tool output passes the 256 KiB watermark, the
    // automatic ToolResult archive strips thinking from kept assistant messages
    // for some model families, canonical history rejects the change, and the run
    // fails ("Canonical ToolResult compaction changed a non-result message").
    // Without the watermark archive a long run summarises at the token trigger
    // instead. Remove once the pinned MCode version carries the fix.
    toolResultCompaction: { enabled: false },
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

function childEnv(runtime, proxy) {
  const base = {
    PATH: process.env.PATH || '',
    HOME: runtime.home,
    XDG_CONFIG_HOME: path.join(runtime.home, '.config'),
    XDG_CACHE_HOME: path.join(runtime.home, '.cache'),
    MINIMAX_DATA_DIR: runtime.dataDir,
    MINIMAX_DISABLE_GIT_AUTO_CONFIG: '1',
    NO_COLOR: '1',
    LANG: process.env.LANG || 'C.UTF-8',
    NODE_USE_SYSTEM_CA: '1',
  };
  for (const key of ['SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'TMPDIR']) if (process.env[key]) base[key] = process.env[key];
  if (proxy) Object.assign(base, { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, NODE_USE_ENV_PROXY: '1', NO_PROXY: 'localhost,127.0.0.1,.svc,.cluster.local' });
  return base;
}

// The whole error message of the exec result when there is one: the repair
// request quotes it, and a schema mismatch lists every wrong field.
function failureText(result, out, exec) {
  if (exec?.error?.message) return String(exec.error.message);
  const fromEnvelope = String(result.stdout || '').match(/"message":"([^"]{1,600})/);
  if (fromEnvelope) return fromEnvelope[1];
  if (result.error) return String(result.error.message || result.error);
  return String(result.stderr || '').trim().slice(-600) || 'exit ' + result.code + (existsSync(out) ? '' : ', no output file');
}

// mcode exec --output-format json ends with an exec.result object; it carries
// the run's token usage when the provider reported it, failed runs included.
function execResult(stdout) {
  const text = String(stdout || '').trim();
  const candidates = [text, ...text.split('\n').reverse()];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value?.type === 'exec.result') return value;
    } catch {
      // not the result line
    }
  }
  return null;
}

export function usageOf(result) {
  const usage = result?.usage;
  if (!usage) return undefined;
  return { input: Number(usage.inputTokens) || 0, output: Number(usage.outputTokens) || 0, cache_read: Number(usage.cacheReadTokens) || 0 };
}

export function addUsage(...items) {
  const present = items.filter(Boolean);
  if (!present.length) return undefined;
  return present.reduce((sum, item) => ({ input: sum.input + (item.input || 0), output: sum.output + (item.output || 0), cache_read: sum.cache_read + (item.cache_read || 0) }), { input: 0, output: 0, cache_read: 0 });
}

// session continues an earlier run in the same runtime data directory.
// providerId is a provider id, or a function from a model to its provider id.
export function runExec({ bin, cwd, configFile, providerId, model, effort, prompt, schema, out, timeoutSec, runtime, proxy, session }) {
  rmSync(out, { force: true });
  const provider = typeof providerId === 'function' ? providerId(model) : providerId;
  const args = ['exec', ...(session ? ['--session', session] : []), '--cwd', cwd, '--config', configFile, '--model', 'custom_provider:' + provider + '/' + model, '--effort', effort,
    '--permission', 'full', '--timeout', timeoutSec + 's', '--output-format', 'json', '--output-schema', schema, '--output-last-message', out, '--input', '-'];
  const started = Date.now();
  const result = run(bin, args, { cwd, input: prompt, env: childEnv(runtime, proxy), allowFail: true, timeoutMs: (timeoutSec + 120) * 1000 });
  const durationMs = Date.now() - started;
  const exec = execResult(result.stdout);
  const meta = { durationMs, usage: usageOf(exec), sessionId: String(exec?.sessionId || ''), code: String(exec?.error?.code || ''), status: String(exec?.status || '') };
  if (result.code === 0 && existsSync(out)) {
    try {
      return { ok: true, data: JSON.parse(readFileSync(out, 'utf8')), ...meta };
    } catch (error) {
      return { ok: false, error: 'output is not JSON: ' + error.message, ...meta };
    }
  }
  return { ok: false, error: failureText(result, out, exec), ...meta };
}

// mcode checks the final answer against --output-schema with JSON.parse. A model
// that wraps the JSON in a code fence or adds a sentence fails the whole run,
// although its review is done and sits in the session. Asking once more in that
// session re-reads the cached context instead of redoing the review.
const STRUCTURED_OUTPUT_INVALID = 'STRUCTURED_OUTPUT_INVALID';
const TIMED_OUT = 'timeout';
const REPAIR_TIMEOUT_SEC = 300;

// A model fixes what it is told about, so the request quotes the whole
// validation message: an XL review by one model fixed its findings but not its
// needs_human item, whose errors came after the first 300 characters.
const REPAIR_ERROR_CHARS = 4000;

// mcode checks the answer against --output-schema but does not show the schema
// to the model, so every request that asks for the JSON again carries it.
const schemaBlock = (schemaText) => (schemaText ? '\n\nThe output schema:\n' + schemaText : '');

export function readSchemaText(file) {
  try {
    return JSON.stringify(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return '';
  }
}

export function repairPrompt(error, schemaText = '') {
  return 'Your previous reply could not be used: ' + String(error).slice(0, REPAIR_ERROR_CHARS) + '\n\nReply again with only the JSON object that matches the output schema. Fix every problem listed above: include every required property and no other properties. Use no Markdown code fence and no text before or after it. Keep the content of your previous answer; do not review again.' + schemaBlock(schemaText);
}

// A run that reached its timeout has usually done most of the work, and its
// session keeps it. Asked once in that session, the model answers from what it
// has already checked instead of the whole run being lost.
export function salvagePrompt(schemaText = '') {
  return 'Your time for this task is up. Stop investigating now and reply with only the JSON object that matches the output schema, built from what you have already checked: keep the findings and questions you confirmed, and leave out anything you did not get to check. Use no Markdown code fence and no text before or after it.' + schemaBlock(schemaText);
}

const CONNECTION_ERROR = /connection error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|proxy|stream_read_error|fetch failed/i;

// Try each model in the chain. A fast failure (rate limit, connection) moves on
// to the next model; a failure after most of the budget stops, so the job does
// not overrun its timeout. With a proxy configured, a connection error is
// retried once without the proxy first.
// Every attempt is recorded with its model, time and token usage, so a round's
// cost includes the attempts that failed.
// A run that timed out is asked once, in its session, for what it has found so
// far (see salvagePrompt); the result then carries salvaged: true, and the
// caller decides what a partial answer may do.
// validate(data) checks a schema-valid answer against rules a schema cannot
// express. It returns null for a usable answer, or the request to send: the
// model is asked once more in the same session, like a schema repair, and an
// answer that still fails counts as a failed attempt of that model.
export function runWithFallback({ chain, timeoutSec, proxy, validate, ...rest }) {
  const errors = [];
  const attempts = [];
  const record = (model, attempt, kind = '') => attempts.push({ model, ok: attempt.ok, seconds: Math.round(attempt.durationMs / 1000), ...(kind ? { [kind]: true } : {}), ...(attempt.usage ? { usage: attempt.usage } : {}) });
  const total = () => addUsage(...attempts.map((item) => item.usage));
  const schemaText = readSchemaText(rest.schema);
  for (const model of chain) {
    let via = proxy;
    let salvaged = false;
    let attempt = runExec({ ...rest, model, timeoutSec, proxy: via });
    if (!attempt.ok && proxy && CONNECTION_ERROR.test(attempt.error)) {
      record(model, attempt);
      log('model ' + model + ' failed through proxy (' + attempt.error.slice(0, 120) + '); retrying without proxy');
      via = '';
      attempt = runExec({ ...rest, model, timeoutSec, proxy: via });
    }
    record(model, attempt);
    if (!attempt.ok && attempt.status === TIMED_OUT && attempt.sessionId) {
      log('model ' + model + ' ran out of time; asking for what it has found so far in the same session.');
      const late = runExec({ ...rest, model, prompt: salvagePrompt(schemaText), session: attempt.sessionId, timeoutSec: Math.min(timeoutSec, REPAIR_TIMEOUT_SEC), proxy: via });
      record(model, late, 'salvage');
      salvaged = true;
      const durationMs = attempt.durationMs + late.durationMs;
      attempt = late.ok ? { ...late, durationMs } : { ...late, error: attempt.error + ' Asked for what it had found so far: ' + late.error, durationMs };
    }
    if (!attempt.ok && attempt.code === STRUCTURED_OUTPUT_INVALID && attempt.sessionId) {
      log('model ' + model + ': ' + attempt.error.slice(0, 160) + ' Asking again in the same session.');
      const repair = runExec({ ...rest, model, prompt: repairPrompt(attempt.error, schemaText), session: attempt.sessionId, timeoutSec: Math.min(timeoutSec, REPAIR_TIMEOUT_SEC), proxy: via });
      record(model, repair, 'repair');
      attempt = repair.ok ? { ...repair, durationMs: attempt.durationMs + repair.durationMs } : { ...repair, error: attempt.error + ' Asked again: ' + repair.error, durationMs: attempt.durationMs + repair.durationMs };
    }
    const request = attempt.ok && validate ? validate(attempt.data) : null;
    if (request) attempts.at(-1).rejected = true;
    if (request && attempt.sessionId) {
      log('model ' + model + ': the answer did not pass the checks. Asking for a rewrite in the same session.');
      const rewrite = runExec({ ...rest, model, prompt: request, session: attempt.sessionId, timeoutSec: Math.min(timeoutSec, REPAIR_TIMEOUT_SEC), proxy: via });
      record(model, rewrite, 'rewrite');
      const usable = rewrite.ok && !validate(rewrite.data);
      if (rewrite.ok && !usable) attempts.at(-1).rejected = true;
      const durationMs = attempt.durationMs + rewrite.durationMs;
      attempt = usable ? { ...rewrite, durationMs } : { ...rewrite, ok: false, error: 'the answer did not pass the checks, ' + (rewrite.ok ? 'nor did the rewrite' : 'and the rewrite failed: ' + rewrite.error), durationMs };
    } else if (request) {
      attempt = { ...attempt, ok: false, error: 'the answer did not pass the checks' };
    }
    if (attempt.ok) return { ...attempt, model, errors, attempts, usage: total(), ...(salvaged ? { salvaged: true } : {}) };
    errors.push(model + ': ' + attempt.error);
    log('model ' + model + ' failed: ' + attempt.error.slice(0, 300));
    if (attempt.durationMs > timeoutSec * 500) break;
  }
  return { ok: false, errors, attempts, usage: total() };
}

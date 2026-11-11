import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { addUsage, prepareRuntime, providerIdFor, repairPrompt, runWithFallback, usageOf, writeRuntimeConfig } from '../core/mcode.mjs';
import { readJson } from '../core/util.mjs';

test('the runtime config turns off the watermark ToolResult archive', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'mcode-review-cfg-')), 'config.json');
  writeRuntimeConfig({
    file,
    apiKey: 'k',
    baseUrl: 'https://gateway.example/v1',
    modelsConfig: { provider: { id: 'p', name: 'p', api: 'openai-responses' }, models: { m: { context: 1000, output: 100, efforts: ['high'] } } },
  });
  const config = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(config.toolResultCompaction, { enabled: false });
  assert.equal(config.defaultModel, 'custom_provider:p/m');
});

test('token usage comes from the exec result and adds up across attempts', () => {
  assert.deepEqual(usageOf({ type: 'exec.result', usage: { inputTokens: 18342, outputTokens: 2247, cacheReadTokens: 83077, totalTokens: 20589 } }), { input: 18342, output: 2247, cache_read: 83077 });
  assert.equal(usageOf({ type: 'exec.result', usageSource: 'unavailable' }), undefined);
  assert.deepEqual(addUsage({ input: 1, output: 2, cache_read: 3 }, undefined, { input: 10, output: 20, cache_read: 30 }), { input: 11, output: 22, cache_read: 33 });
  assert.equal(addUsage(undefined), undefined);
});

// A gateway can serve one model through more than one API, and translating a
// request from one API to another can fail. A model names the API it is reached
// through, and each API is its own provider.
test('each API the gateway is reached through becomes its own provider, and a model is called through its own', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'mcode-review-cfg-')), 'config.json');
  const modelsConfig = {
    provider: { id: 'p', name: 'gateway', api: 'openai-responses', headers: { 'X-Team': 's' } },
    models: { a: { api: 'anthropic-messages', context: 1000, output: 100, efforts: ['high'] }, b: { context: 1000, output: 100, efforts: ['high'] } },
  };
  writeRuntimeConfig({ file, apiKey: 'k', baseUrl: 'https://gateway.example/v1', modelsConfig });
  const config = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(config.custom_provider).sort(), ['p', 'p-anthropic-messages']);
  assert.equal(config.custom_provider['p-anthropic-messages'].api, 'anthropic-messages');
  assert.deepEqual(Object.keys(config.custom_provider['p-anthropic-messages'].models), ['a']);
  assert.deepEqual(Object.keys(config.custom_provider.p.models), ['b']);
  assert.equal(config.custom_provider['p-anthropic-messages'].options.headers['X-Team'], 's');
  assert.equal(config.custom_provider['p-anthropic-messages'].options.baseURL, 'https://gateway.example/v1');
  assert.equal(providerIdFor(modelsConfig, 'a'), 'p-anthropic-messages');
  assert.equal(providerIdFor(modelsConfig, 'b'), 'p');
  assert.equal(config.defaultModel, 'custom_provider:p-anthropic-messages/a');
});

test('every configured model names the API it is reached through', () => {
  const config = readJson(new URL('../config/models.json', import.meta.url));
  for (const [id, spec] of Object.entries(config.models)) assert.ok(['openai-responses', 'anthropic-messages'].includes(spec.api), id + ': ' + spec.api);
});

// A stand-in for mcode exec: it answers "unusable", except when it continues a
// session of the model named good.
function fakeMcode(dir) {
  const bin = path.join(dir, 'mcode');
  writeFileSync(bin, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    "const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');",
    "const model = flag('--model').split('/').pop();",
    "const session = flag('--session');",
    'fs.appendFileSync(' + JSON.stringify(path.join(dir, 'calls')) + ", model + ' ' + (session || '-') + '\\n');",
    "fs.writeFileSync(flag('--output-last-message'), JSON.stringify({ answer: session && model === 'good' ? 'usable' : 'unusable' }));",
    "console.log(JSON.stringify({ type: 'exec.result', sessionId: 's-' + model, usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0 } }));",
  ].join('\n'), { mode: 0o755 });
  return bin;
}

test('an answer that fails the checks is rewritten once in the same session; a second failure moves to the next model', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcode-review-exec-'));
  const seen = [];
  const result = runWithFallback({
    chain: ['bad', 'good'], effort: 'high', bin: fakeMcode(dir), cwd: dir, configFile: path.join(dir, 'config.json'), providerId: 'p', prompt: 'write the quiz',
    schema: path.join(dir, 'schema.json'), out: path.join(dir, 'out.json'), timeoutSec: 60, runtime: { home: dir, dataDir: dir }, proxy: '',
    validate: (data) => {
      seen.push(data.answer);
      return data.answer === 'usable' ? null : 'rewrite the rejected questions';
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'good');
  assert.deepEqual(result.data, { answer: 'usable' });
  assert.deepEqual(readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n'), ['bad -', 'bad s-bad', 'good -', 'good s-good']);
  assert.deepEqual(seen, ['unusable', 'unusable', 'unusable', 'usable']);
  assert.deepEqual(result.attempts.map((item) => [item.model, Boolean(item.rewrite), Boolean(item.rejected)]), [['bad', false, true], ['bad', true, true], ['good', false, true], ['good', true, false]]);
  assert.deepEqual(result.usage, { input: 40, output: 4, cache_read: 0 });
  assert.match(result.errors[0], /^bad: the answer did not pass the checks, nor did the rewrite/);
  const plain = runWithFallback({ chain: ['bad'], effort: 'high', bin: fakeMcode(dir), cwd: dir, configFile: path.join(dir, 'config.json'), providerId: 'p', prompt: 'x', schema: path.join(dir, 'schema.json'), out: path.join(dir, 'out.json'), timeoutSec: 60, runtime: { home: dir, dataDir: dir }, proxy: '' });
  assert.equal(plain.ok, true, 'without validate an answer is used as it is');
  assert.equal(plain.attempts.length, 1);
});

// A stand-in for mcode exec whose first run reaches its timeout; a call that
// continues the session answers. Every call's session and input is logged.
function timeoutOnceMcode(dir) {
  const bin = path.join(dir, 'mcode-timeout');
  writeFileSync(bin, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    "const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : '');",
    "const session = flag('--session');",
    "let input = ''; try { input = fs.readFileSync(0, 'utf8'); } catch {}",
    'fs.appendFileSync(' + JSON.stringify(path.join(dir, 'timeout-calls')) + ", JSON.stringify({ session, input }) + '\\n');",
    "if (!session) { console.log(JSON.stringify({ type: 'exec.result', status: 'timeout', sessionId: 's-1', error: { message: 'The run timed out. Increase --timeout or retry.' }, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 } })); process.exit(4); }",
    "fs.writeFileSync(flag('--output-last-message'), JSON.stringify({ answer: 'so far' }));",
    "console.log(JSON.stringify({ type: 'exec.result', status: 'succeeded', sessionId: 's-1', usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0 } }));",
  ].join('\n'), { mode: 0o755 });
  return bin;
}

test('a run that timed out is asked once, in its session and with the schema, for what it found so far', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcode-review-exec-'));
  const schema = path.join(dir, 'schema.json');
  writeFileSync(schema, JSON.stringify({ type: 'object', required: ['answer'] }, null, 2));
  const result = runWithFallback({ chain: ['m', 'other'], effort: 'high', bin: timeoutOnceMcode(dir), cwd: dir, configFile: path.join(dir, 'config.json'), providerId: 'p', prompt: 'review', schema, out: path.join(dir, 'out.json'), timeoutSec: 60, runtime: { home: dir, dataDir: dir }, proxy: '' });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'm', 'the model that ran out of time answers; the chain does not move on');
  assert.equal(result.salvaged, true);
  assert.deepEqual(result.data, { answer: 'so far' });
  assert.deepEqual(result.attempts.map((item) => [item.ok, Boolean(item.salvage)]), [[false, false], [true, true]]);
  assert.deepEqual(result.usage, { input: 105, output: 11, cache_read: 0 });
  const calls = readFileSync(path.join(dir, 'timeout-calls'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((call) => call.session), ['', 's-1']);
  assert.match(calls[1].input, /^Your time for this task is up/);
  assert.ok(calls[1].input.includes('{"type":"object","required":["answer"]}'), 'the schema, compact');
});

test('an answer that did not need rescuing is not marked salvaged, and the repair request quotes the schema', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcode-review-exec-'));
  const plain = runWithFallback({ chain: ['bad'], effort: 'high', bin: fakeMcode(dir), cwd: dir, configFile: path.join(dir, 'config.json'), providerId: 'p', prompt: 'x', schema: path.join(dir, 'missing.json'), out: path.join(dir, 'out.json'), timeoutSec: 60, runtime: { home: dir, dataDir: dir }, proxy: '' });
  assert.equal(plain.ok, true);
  assert.equal(plain.salvaged, undefined);
  assert.match(repairPrompt('bad answer', '{"x":1}'), /\n\nThe output schema:\n\{"x":1\}$/);
  assert.doesNotMatch(repairPrompt('bad answer'), /The output schema/, 'no schema text, no schema block');
});

// The stack holds skills CI does not use. The model jobs get a plugin of their
// own: a manifest under the name the prompts use, and the two skills CI uses.
test('the runtime plugin has a manifest of its own and only the skills CI uses', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'mcode-review-runtime-'));
  const stack = path.join(tmp, 'stack');
  for (const skill of ['pr-review', 'pr-quiz', 'making-content']) {
    mkdirSync(path.join(stack, 'skills', skill, 'references'), { recursive: true });
    writeFileSync(path.join(stack, 'skills', skill, 'SKILL.md'), '---\nname: ' + skill + '\n---\n');
    writeFileSync(path.join(stack, 'skills', skill, 'references', 'a.md'), 'a');
  }
  mkdirSync(path.join(stack, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(stack, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'stack' }));
  writeFileSync(path.join(stack, 'plugin.json'), JSON.stringify({ name: 'stack' }));
  const runtime = prepareRuntime({ root: path.join(tmp, 'runtime'), pluginDir: stack, plugin: { name: 'mcode-review', version: '0.2.0', description: 'review skills' }, skills: ['pr-review', 'pr-quiz'] });
  const target = path.join(runtime.dataDir, 'plugins', 'mcode-review');
  assert.equal(runtime.pluginDir, target);
  assert.deepEqual(readdirSync(path.join(runtime.dataDir, 'plugins')), ['mcode-review']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(target, '.claude-plugin', 'plugin.json'), 'utf8')), { name: 'mcode-review', version: '0.2.0', description: 'review skills' });
  assert.deepEqual(readdirSync(path.join(target, 'skills')).sort(), ['pr-quiz', 'pr-review']);
  assert.equal(readFileSync(path.join(target, 'skills', 'pr-review', 'references', 'a.md'), 'utf8'), 'a');
  assert.equal(existsSync(path.join(target, 'plugin.json')), false, 'no manifest of the stack');
  // The skills CI uses are in this stack.
  const real = fileURLToPath(new URL('../../skills/', import.meta.url));
  for (const skill of ['pr-review', 'pr-quiz']) assert.match(readFileSync(path.join(real, skill, 'SKILL.md'), 'utf8'), new RegExp('\\nname: ' + skill + '\\n'), skill);
});

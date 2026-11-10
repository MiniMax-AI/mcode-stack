import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickArm } from '../core/arms.mjs';
import { readJson } from '../core/util.mjs';

test('a PR keeps its arm, and arms follow their weights over many PRs', () => {
  const arms = [{ id: 'a', weight: 2 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }];
  assert.equal(pickArm(arms, 8123).id, pickArm(arms, 8123).id);
  const counts = { a: 0, b: 0, c: 0 };
  for (let iid = 1; iid <= 8000; iid += 1) counts[pickArm(arms, iid).id] += 1;
  assert.ok(Math.abs(counts.a / 8000 - 0.5) < 0.03, JSON.stringify(counts));
  assert.ok(Math.abs(counts.b / 8000 - 0.25) < 0.03, JSON.stringify(counts));
  assert.ok(Math.abs(counts.c / 8000 - 0.25) < 0.03, JSON.stringify(counts));
});

test('without arms the role chains apply', () => {
  assert.equal(pickArm(undefined, 1), null);
  assert.equal(pickArm([], 1), null);
  assert.equal(pickArm([{ id: 'off', weight: 0, lens: ['m'], verify: ['m'] }], 1), null);
});

// An arm with weight 0 is paused: it is never picked, and setting its weight
// again brings it back unchanged.
test('a paused arm is never picked', () => {
  const arms = [{ id: 'a+b', weight: 3, lens: ['a'], verify: ['b'] }, { id: 'b+a', weight: 0, lens: ['b'], verify: ['a'] }, { id: 'a+a', weight: 1, lens: ['a'], verify: ['a'] }];
  for (let iid = 1; iid <= 2000; iid += 1) assert.notEqual(pickArm(arms, iid).id, 'b+a', String(iid));
  const counts = { 'a+b': 0, 'a+a': 0 };
  for (let iid = 1; iid <= 4000; iid += 1) counts[pickArm(arms, iid).id] += 1;
  assert.ok(Math.abs(counts['a+b'] / 4000 - 0.75) < 0.03, JSON.stringify(counts));
});

// The shipped config runs one model for every role and splits nothing: every PR
// uses the role chains. README.md explains how to add models, chains and arms.
test('the shipped config: every role chain names configured models, each once, and there are no arms', () => {
  const config = readJson(new URL('../config/models.json', import.meta.url));
  assert.equal(config.arms, undefined);
  assert.equal(pickArm(config.arms, 1), null);
  for (const role of ['lens', 'verify', 'quiz']) {
    const chain = config.roles[role].chain;
    assert.ok(chain.length >= 1, role);
    assert.equal(new Set(chain).size, chain.length, role + ': ' + chain.join(' > '));
    for (const model of chain) assert.ok(config.models[model], role + ' uses unknown model ' + model);
    assert.ok(config.models[chain[0]].efforts.includes(config.roles[role].effort), role + ' effort');
  }
});

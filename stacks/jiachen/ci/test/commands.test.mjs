import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuizAnswers, shortFormAnswers } from '../core/commands.mjs';

test('quiz answers accept several common formats', () => {
  const answers = parseQuizAnswers('1A 2c\nQ3: 其他：会在 TTL 后清理', 3);
  assert.deepEqual(answers.get(0), { choice: 0 });
  assert.deepEqual(answers.get(1), { choice: 2 });
  assert.equal(answers.get(2).choice, 'other');
  assert.equal(parseQuizAnswers('第2题 B', 3).get(1).choice, 1);
  assert.equal(parseQuizAnswers('5A', 3).size, 0);
  assert.equal(parseQuizAnswers('q4: e', 4).get(3).choice, 4);
  assert.equal(parseQuizAnswers('10B', 10).get(9).choice, 1);
});

test('a reply counts as answers only when it is nothing but answers', () => {
  assert.deepEqual([...shortFormAnswers('1A 2C', 4)], [[0, { choice: 0 }], [1, { choice: 2 }]]);
  assert.equal(shortFormAnswers('答案：Q1 B，Q2 C。', 4).size, 2);
  assert.equal(shortFormAnswers('1-a, 2-b; 3-c', 4).size, 3);
  for (const text of ['fixed in 2a3b4c', 'LGTM 1A', '1A，另外第二题我不太确定', '', '   ', '看过了']) assert.equal(shortFormAnswers(text, 4), null, text);
});

test('answers in English read the same way, whatever the language setting', () => {
  assert.equal(parseQuizAnswers('Q3 B', 3).get(2).choice, 1);
  assert.equal(parseQuizAnswers('3. b', 3).get(2).choice, 1);
  const other = parseQuizAnswers('1A\n3 other: it is cleared after the TTL', 3);
  assert.deepEqual(other.get(2), { choice: 'other', text: 'it is cleared after the TTL' });
  assert.equal(parseQuizAnswers('Q2: Other - a different reason', 3).get(1).choice, 'other');
  assert.deepEqual([...shortFormAnswers('answers: 1A 2C', 4)], [[0, { choice: 0 }], [1, { choice: 2 }]]);
  assert.equal(shortFormAnswers('My answers: Q1 B, Q2 C.', 4).size, 2);
  assert.equal(shortFormAnswers('Answer: 3. b', 4).get(2).choice, 1);
  for (const text of ['answers: see the thread above', 'I think 1A is wrong', 'other: no idea']) assert.equal(shortFormAnswers(text, 4), null, text);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CLAIM_STATUSES, FINDING_CLASSES, FINDING_TYPES, INTRODUCED, NEEDS_HUMAN_KINDS, QUIZ_DIMENSIONS, SEVERITIES, VERIFY_VERDICTS } from '../core/vocab.mjs';

const schema = (name) => JSON.parse(readFileSync(new URL('../schema/' + name, import.meta.url), 'utf8'));

function enums(node, at = '$') {
  if (Array.isArray(node)) return node.flatMap((item, index) => enums(item, at + '[' + index + ']'));
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => (key === 'enum' ? [at] : enums(value, at + '.' + key)));
}

// mcode rejects the whole answer when one field misses an enum, which once threw
// away a lens's review for one needs_human kind. review.mjs maps such values to a
// default instead.
test('one unexpected value does not discard a whole answer: the schemas describe values without enforcing them', () => {
  for (const name of ['lens.schema.json', 'verify.schema.json', 'quiz.schema.json']) assert.deepEqual(enums(schema(name)), [], name);
});

test('the schemas describe exactly the values the pipeline accepts', () => {
  const lens = schema('lens.schema.json').properties;
  const finding = lens.findings.items.properties;
  const verify = schema('verify.schema.json').properties.results.items.properties;
  const quiz = schema('quiz.schema.json').properties.questions.items.properties;
  const cases = [
    [finding.severity, SEVERITIES], [finding.type, FINDING_TYPES], [finding.class, FINDING_CLASSES], [finding.introduced, INTRODUCED],
    [lens.needs_human.items.properties.kind, NEEDS_HUMAN_KINDS], [lens.claims.items.properties.status, CLAIM_STATUSES],
    [verify.verdict, VERIFY_VERDICTS], [verify.severity, SEVERITIES], [quiz.dimension, QUIZ_DIMENSIONS],
  ];
  for (const [field, values] of cases) assert.equal(field.description, 'One of: ' + values.join(', ') + '.');
});

test('every prompt asks for the bare JSON object, since mcode parses the final message as is', () => {
  for (const name of ['lens.md', 'verify.md', 'quiz.en.md', 'quiz.zh.md']) {
    const text = readFileSync(new URL('../prompts/' + name, import.meta.url), 'utf8');
    assert.match(text, /Your final message is only that JSON object: no Markdown code fence and no text before or after it\./, name);
  }
});

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_LANGUAGE, LANGUAGES, localize, MESSAGES, resolveLanguage, t } from '../core/i18n.mjs';

const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)(?::[^{}|]*\|[^{}]*)?\}/g)].map((found) => found[1]))].sort();

test('both catalogs have the same keys, and each message the same placeholders in both', () => {
  assert.deepEqual(LANGUAGES, ['en', 'zh']);
  assert.deepEqual(Object.keys(MESSAGES).sort(), [...LANGUAGES].sort());
  const keys = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(Object.keys(MESSAGES.zh).sort(), keys);
  for (const key of keys) {
    for (const lang of LANGUAGES) assert.equal(typeof MESSAGES[lang][key], 'string', lang + ' ' + key);
    assert.deepEqual(placeholders(MESSAGES.zh[key]), placeholders(MESSAGES.en[key]), key);
  }
});

test('every catalog key is used by the code that posts or prompts', () => {
  const core = new URL('../core/', import.meta.url);
  const sources = [readFileSync(new URL('../review.mjs', import.meta.url), 'utf8'), ...readdirSync(core).filter((name) => name.endsWith('.mjs') && name !== 'i18n.mjs').map((name) => readFileSync(new URL(name, core), 'utf8'))].join('\n');
  const unused = Object.keys(MESSAGES.en).filter((key) => !sources.includes("'" + key + "'"));
  assert.deepEqual(unused, []);
});

test('the English messages are English, and emoji and Markdown match the Chinese ones', () => {
  for (const [key, text] of Object.entries(MESSAGES.en)) assert.doesNotMatch(text, /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/, key);
  const marks = (text) => [...text.replace(/\{\w+:[^{}|]*\|[^{}]*\}/g, '').matchAll(/[✅🔧🙋⚠️]|\*\*|^#+ |<\/?(?:details|summary|sub)>|\|/gmu)].map((found) => found[0]).join('');
  for (const key of Object.keys(MESSAGES.en)) assert.equal(marks(MESSAGES.en[key]), marks(MESSAGES.zh[key]), key);
});

test('t fills in values and picks the English plural', () => {
  assert.equal(t('en', 'summary.counts', { blocking: 1, attention: 0, suggestions: 1, old: '' }), '1 blocking, 0 for a person, 1 suggestion.');
  assert.equal(t('en', 'summary.counts', { blocking: 0, attention: 2, suggestions: 3, old: t('en', 'summary.counts_old', { old: 2 }) }), '0 blocking, 2 for a person, 3 suggestions, plus 2 old issues.');
  assert.equal(t('zh', 'summary.counts', { blocking: 1, attention: 2, suggestions: 3, old: '' }), '1 个阻塞、2 个需人工确认、3 个建议。');
  assert.equal(t('en', 'summary.incomplete', { n: 1, which: 'general' }).includes('It has no new results'), true);
  assert.equal(t('en', 'summary.incomplete', { n: 2, which: 'a; b' }).includes('They have no new results'), true);
  assert.equal(t('en', 'quiz.answer', { answer: '$1 {x}' }), 'Answer: $1 {x}', 'values are inserted as they are');
  assert.equal(t('en', 'quiz.answer'), 'Answer: ', 'a missing value is empty');
  assert.equal(t('fr', 'verdict.pass'), '✅ Pass', 'an unknown language falls back to English');
  assert.throws(() => t('en', 'no.such.key'), /unknown message key no\.such\.key/);
});

test('the language setting: English by default, Chinese by its aliases, English with one log line otherwise', () => {
  const warnings = [];
  const warn = (line) => warnings.push(line);
  assert.equal(DEFAULT_LANGUAGE, 'en');
  for (const value of [undefined, null, '', '   ', 'en', 'EN', ' en ']) assert.equal(resolveLanguage(value, warn), 'en', String(value));
  for (const value of ['zh', 'ZH', 'zh-CN', 'zh-cn', 'zh-Hans', 'ZH-HANS', 'chinese', 'Chinese', ' zh ']) assert.equal(resolveLanguage(value, warn), 'zh', value);
  assert.deepEqual(warnings, []);
  assert.equal(resolveLanguage('fr', warn), 'en');
  assert.equal(resolveLanguage('zh-TW', warn), 'en');
  assert.deepEqual(warnings, ['MCODE_REVIEW_LANGUAGE is "fr", which is not en or zh; using en', 'MCODE_REVIEW_LANGUAGE is "zh-TW", which is not en or zh; using en']);
  assert.equal(resolveLanguage('english'), 'en', 'without a warn function nothing is logged');
});

test('localize reads a config value in one language or in several', () => {
  assert.equal(localize('Billing', 'zh'), 'Billing', 'a plain string is the same in every language');
  assert.deepEqual(localize(['Existing users?'], 'zh'), ['Existing users?']);
  const both = { en: 'Billing', zh: '计费' };
  assert.equal(localize(both, 'zh'), '计费');
  assert.equal(localize(both, 'en'), 'Billing');
  assert.equal(localize(both), 'Billing');
  assert.equal(localize({ zh: '计费', en: 'Billing' }, 'fr'), 'Billing', 'else English');
  assert.equal(localize({ zh: '计费' }, 'en'), '计费', 'else the first value');
  assert.deepEqual(localize({ en: ['a'], zh: ['甲'] }, 'zh'), ['甲']);
  assert.equal(localize(undefined, 'zh'), undefined);
  assert.equal(localize('', 'zh'), '');
});

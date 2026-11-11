// Answers the author writes in a comment, in English or Chinese, whatever the
// language setting.

// One answer: a question number and an option letter, as in "1A", "Q2: c",
// "第3题 B" or "4. d".
const answerPattern = () => /(?:[Qq]|第)?\s*(\d{1,2})\s*(?:题)?\s*[:：.、)）-]?\s*([A-Ea-e])(?![A-Za-z])/g;
// The free-form option: "3 other: ..." or "第3题 其他：...".
const otherPattern = () => /(?:[Qq]|第)?\s*(\d{1,2})\s*(?:题)?\s*[:：.、)）-]?\s*(?:其他|other)\s*[:：]?\s*([^\n]+)/gi;
// What may lead a reply of answers: "answers:", "my answers:", "答案：", "我的答案：".
const ANSWERS_PREFIX = /^(?:我的)?答案\s*[:：]?|^(?:my\s+)?answers?\s*[:：]?/i;

// Accepts "1A 2C", "Q1: B", "1. b"; "1 其他：..." or "1 other: ..." selects the
// free-form option.
export function parseQuizAnswers(text, questionCount) {
  const answers = new Map();
  const source = String(text || '');
  for (const match of source.matchAll(answerPattern())) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < questionCount && !answers.has(index)) answers.set(index, { choice: match[2].toUpperCase().charCodeAt(0) - 65 });
  }
  for (const match of source.matchAll(otherPattern())) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < questionCount) answers.set(index, { choice: 'other', text: match[2].trim().slice(0, 500) });
  }
  return answers;
}

// A comment that is nothing but answers in the short form, such as "1A 2C",
// "answers: Q1 B, Q2 C" or "答案：Q1 B，Q2 C". Anything else in it (a sentence, a
// commit hash) means it is not an answer: "fixed in 2a3b4c" must not read as
// three picks.
export function shortFormAnswers(text, questionCount) {
  const source = String(text || '').trim().replace(ANSWERS_PREFIX, '');
  if (!source.trim()) return null;
  const rest = source.replace(answerPattern(), ' ').replace(/[\s,，;；、。.]+/g, '');
  if (rest) return null;
  const answers = parseQuizAnswers(source, questionCount);
  return answers.size ? answers : null;
}

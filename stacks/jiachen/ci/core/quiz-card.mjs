// The Feishu group card of an author quiz. The author answers in the PR; the
// card lets the rest of the group try the questions too. Each question shows
// its options, and its answer and explanation sit in a panel that starts
// collapsed. core/feishu.mjs sends the card and updates it.

import { DEFAULT_LANGUAGE, t } from './i18n.mjs';

// Feishu rejects a card larger than 30 KB, when it is sent and when it is
// updated. With this cut, ten questions at the longest stem, options and
// explanation the quiz allows stay under it (ci/test/quiz-card.test.mjs).
export const CARD_EXPLANATION_CHARS = 300;

const letter = (index) => String.fromCharCode(65 + index);

const PLAIN_EMAIL = /^([a-z0-9._%+-]+)@([a-z0-9.-]+)$/;
const BOT_USER = /^(project|group)_\d+_bot(_|$)/;

// The emails that could @ mention the PR author in the card, best first. GitLab
// shows a bot no user's email, and the email Feishu knows is often not the one
// people commit with, so only Feishu can tell which one is right: it rejects a
// card with an email it does not know, and the next one is tried (see
// deliverFirstAccepted). Only domains from MCODE_REVIEW_FEISHU_EMAIL_DOMAINS
// count, except in the alias table. In order: the author's entry in the table;
// commit emails whose name part is the author's GitLab username; commit emails
// under that username as the author name; the username at each domain. A PR can
// hold other people's commits, so the most frequent email in it does not say who
// the author is. A project or group bot has no person behind its name, so its PR
// uses the commit email when one person made all the commits.
export function authorEmails({ username, commits, domains, aliases = new Map() }) {
  const user = String(username || '').toLowerCase();
  const allowed = (domains || []).map((domain) => String(domain).trim().toLowerCase()).filter(Boolean);
  if (!user || !allowed.length) return [];
  const listed = aliases.has(user) ? [aliases.get(user)] : [];
  const company = (commits || []).map((commit) => {
    const email = String(commit?.author_email || '').trim().toLowerCase();
    return { email, name: String(commit?.author_name || '').trim().toLowerCase(), match: PLAIN_EMAIL.exec(email) };
  }).filter(({ match }) => match && allowed.includes(match[2]));
  if (BOT_USER.test(user)) {
    const people = new Set(company.map(({ email }) => email));
    return people.size === 1 ? [...listed, ...people] : listed;
  }
  return [...new Set([
    ...listed,
    ...company.filter(({ match }) => match[1] === user).map(({ email }) => email),
    ...company.filter(({ name }) => name === user).map(({ email }) => email),
    ...allowed.map((domain) => user + '@' + domain).filter((email) => PLAIN_EMAIL.test(email)),
  ])];
}

// MCODE_REVIEW_FEISHU_EMAIL_ALIASES: "username=email,username=email", for authors
// whose contact email in Feishu cannot be worked out. The card only ever gets a
// plain email, so any other entry is dropped.
export function parseEmailAliases(text) {
  const aliases = new Map();
  for (const entry of String(text ?? '').split(',')) {
    const split = entry.indexOf('=');
    const name = entry.slice(0, split).trim().toLowerCase();
    const email = entry.slice(split + 1).trim().toLowerCase();
    if (split > 0 && name && PLAIN_EMAIL.test(email)) aliases.set(name, email);
  }
  return aliases;
}

function cut(text, max) {
  const chars = [...String(text ?? '')];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

// quiz: questions with options, and with correct_option_id and explanation
// when the answer key was read. ref: the PR as its host writes it, #42 on
// GitHub, !42 on GitLab.
export function quizCard({ iid, ref = '!' + iid, url, quiz, summary, mention = null }) {
  return {
    mr_iid: iid,
    ref,
    url,
    mention,
    answered: summary?.answeredCount || 0,
    total: quiz.questions.length,
    questions: quiz.questions.map((question) => {
      const correct = question.options.findIndex((option) => option.id === question.correct_option_id);
      return {
        prompt: question.prompt,
        options: question.options.map((option) => option.text),
        answer: correct >= 0 ? letter(correct) + '. ' + question.options[correct].text : '',
        explanation: cut(question.explanation, CARD_EXPLANATION_CHARS),
      };
    }),
  };
}

function answerPanel(question, lang) {
  return {
    tag: 'collapsible_panel',
    expanded: false,
    header: {
      title: { tag: 'plain_text', content: t(lang, 'card.show_answer') },
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '5px' },
    elements: [{ tag: 'markdown', content: t(lang, 'quiz.answer', { answer: question.answer }) + (question.explanation ? '\n' + question.explanation : '') }],
  };
}

export function renderCard(card, lang = DEFAULT_LANGUAGE) {
  const count = { answered: card.answered, total: card.total };
  const progress = card.mention
    ? '<at email=' + card.mention + '></at> ' + (card.answered ? t(lang, 'card.mention_answered', count) : t(lang, 'card.mention_unanswered'))
    : card.answered ? t(lang, 'card.answered', count) : t(lang, 'card.unanswered');
  const elements = [{ tag: 'markdown', content: progress }];
  card.questions.forEach((question, index) => {
    elements.push({ tag: 'markdown', content: '**Q' + (index + 1) + '. ' + question.prompt + '**\n' + question.options.map((option, optionIndex) => letter(optionIndex) + '. ' + option).join('\n') });
    if (question.answer) elements.push(answerPanel(question, lang));
  });
  elements.push({ tag: 'button', text: { tag: 'plain_text', content: t(lang, 'card.button') }, type: 'primary', behaviors: [{ type: 'open_url', default_url: card.url }] });
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: t(lang, 'card.title', { ref: card.ref || '!' + card.mr_iid }) },
      subtitle: { tag: 'plain_text', content: t(lang, 'card.subtitle') },
      template: 'blue',
    },
    body: { elements },
  };
}

import { DEFAULT_LANGUAGE, t } from './i18n.mjs';
import { isOldIssue } from './render.mjs';
import { packJson, sanitizeUntrusted, unpackJson } from './util.mjs';
import { sameQuestion } from './verdict.mjs';

// Every finding and every question for a person is one review thread, and the
// thread is the state. People answer in it and close it; each round the bot
// reads the threads back. A hidden marker in the bot's first note carries the
// id and what the bot needs to recognise the question again. Markers count only
// in notes written by the bot, so nobody can fake one.
const THREAD_RE = /<!-- mcode-review:thread ([A-Za-z0-9+/=]+) -->/;
const REPLY_RE = /<!-- mcode-review:reply ([\w-]+) -->/g;

export function threadMarker(meta) {
  return '<!-- mcode-review:thread ' + packJson(meta) + ' -->';
}

export function replyMarker(key) {
  return '<!-- mcode-review:reply ' + String(key).replace(/[^\w-]/g, '') + ' -->';
}

export function findingMeta(finding) {
  return { id: finding.id, kind: 'finding', title: String(finding.title || '').slice(0, 200), path: finding.path || '', line: finding.line || 0, severity: finding.severity, lens: finding.lens || '' };
}

export function questionMeta(item) {
  return {
    id: item.id,
    kind: item.kind,
    source: item.source,
    title: String(item.title || '').slice(0, 200),
    questions: (item.questions || []).slice(0, 4).map((question) => String(question).slice(0, 300)),
    paths: (item.paths || []).slice(0, 20),
    lens: item.lens || '',
  };
}

export function readThreadIndex(discussions, botId) {
  const index = new Map();
  for (const discussion of discussions || []) {
    const notes = (discussion.notes || []).filter((note) => !note.system);
    const first = notes[0];
    if (!first || first.author?.id !== botId) continue;
    const match = String(first.body || '').match(THREAD_RE);
    if (!match) continue;
    let meta;
    try {
      meta = unpackJson(match[1]);
    } catch {
      continue;
    }
    if (!meta?.id || index.has(meta.id)) continue;
    const resolvable = notes.filter((note) => note.resolvable);
    const resolved = resolvable.length > 0 && resolvable.every((note) => note.resolved);
    const resolver = resolved ? first.resolved_by || resolvable.find((note) => note.resolved_by)?.resolved_by || null : null;
    const replies = notes.slice(1);
    index.set(meta.id, {
      id: meta.id,
      meta,
      discussionId: discussion.id,
      noteId: first.id,
      resolved,
      resolvedBy: resolver ? { id: resolver.id, username: resolver.username || '' } : null,
      resolvedByBot: Boolean(resolver && resolver.id === botId),
      replyKeys: new Set(replies.filter((note) => note.author?.id === botId).flatMap((note) => [...String(note.body || '').matchAll(REPLY_RE)].map((found) => found[1]))),
      humanReplies: replies.filter((note) => note.author?.id !== botId).map((note) => ({ by: note.author?.username || '', byId: note.author?.id ?? null, text: String(note.body || ''), at: note.created_at || '' })),
    });
  }
  return index;
}

const CLEARED = {
  'NH-desc': 'thread.cleared.desc',
  'NH-ui': 'thread.cleared.ui',
  'NH-incomplete': 'thread.cleared.incomplete',
  'NH-rounds': 'thread.cleared.rounds',
};

export function clearedReason(id, lang = DEFAULT_LANGUAGE) {
  if (id.startsWith('NH-risk-')) return t(lang, 'thread.cleared.risk');
  if (id.startsWith('NH-sev-')) return t(lang, 'thread.cleared.severity');
  return t(lang, CLEARED[id] || 'thread.cleared.other');
}

// Findings: a new P0 or P1 always gets a thread (not on a line when its line
// cannot be anchored), a new P2 only on an added line and at most a few per round. A
// thread the bot closed reopens when the problem comes back. A thread a person
// closed means dismissed: never reopened, and the finding stops counting.
// An open thread whose finding is missing closes only when canClose says a lens
// responsible for it actually looked again; a lens that failed proves nothing.
// Findings carried over unchecked never open a new thread: their line numbers
// belong to an older version of the file.
export function planFindingThreads({ findings, index, anchorable, headShort, maxNewSuggestions = 5, canClose = () => true, lang = DEFAULT_LANGUAGE }) {
  const actions = [];
  const dismissed = [];
  let newSuggestions = 0;
  for (const finding of findings) {
    const thread = index.get(finding.id);
    if (thread) {
      if (!thread.resolved) continue;
      if (thread.resolvedByBot) actions.push({ type: 'reopen', id: finding.id, reply: t(lang, 'thread.reopen_finding', { head: headShort }) });
      else dismissed.push({ finding, thread });
      continue;
    }
    if (isOldIssue(finding) || finding.carried) continue;
    const anchored = Boolean(anchorable(finding));
    if (finding.severity === 'P2') {
      if (!anchored || newSuggestions >= maxNewSuggestions) continue;
      newSuggestions += 1;
    } else if (finding.severity !== 'P0' && finding.severity !== 'P1') {
      continue;
    }
    actions.push({ type: 'create', id: finding.id, finding, anchored });
  }
  const present = new Set(findings.map((finding) => finding.id));
  for (const thread of index.values()) {
    if (thread.meta.kind !== 'finding' || thread.resolved || present.has(thread.id) || !canClose(thread)) continue;
    actions.push({ type: 'resolve', id: thread.id, reply: t(lang, 'thread.resolve_finding', { head: headShort }) });
  }
  return { actions, dismissed };
}

// Questions. Rule questions (risk path, description, review incomplete) are a
// thread while their condition holds; the bot closes them when it clears and
// reopens only the ones it closed itself. Model questions are posted once: the
// lens prompt lists what was already asked, and a new question of the same kind
// on the same files as a still-open question goes into that thread as a reply.
export function planQuestionThreads({ conditionItems, modelItems, index, headShort, lang = DEFAULT_LANGUAGE }) {
  const actions = [];
  const holding = new Set(conditionItems.map((item) => item.id));
  for (const item of conditionItems) {
    const thread = index.get(item.id);
    if (!thread) actions.push({ type: 'create', id: item.id, item });
    else if (thread.resolved && thread.resolvedByBot) actions.push({ type: 'reopen', id: item.id, reply: t(lang, 'thread.reopen_question', { head: headShort, title: item.title }) });
  }
  for (const thread of index.values()) {
    if (thread.meta.source !== 'condition' || thread.resolved || holding.has(thread.id)) continue;
    actions.push({ type: 'resolve', id: thread.id, reply: clearedReason(thread.id, lang) });
  }
  for (const item of modelItems) {
    if (index.has(item.id)) continue;
    const twin = [...index.values()].find((thread) => thread.meta.source === 'model' && !thread.resolved && sameQuestion(thread.meta, item));
    if (twin) {
      if (!twin.replyKeys.has(item.id) && !actions.some((action) => action.type === 'reply' && action.key === item.id)) actions.push({ type: 'reply', id: twin.id, key: item.id, item });
      continue;
    }
    actions.push({ type: 'create', id: item.id, item });
  }
  return actions;
}

// Questions still waiting for a person after this round's actions.
export function openQuestions(index, actions) {
  const resolving = new Set(actions.filter((action) => action.type === 'resolve').map((action) => action.id));
  const reopening = new Set(actions.filter((action) => action.type === 'reopen').map((action) => action.id));
  const open = [];
  for (const thread of index.values()) {
    if (thread.meta.kind === 'finding') continue;
    if ((thread.resolved && !reopening.has(thread.id)) || resolving.has(thread.id)) continue;
    open.push({ id: thread.id, title: thread.meta.title, source: thread.meta.source, noteId: thread.noteId, replies: thread.humanReplies.length, resolved: false });
  }
  for (const action of actions) {
    if (action.type === 'create' && action.item) open.push({ id: action.id, title: action.item.title, source: action.item.source, noteId: null, replies: 0, created: true, resolved: false });
  }
  return open;
}

// Questions a person closed, for the approver: who closed what.
export function closedQuestions(index, authorId) {
  return [...index.values()]
    .filter((thread) => thread.meta.kind !== 'finding' && thread.resolved && !thread.resolvedByBot)
    .map((thread) => ({ id: thread.id, title: thread.meta.title, by: thread.resolvedBy?.username || '', byAuthor: authorId !== undefined && authorId !== null && thread.resolvedBy?.id === authorId }));
}

// What the lens prompt sees: questions already asked (open or closed by a
// person) with the latest replies, and findings a person closed. Replies are
// untrusted text.
export function askedForPrompt(index, authorId, limit = 30) {
  const replies = (thread) => thread.humanReplies.slice(-2).map((reply) => ({ by: reply.by + (authorId !== undefined && reply.byId === authorId ? ' (PR author)' : ''), text: sanitizeUntrusted(reply.text).replace(/\s+/g, ' ').trim().slice(0, 500) }));
  const closer = (thread) => thread.resolvedBy?.username || 'someone';
  const questions = [];
  const closedFindings = [];
  for (const thread of index.values()) {
    if (thread.meta.kind === 'finding') {
      if (thread.resolved && !thread.resolvedByBot) closedFindings.push({ id: thread.id, title: thread.meta.title, path: thread.meta.path || '', closed_by: closer(thread), replies: replies(thread) });
      continue;
    }
    if (thread.resolved && thread.resolvedByBot) continue;
    questions.push({ id: thread.id, title: thread.meta.title, questions: thread.meta.questions || [], status: thread.resolved ? 'closed' : 'open', closed_by: thread.resolved ? closer(thread) : '', replies: replies(thread) });
  }
  return { questions: questions.slice(-limit), closed_findings: closedFindings.slice(-limit) };
}

export function renderAsked(asked) {
  const questions = asked?.questions || [];
  const closed = asked?.closed_findings || [];
  if (!questions.length && !closed.length) return '(none)';
  const lines = [];
  for (const item of questions) {
    lines.push('- ' + item.id + ' [' + (item.status === 'open' ? 'open' : 'closed by ' + item.closed_by) + '] ' + item.title + (item.questions?.length ? ' Questions: ' + item.questions.join(' / ') : ''));
    for (const reply of item.replies || []) lines.push('  reply from ' + reply.by + ': ' + reply.text);
  }
  if (closed.length) {
    lines.push('', 'Findings a person closed without a code change:');
    for (const item of closed) {
      lines.push('- ' + item.id + ' ' + item.title + ' (' + item.path + ', closed by ' + item.closed_by + ')');
      for (const reply of item.replies || []) lines.push('  reply from ' + reply.by + ': ' + reply.text);
    }
  }
  return lines.join('\n');
}

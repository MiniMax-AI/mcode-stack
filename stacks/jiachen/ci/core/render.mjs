import { commentLink } from './host.mjs';
import { DEFAULT_LANGUAGE, t } from './i18n.mjs';
import { isBlocking } from './verdict.mjs';
import { sanitizeForComment, shortSha } from './util.mjs';

// Message keys of the labels, so every key stays a literal in the code.
const VERDICT_KEY = { pass: 'verdict.pass', request_changes: 'verdict.request_changes', needs_human: 'verdict.needs_human' };
const TYPE_KEY = { defect: 'type.defect', leftover: 'type.leftover', maintainability: 'type.maintainability' };
const TYPE_ORDER = { defect: 0, leftover: 1, maintainability: 2 };
const LENS_KEY = { general: 'lens.general', behavior: 'lens.behavior', contracts: 'lens.contracts', security: 'lens.security', 'cross-feature': 'lens.cross-feature', duplication: 'lens.duplication' };

const clean = (text, max = 1200) => {
  const value = sanitizeForComment(text).trim();
  return value.length > max ? value.slice(0, max) + '…' : value;
};

// One line, no backticks: for paths, titles in links and quoted reasons.
const plain = (text, max = 200) => clean(text, max).replace(/\x60+/g, '').replace(/\s*[\r\n]+\s*/g, ' ');


const count = (value) => Number(value || 0).toLocaleString('en-US');

function questionLine(plan, item, lang) {
  const title = plain(item.title, 200).replace(/[[\]]/g, '');
  const url = item.noteId && plan.mr?.web_url ? commentLink(plan.host, plan.mr.web_url, item.noteId, 'thread') : '';
  const notes = [item.id];
  if (item.replies) notes.push(t(lang, 'summary.replies', { n: item.replies }));
  if (item.created) notes.push(t(lang, 'summary.new_question'));
  return '- ' + (url ? '[' + title + '](' + url + ')' : '**' + title + '**') + t(lang, 'paren', { text: notes.join(t(lang, 'comma')) });
}

function severityTag(finding, lang) {
  return finding.severity + (TYPE_KEY[finding.type] ? '·' + t(lang, TYPE_KEY[finding.type]) : '');
}

export function isOldIssue(finding) {
  return Boolean(finding.found_late) && finding.severity === 'P2';
}

export function lensLabel(lens, lang = DEFAULT_LANGUAGE) {
  return LENS_KEY[lens] ? t(lang, LENS_KEY[lens]) : lens;
}

// What to say to the pr-review skill locally to redo the lenses that did not
// finish. The skill maps the lens labels of either language to its checklists.
// The target branch is named because the skill otherwise diffs against the
// remote default branch, which is not the base of a PR into dev or a feature
// branch.
export function localReviewAsk(lenses, targetBranch, lang = DEFAULT_LANGUAGE) {
  const named = lenses.filter((lens) => lens !== 'general');
  const ask = named.length ? t(lang, 'local.ask_lenses', { lenses: named.map((lens) => lensLabel(lens, lang)).join(t(lang, 'list')) }) : t(lang, 'local.ask');
  return targetBranch ? t(lang, 'local.ask_target', { ask, branch: plain(targetBranch, 100) }) : ask;
}

// A lens that did not finish (the model call failed, or the job left no result)
// can be finished by the author: the same skill runs locally on their own model.
function localReviewHint(plan, incomplete, lang) {
  const guide = plan.plugin?.homepage ? t(lang, 'local.guide_link', { url: plan.plugin.homepage }) : t(lang, 'local.guide');
  return t(lang, 'local.hint', { guide, ask: localReviewAsk(incomplete.map((item) => item.lens), plan.mr?.target_branch, lang) });
}

function findingLine(finding, index, lang) {
  const where = finding.path ? '\x60' + finding.path + (finding.line ? ':' + finding.line : '') + '\x60' : '';
  const flags = [];
  if (finding.verifier === 'confirmed') flags.push(t(lang, 'flag.confirmed'));
  if (finding.verifier === 'unverified') flags.push(t(lang, 'flag.unverified'));
  if (finding.severity_pending) flags.push(t(lang, 'flag.severity_pending'));
  if (finding.introduced === 'pre_existing') flags.push(t(lang, 'flag.pre_existing'));
  if (finding.also?.length) flags.push(t(lang, 'flag.also', { ids: finding.also.join(t(lang, 'list')) }));
  if (finding.found_late) flags.push(t(lang, 'flag.found_late'));
  if (finding.carried) flags.push(t(lang, 'flag.carried'));
  const details = [finding.id, lensLabel(finding.lens, lang), ...flags].join(t(lang, 'comma'));
  return t(lang, 'summary.finding_line', { n: index + 1, tag: severityTag(finding, lang), title: clean(finding.title, 200), details, where }).trimEnd();
}

// The quiz line of the summary. quiz: { url, status } for the current quiz,
// failed when this round could not write one, legacy for a sealed quiz of a
// plugin version before 0.7.0.
function quizLine(quiz, lang) {
  if (quiz.legacy) return t(lang, 'summary.quiz.legacy', { url: quiz.url });
  if (!quiz.url) return t(lang, 'summary.quiz.none');
  return t(lang, 'summary.quiz.current', { url: quiz.url, status: quiz.status }) + (quiz.failed ? t(lang, 'summary.quiz.retry') : '');
}

export function renderSummary(ctx) {
  const { plan, verdict, findings, attention, closed = [], dismissed, quiz, round, consecutive, lensStatus, reusedFileCount, phase, incomplete = [], usage, lang = DEFAULT_LANGUAGE } = ctx;
  const blocking = findings.filter(isBlocking);
  const sorted = findings.filter((finding) => !isBlocking(finding))
    .sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || (TYPE_ORDER[a.type] ?? 0) - (TYPE_ORDER[b.type] ?? 0));
  // P2s that were already in the code the last round reviewed go to a list of
  // old issues, so a fix round can close without chasing them.
  const old = sorted.filter(isOldIssue);
  const others = sorted.filter((finding) => !isOldIssue(finding));
  const lines = ['<!-- mcode-review:summary -->'];
  const phaseNote = phase === 'shadow' ? t(lang, 'summary.phase.shadow') : '';
  lines.push(t(lang, 'summary.title', { verdict: t(lang, VERDICT_KEY[verdict.verdict]), phase: phaseNote }), '');
  if (!blocking.length && !attention.length && !others.length && !old.length) lines.push(t(lang, 'summary.nothing'));
  else lines.push(t(lang, 'summary.counts', { blocking: blocking.length, attention: attention.length, suggestions: others.length, old: old.length ? t(lang, 'summary.counts_old', { old: old.length }) : '' }));
  const reuse = reusedFileCount ? t(lang, 'summary.reused', { n: reusedFileCount }) : '';
  lines.push('', t(lang, 'summary.reviewed', { sha: shortSha(plan.head_sha), round, tier: plan.tier, reused: reuse }));
  if (incomplete.length) {
    const which = incomplete.map((item) => lensLabel(item.lens, lang) + (item.error ? t(lang, 'paren', { text: plain(item.error, 120) }) : '')).join(t(lang, 'semicolon'));
    lines.push('', t(lang, 'summary.incomplete', { n: incomplete.length, which }), '', localReviewHint(plan, incomplete, lang));
  }
  if (blocking.length) {
    lines.push('', t(lang, 'summary.blocking'));
    blocking.forEach((finding, index) => lines.push(findingLine(finding, index, lang)));
  }
  if (attention.length) {
    lines.push('', t(lang, 'summary.attention'));
    attention.slice(0, 6).forEach((item) => lines.push(questionLine(plan, item, lang)));
    if (attention.length > 6) {
      lines.push('', t(lang, 'summary.more_questions', { n: attention.length - 6 }), '');
      attention.slice(6).forEach((item) => lines.push(questionLine(plan, item, lang)));
      lines.push('', '</details>');
    }
    lines.push('', t(lang, 'summary.attention_hint'));
  }
  if (others.length) {
    lines.push('', t(lang, 'summary.suggestions'));
    others.slice(0, 5).forEach((finding, index) => lines.push(findingLine(finding, index, lang)));
    if (others.length > 5) {
      lines.push('', t(lang, 'summary.more_suggestions', { n: others.length - 5 }), '');
      others.slice(5).forEach((finding, index) => lines.push(findingLine(finding, index + 5, lang)));
      lines.push('', '</details>');
    }
  }
  if (old.length) {
    lines.push('', t(lang, 'summary.old', { n: old.length }), '');
    old.forEach((finding, index) => lines.push(findingLine(finding, index, lang)));
    lines.push('', '</details>');
  }
  if (dismissed.length) {
    lines.push('', t(lang, 'summary.dismissed'));
    for (const item of dismissed) lines.push(t(lang, 'summary.dismissed_line', { id: item.id, title: clean(item.title, 120), by: item.by || '?', reason: item.reason ? t(lang, 'summary.dismissed_reason', { reason: plain(item.reason, 200) }) : '' }));
  }
  if (closed.length) {
    lines.push('', t(lang, 'summary.closed', { n: closed.length }), '');
    for (const item of closed) lines.push(t(lang, 'summary.closed_line', { title: clean(item.title, 160), id: item.id, by: item.by || '?', author: item.byAuthor ? t(lang, 'summary.closed_by_author') : '' }));
    lines.push('', '</details>');
  }
  if (quiz) lines.push('', t(lang, 'quiz.heading'), '', quizLine(quiz, lang));
  lines.push('', t(lang, 'summary.disagree'));
  lines.push('', t(lang, 'summary.details'), '');
  lines.push(t(lang, 'summary.table_head'), '| --- | --- |');
  lines.push(t(lang, 'summary.row.commit', { sha: plan.head_sha, base: shortSha(plan.base_sha) }));
  lines.push(t(lang, 'summary.row.tier', { tier: plan.tier, files: plan.files.length }));
  lines.push(t(lang, 'summary.row.lenses', { lenses: lensStatus.map((item) => lensLabel(item.lens, lang) + ' ' + item.status).join(t(lang, 'semicolon')) }));
  lines.push(t(lang, 'summary.row.round', { round, consecutive }));
  if (plan.models?.arm) lines.push(t(lang, 'summary.row.arm', { arm: plan.models.arm, lens: plan.models.lens[0], verify: plan.models.verify[0] }));
  if (usage) lines.push(t(lang, 'summary.row.tokens', { input: count(usage.input), output: count(usage.output), cache: count(usage.cache_read) }));
  if (plan.risk.length) lines.push(t(lang, 'summary.row.risk', { names: plan.risk.map((hit) => hit.name).join(t(lang, 'list')) }));
  lines.push(t(lang, 'summary.row.plugin', { ref: plan.plugin?.ref || 'local' }));
  if (plan.pipeline_url) lines.push(t(lang, 'summary.row.pipeline', { id: plan.pipeline_id, url: plan.pipeline_url }));
  lines.push('', '</details>');
  return lines.join('\n');
}

export function renderInlineFinding(finding, { anchored = true, lang = DEFAULT_LANGUAGE } = {}) {
  const parts = [t(lang, 'finding.heading', { tag: severityTag(finding, lang), title: clean(finding.title, 200), lens: lensLabel(finding.lens, lang), id: finding.id }), ''];
  if (!anchored && finding.path) parts.push(t(lang, 'finding.location', { where: plain(finding.path, 300) + (finding.line ? ':' + finding.line : '') }), '');
  parts.push(clean(finding.body, 2000));
  if (finding.suggestion) parts.push('', t(lang, 'finding.suggestion', { text: clean(finding.suggestion, 800) }));
  const meta = [t(lang, 'finding.evidence', { level: finding.evidence_level })];
  if (finding.verifier === 'confirmed') meta.push(t(lang, 'finding.confirmed'));
  if (finding.severity_pending) meta.push(t(lang, 'finding.severity_pending', { severity: finding.severity_suggested }));
  if (finding.found_late) meta.push(t(lang, 'finding.found_late'));
  parts.push('', t(lang, 'finding.footer', { meta: meta.join(t(lang, 'comma')) }));
  return parts.join('\n');
}

export function renderNeedsHumanThread(item, lang = DEFAULT_LANGUAGE) {
  const lines = [t(lang, 'question.heading', { title: clean(item.title, 200), id: item.id }), ''];
  if (item.why) lines.push(clean(item.why, 1500), '');
  const questions = (item.questions || []).filter(Boolean);
  if (questions.length) {
    lines.push(t(lang, 'question.answer'));
    questions.forEach((question, index) => lines.push((index + 1) + '. ' + clean(question, 400)));
    lines.push('');
  }
  const paths = (item.paths || []).filter(Boolean);
  if (paths.length) lines.push(t(lang, 'question.paths', { paths: paths.slice(0, 8).map((file) => '\x60' + plain(file, 200) + '\x60').join(t(lang, 'list')), more: paths.length > 8 ? t(lang, 'files_more', { n: paths.length }) : '' }), '');
  const origin = item.lens ? t(lang, 'question.origin_lens', { lens: lensLabel(item.lens, lang), also: item.also?.length ? t(lang, 'question.origin_also', { n: item.also.length }) : '' }) : t(lang, 'question.origin_rule');
  lines.push(t(lang, 'question.footer', { origin }));
  return lines.join('\n');
}

export function renderNeedsHumanReply(item, lang = DEFAULT_LANGUAGE) {
  const questions = (item.questions || []).filter(Boolean);
  const lines = [t(lang, 'question.reply', { lens: lensLabel(item.lens, lang), title: clean(item.title, 200) })];
  if (item.why) lines.push('', clean(item.why, 1200));
  if (questions.length) lines.push('', t(lang, 'question.answer'), ...questions.map((question, index) => (index + 1) + '. ' + clean(question, 400)));
  return lines.join('\n');
}

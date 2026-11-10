// Every text the bot posts, in each language it can post in, and the setting
// that picks one. Core functions take the language as a parameter (default
// 'en'); nothing reads a global. Job logs and thrown errors stay in English.
//
// A message is a string with {name} placeholders. {name:one|many} picks "one"
// when the value of name is 1 and "many" otherwise, for English plurals; it
// prints nothing else, so write the number with its own {name}.
// ci/test/i18n.test.mjs checks that both catalogs have the same keys and the
// same placeholders, and that every key is used.

export const LANGUAGES = Object.freeze(['en', 'zh']);
export const DEFAULT_LANGUAGE = 'en';

// What MCODE_REVIEW_LANGUAGE accepts, any case.
const ALIASES = { en: 'en', zh: 'zh', 'zh-cn': 'zh', 'zh-hans': 'zh', chinese: 'zh' };

// The language of the setting: en when it is unset or empty, en with one warn
// line when it is not a known value.
export function resolveLanguage(value, warn = () => {}) {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_LANGUAGE;
  const found = ALIASES[text.toLowerCase()];
  if (found) return found;
  warn('MCODE_REVIEW_LANGUAGE is ' + JSON.stringify(text.slice(0, 40)) + ', which is not en or zh; using ' + DEFAULT_LANGUAGE);
  return DEFAULT_LANGUAGE;
}

// A config value that may come in several languages: a plain value as it is;
// an object { en, zh } in the requested language, else en, else its first value.
export function localize(value, lang = DEFAULT_LANGUAGE) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value[lang] !== undefined) return value[lang];
  if (value[DEFAULT_LANGUAGE] !== undefined) return value[DEFAULT_LANGUAGE];
  return Object.values(value)[0];
}

const PLACEHOLDER = /\{(\w+)(?::([^{}|]*)\|([^{}]*))?\}/g;

// The message key in lang, with values filled in.
export function t(lang, key, values = {}) {
  const text = (MESSAGES[lang] || MESSAGES[DEFAULT_LANGUAGE])[key] ?? MESSAGES[DEFAULT_LANGUAGE][key];
  if (text === undefined) throw new Error('unknown message key ' + key);
  return text.replace(PLACEHOLDER, (_, name, one, many) => {
    const value = values[name];
    if (one !== undefined) return Number(value) === 1 ? one : many;
    return value === undefined || value === null ? '' : String(value);
  });
}

export const MESSAGES = Object.freeze({
  en: Object.freeze({
    // Punctuation that joins parts of a line.
    paren: ' ({text})',
    comma: ', ',
    list: ', ',
    semicolon: '; ',
    files_more: ', {n} files in all',

    // The output language, as the prompts name it.
    'language.name': 'English',

    'verdict.pass': '✅ Pass',
    'verdict.request_changes': '🔧 Changes requested',
    'verdict.needs_human': '🙋 Needs a person',
    'type.defect': 'defect',
    'type.leftover': 'leftover',
    'type.maintainability': 'maintainability',
    'lens.general': 'general',
    'lens.behavior': 'behavior preservation',
    'lens.contracts': 'contracts and data',
    'lens.security': 'security and permissions',
    'lens.cross-feature': 'cross-feature impact',
    'lens.duplication': 'duplication and simplification',

    // What to ask the pr-review skill locally.
    'local.ask': 'Review the current branch with pr-review',
    'local.ask_lenses': 'Review the current branch with pr-review, {lenses} only',
    'local.ask_target': '{ask}, target branch {branch}',
    'local.guide_link': 'install the pr-review skill as the [README]({url}) describes',
    'local.guide': 'install the pr-review skill',
    'local.hint': 'Rerun the pipeline to fill the gap, or continue locally: {guide}, check out this PR\'s branch and ask MiniMax Code "{ask}". A local review uses your own model and quota.',

    // The summary note.
    'summary.title': '## MCode Review: {verdict}{phase}',
    'summary.phase.shadow': ' (shadow phase: comments only, does not block merging)',
    'summary.nothing': 'Nothing to change.',
    'summary.counts': '{blocking} blocking, {attention} for a person, {suggestions} {suggestions:suggestion|suggestions}{old}.',
    'summary.counts_old': ', plus {old} old {old:issue|issues}',
    'summary.reused': ', {n} {n:file|files} kept from the previous round',
    'summary.reviewed': 'Reviewed \x60{sha}\x60, round {round}, tier {tier}{reused}.',
    'summary.incomplete': '⚠️ {n} {n:direction|directions} did not finish this round: {which}. {n:It has|They have} no new results this round; earlier findings stay as they were.',
    'summary.blocking': '### Changes needed',
    'summary.attention': '### For a person',
    'summary.more_questions': '<details><summary>{n} more</summary>',
    'summary.attention_hint': 'Answer in each thread and resolve it once it is settled; the author can too. The approver checks them before merging.',
    'summary.suggestions': '### Suggestions',
    'summary.more_suggestions': '<details><summary>{n} more</summary>',
    'summary.old': '<details><summary>Old issues: {n}, already in the version the last round reviewed and found only now</summary>',
    'summary.dismissed': '### Dismissed',
    'summary.dismissed_line': '- {id}: {title} (@{by} closed the thread{reason})',
    'summary.dismissed_reason': ': {reason}',
    'summary.closed': '<details><summary>Closed questions for a person: {n}</summary>',
    'summary.closed_line': '- {title} ({id}, closed by @{by}{author})',
    'summary.closed_by_author': ', the PR author',
    'summary.disagree': 'To disagree with a finding, give the reason in its thread and resolve it; it will not be reopened.',
    'summary.details': '<details><summary>Run details</summary>',
    'summary.table_head': '| Item | Value |',
    'summary.row.commit': '| Commit | \x60{sha}\x60 (merge base \x60{base}\x60) |',
    'summary.row.tier': '| Tier | {tier}, {files} {files:file|files} |',
    'summary.row.lenses': '| Directions | {lenses} |',
    'summary.row.round': '| Round | {round}, blocking {consecutive} in a row |',
    'summary.row.arm': '| Model arm | {arm}: finds with {lens}, checks with {verify} |',
    'summary.row.tokens': '| Tokens | input {input}, output {output}, cache read {cache} |',
    'summary.row.risk': '| Risk paths | {names} |',
    'summary.row.plugin': '| Plugin | \x60{ref}\x60 |',
    'summary.row.pipeline': '| Pipeline | [{id}]({url}) |',
    'summary.replies': '{n} {n:reply|replies}',
    'summary.new_question': 'new this round',
    'summary.finding_line': '{n}. **[{tag}] {title}** ({details}) {where}',
    'summary.quiz.legacy': 'The old quiz is in [this thread]({url}) and is no longer graded.',
    'summary.quiz.none': 'No quiz could be written this round; the next round tries again.',
    'summary.quiz.current': 'The author quiz is in [this comment]({url}): {status}.',
    'summary.quiz.retry': ' No new quiz could be written this round; the next round tries again.',

    // Flags after a finding in the summary.
    'flag.confirmed': 'verified',
    'flag.unverified': 'not verified',
    'flag.severity_pending': 'a person decides the severity',
    'flag.pre_existing': 'existed before this PR',
    'flag.also': 'another direction reported it too: {ids}',
    'flag.found_late': 'in the previous version too',
    'flag.carried': 'not re-checked this round',

    // How far each direction got, in the summary's run details.
    'lens_status.missing': 'not finished',
    'lens_status.failed': 'failed',
    'lens_status.reused': 'all reused',
    'lens_status.partly_reused': 'partly reused',
    'lens_status.done': 'done',
    'lens_status.no_result': 'no result (the job failed or was cancelled)',
    'lens_status.partial': 'ran out of time',
    'lens_status.partial_reason': 'ran out of time; only the findings it had checked are listed',

    // A finding thread.
    'finding.heading': '**[{tag}] {title}** ({lens}, {id})',
    'finding.location': 'Location: \x60{where}\x60',
    'finding.suggestion': 'Suggestion: {text}',
    'finding.evidence': 'Evidence level {level}',
    'finding.confirmed': 'checked by a second model',
    'finding.severity_pending': 'the verifier says {severity}, so a person decides the severity',
    'finding.found_late': 'this code was already in the version the last round reviewed and was found only now; the latest push did not introduce it',
    'finding.footer': '<sub>{meta}. If you disagree, reply here with the reason and resolve the thread; it will not be reopened.</sub>',

    // A question thread.
    'question.heading': '**[For a person] {title}** ({id})',
    'question.answer': 'Please answer:',
    'question.paths': 'Files: {paths}{more}',
    'question.origin_lens': 'Raised by the {lens} direction{also}',
    'question.origin_also': ', and by {n} other {n:direction|directions}',
    'question.origin_rule': 'Raised by a pipeline rule',
    'question.footer': '<sub>{origin}. Answer here, and resolve the thread once it is settled; the author can too. The approver checks it before merging.</sub>',
    'question.reply': 'The {lens} direction asked another question about the same files: **{title}**',

    // The bot's replies when it reopens or closes a thread.
    'thread.reopen_finding': 'This problem is back in \x60{head}\x60.',
    'thread.resolve_finding': 'Not reported again in \x60{head}\x60, so it counts as fixed or no longer relevant.',
    'thread.reopen_question': 'Back in \x60{head}\x60: {title}',
    'thread.cleared.desc': 'The PR description now has the required sections. Closing automatically.',
    'thread.cleared.ui': 'The description now has a screenshot or a recording. Closing automatically.',
    'thread.cleared.incomplete': '"The review did not finish" is now reported only in the summary note. Closing this thread automatically.',
    'thread.cleared.rounds': 'Nothing blocks any more. Closing automatically.',
    'thread.cleared.risk': 'This PR no longer changes this risk path. Closing automatically.',
    'thread.cleared.severity': 'The finding is gone, or both models now give it the same severity. Closing automatically.',
    'thread.cleared.other': 'The condition no longer holds. Closing automatically.',

    // Questions from pipeline rules.
    'rule.risk.title': 'Risk path changed: {name}',
    'rule.risk.why': 'Touches {paths}{more}.',
    'rule.desc.title': 'The PR description is missing sections',
    'rule.desc.why': 'A tier {tier} PR, or one that changes a risk path, needs these sections: {sections}.',
    'rule.desc.question': 'Please add them to the PR description. The pr-description skill can draft them.',
    'rule.ui.title': 'UI change without a screenshot',
    'rule.ui.why': 'Interface files changed, and the description has no screenshot or recording.',
    'rule.ui.question': 'Please add before and after screenshots to the description.',
    'rule.severity.title': 'A person decides the severity of {id}',
    'rule.severity.why': 'The model that found it says {severity}; the verifier says {suggested}.',
    'rule.severity.question': 'Which severity should it get?',
    'rule.rounds.title': 'Still blocking after {n} rounds in a row',
    'rule.rounds.why': 'The side that writes the code and the side that reviews it are not converging. Rethink the approach instead of letting an agent keep changing the code.',
    'rule.rounds.question': 'Should the approach change?',
    'section.rollback': 'Rollback',
    'section.verification': 'Verification',

    // Prompt fragments.
    'prompt.renamed': ' (renamed from {old})',

    // The author quiz note and the answer record.
    'quiz.heading': '### Author quiz',
    'quiz.intro': 'A few parts of this change are easy to get wrong. These questions help you check them. Tick your answers here, then open the answer key at the bottom. This does not affect merging.',
    'quiz.again': 'The code changed a lot, so the questions were written again. You do not need to answer the earlier ones. ',
    'quiz.key_summary': '<summary>Answer key</summary>',
    'quiz.answer': 'Answer: {answer}',
    'quiz.evidence': 'See {places}',
    'quiz.status.answered': '{answered} of {total} answered',
    'quiz.status.unanswered': 'not answered yet',
    'quiz.reason.size': '{lines} lines of product code changed in {files} {files:file|files}',
    'quiz.reason.risk': 'it changes these risk paths: {names}',
    'record.by_comment': '**Quiz answers**: {who} answered {answered} of {total} in a comment.',
    'record.author': 'the author',
    'record.in_place': '**Quiz answers**: {answered} of {total} ticked on the quiz.',
    'record.table_head': '| Question | Choice |',
    'record.multi': 'several ticked, not counted',
    'record.none': 'no answer',
    'record.footer': 'The answer key is at the bottom of the quiz comment. This does not affect merging.',

    // The request to rewrite unusable quiz questions, sent to the model.
    'rewrite.intro': 'Some questions in your previous reply cannot be used:',
    'rewrite.item': '- Question {n} ({prompt}): {reasons}.',
    'rewrite.left': 'Only {left} usable {left:question is|questions are} left, and the quiz needs at least {min}. Write the quiz again with {ask} questions: keep the usable ones and rewrite or replace the others. Follow the plain-language rules for English in the pr-quiz skill: one or two short sentences about a concrete situation, options that state only what a user or a caller sees, and at most one code name per question, in backticks.',
    'rewrite.format': 'Reply with only the JSON object that matches the output schema: no Markdown code fence and no text before or after it.',

    // The Feishu card.
    'card.title': 'PR {ref} author quiz',
    'card.subtitle': 'The PR author answers in the PR. Everyone else can think it through first, then open the answers.',
    'card.mention_answered': 'Answered {answered} of {total}.',
    'card.mention_unanswered': 'Please answer in the PR.',
    'card.answered': 'The author answered {answered} of {total}.',
    'card.unanswered': 'The author has not answered yet.',
    'card.show_answer': 'Show answer',
    'card.button': 'Answer in the PR',
  }),
  zh: Object.freeze({
    paren: '（{text}）',
    comma: '，',
    list: '、',
    semicolon: '；',
    files_more: ' 等 {n} 个文件',

    'language.name': 'Simplified Chinese',

    'verdict.pass': '✅ 通过',
    'verdict.request_changes': '🔧 需修改',
    'verdict.needs_human': '🙋 需人工确认',
    'type.defect': '缺陷',
    'type.leftover': '遗留',
    'type.maintainability': '可维护性',
    'lens.general': '综合',
    'lens.behavior': '行为保持',
    'lens.contracts': '契约与数据',
    'lens.security': '安全与权限',
    'lens.cross-feature': '跨功能影响',
    'lens.duplication': '重复与简化',

    'local.ask': '用 pr-review 审一下当前分支',
    'local.ask_lenses': '用 pr-review 按{lenses}方向审一下当前分支',
    'local.ask_target': '{ask}，目标分支是 {branch}',
    'local.guide_link': '按[说明]({url})装好 pr-review skill',
    'local.guide': '装好 pr-review skill',
    'local.hint': '可以重跑流水线补上，也可以在本地接着审：{guide}，切到这个 PR 的分支，对 MiniMax Code 说"{ask}"。本地用的是你自己的模型和额度。',

    'summary.title': '## MCode Review：{verdict}{phase}',
    'summary.phase.shadow': '（影子期：只评论，不阻塞合入）',
    'summary.nothing': '没有需要修改的地方。',
    'summary.counts': '{blocking} 个阻塞、{attention} 个需人工确认、{suggestions} 个建议{old}。',
    'summary.counts_old': '，另有 {old} 条旧问题',
    'summary.reused': '，{n} 个文件沿用上一轮结论',
    'summary.reviewed': '审查对象 \x60{sha}\x60，第 {round} 轮，{tier} 档{reused}。',
    'summary.incomplete': '⚠️ 本轮有 {n} 个方向没有跑完：{which}。这些方向本轮没有新结论，已有的发现照旧保留。',
    'summary.blocking': '### 需要修改',
    'summary.attention': '### 需人工确认',
    'summary.more_questions': '<details><summary>另外 {n} 项</summary>',
    'summary.attention_hint': '在对应讨论里回答；看过就 resolve，作者也可以，合入前由审批人把关。',
    'summary.suggestions': '### 建议',
    'summary.more_suggestions': '<details><summary>另外 {n} 条</summary>',
    'summary.old': '<details><summary>旧问题清单：{n} 条，上一轮审过的版本里就有，本轮重审才发现</summary>',
    'summary.dismissed': '### 已驳回',
    'summary.dismissed_line': '- {id}：{title}（@{by} 关闭了讨论{reason}）',
    'summary.dismissed_reason': '：{reason}',
    'summary.closed': '<details><summary>已关闭的需人工确认：{n} 项</summary>',
    'summary.closed_line': '- {title}（{id}，@{by}{author} 关闭）',
    'summary.closed_by_author': '，PR 作者',
    'summary.disagree': '不同意某条发现：在它的讨论里说明理由并 resolve，之后不会再重开。',
    'summary.details': '<details><summary>运行信息</summary>',
    'summary.table_head': '| 项 | 值 |',
    'summary.row.commit': '| 对象 | \x60{sha}\x60（merge base \x60{base}\x60） |',
    'summary.row.tier': '| 档位 | {tier}，{files} 个文件 |',
    'summary.row.lenses': '| 审查方向 | {lenses} |',
    'summary.row.round': '| 轮次 | 第 {round} 轮，连续阻塞 {consecutive} 轮 |',
    'summary.row.arm': '| 模型组合 | {arm}：找问题 {lens}，核对 {verify} |',
    'summary.row.tokens': '| token | 输入 {input}，输出 {output}，缓存读取 {cache} |',
    'summary.row.risk': '| 风险路径 | {names} |',
    'summary.row.plugin': '| plugin | \x60{ref}\x60 |',
    'summary.row.pipeline': '| 流水线 | [{id}]({url}) |',
    'summary.replies': '{n} 条回复',
    'summary.new_question': '本轮新提',
    'summary.finding_line': '{n}. **[{tag}] {title}**（{details}）{where}',
    'summary.quiz.legacy': '旧版答题见[这条讨论]({url})，不再判分。',
    'summary.quiz.none': '这轮没能出题，下一轮会重试。',
    'summary.quiz.current': '作者答题见[这条评论]({url})，{status}。',
    'summary.quiz.retry': '这轮没能重新出题，下一轮会重试。',

    'flag.confirmed': '已核对',
    'flag.unverified': '未核对',
    'flag.severity_pending': '严重级待人工确认',
    'flag.pre_existing': '改动前就存在',
    'flag.also': '另一个方向也报了：{ids}',
    'flag.found_late': '上一版就有',
    'flag.carried': '本轮未复核',

    'lens_status.missing': '未完成',
    'lens_status.failed': '失败',
    'lens_status.reused': '全部沿用',
    'lens_status.partly_reused': '部分沿用',
    'lens_status.done': '完成',
    'lens_status.no_result': '没有产出结果（job 失败或被取消）',
    'lens_status.partial': '超时',
    'lens_status.partial_reason': '超时，只列出已经核实的发现',

    'finding.heading': '**[{tag}] {title}**（{lens}，{id}）',
    'finding.location': '位置：\x60{where}\x60',
    'finding.suggestion': '建议：{text}',
    'finding.evidence': '证据等级 {level}',
    'finding.confirmed': '已由另一个模型核对',
    'finding.severity_pending': '核对者认为应为 {severity}，严重级待人工确认',
    'finding.found_late': '这段代码在上一轮审过的版本里就有，本轮重审时才发现，不是最近的改动引入的',
    'finding.footer': '<sub>{meta}。不同意的话，在这里回复理由并 resolve，之后不会再重开。</sub>',

    'question.heading': '**[需人工确认] {title}**（{id}）',
    'question.answer': '需要回答：',
    'question.paths': '涉及：{paths}{more}',
    'question.origin_lens': '「{lens}」方向提出{also}',
    'question.origin_also': '，另有 {n} 个方向也提了',
    'question.origin_rule': '流水线规则提出',
    'question.footer': '<sub>{origin}。直接在这里回答；看过就 resolve 这条讨论，作者也可以，合入前由审批人把关。</sub>',
    'question.reply': '「{lens}」方向在同一组文件上又提了一个问题：**{title}**',

    'thread.reopen_finding': '在 \x60{head}\x60 上又出现了这个问题。',
    'thread.resolve_finding': '在 \x60{head}\x60 上没有再报出，判定为已修复或不再适用。',
    'thread.reopen_question': '在 \x60{head}\x60 上又出现了：{title}',
    'thread.cleared.desc': 'PR 描述已补齐所需段落，自动关闭。',
    'thread.cleared.ui': '描述里已经有截图或录屏，自动关闭。',
    'thread.cleared.incomplete': '"review 没有跑完"改为只写在总结评论里，这条讨论自动关闭。',
    'thread.cleared.rounds': '阻塞已解除，自动关闭。',
    'thread.cleared.risk': '本 PR 已不再改动这条风险路径，自动关闭。',
    'thread.cleared.severity': '这条发现已不再出现，或两个模型的严重级已经一致，自动关闭。',
    'thread.cleared.other': '条件已不成立，自动关闭。',

    'rule.risk.title': '改了风险路径：{name}',
    'rule.risk.why': '涉及 {paths}{more}。',
    'rule.desc.title': 'PR 描述缺少段落',
    'rule.desc.why': '{tier} 档或改了风险路径的 PR 需要写：{sections}。',
    'rule.desc.question': '请补充到 PR 描述里，可以用 pr-description skill 起草。',
    'rule.ui.title': 'UI 改动没有附截图',
    'rule.ui.why': '改了界面文件，描述里没有截图或录屏。',
    'rule.ui.question': '请在描述里补充改动前后的截图。',
    'rule.severity.title': '{id} 的严重级待人工确认',
    'rule.severity.why': '找问题的模型给 {severity}，核对者认为是 {suggested}。',
    'rule.severity.question': '这条应该按哪个级别处理？',
    'rule.rounds.title': '连续 {n} 轮仍有阻塞问题',
    'rule.rounds.why': '写代码的一方和审代码的一方没有收敛，建议回头重新考虑方案，不要继续让 agent 改下去。',
    'rule.rounds.question': '方案要不要调整？',
    'section.rollback': '回滚方式',
    'section.verification': '验证方式',

    'prompt.renamed': '（从 {old} 重命名）',

    'quiz.heading': '### 作者答题',
    'quiz.intro': '这次改动有几处容易出问题，下面几道题帮你确认一遍。直接勾选，答完可以展开最下面的答案对照。不影响合入。',
    'quiz.again': '代码改动比较大，题目重新出了一遍，之前的题不用再答。',
    'quiz.key_summary': '<summary>答案对照</summary>',
    'quiz.answer': '答案：{answer}',
    'quiz.evidence': '参考：{places}',
    'quiz.status.answered': '已答 {answered}/{total} 题',
    'quiz.status.unanswered': '还没有作答',
    'quiz.reason.size': '产品代码改了 {lines} 行、{files} 个文件',
    'quiz.reason.risk': '改了风险路径：{names}',
    'record.by_comment': '**答题记录**：{who} 在评论里答了 {answered}/{total} 题。',
    'record.author': '作者',
    'record.in_place': '**答题记录**：题目上勾选了 {answered}/{total} 题。',
    'record.table_head': '| 题 | 选择 |',
    'record.multi': '选了多个，不算',
    'record.none': '没答',
    'record.footer': '答案对照在题目评论的最下面。不影响合入。',

    'rewrite.intro': '你上一条回复里有些题目不能用：',
    'rewrite.item': '- 第 {n} 题（{prompt}）：{reasons}。',
    'rewrite.left': '现在只剩 {left} 道能用的题，至少需要 {min} 道。请重新出 {ask} 道题：保留能用的，改写或替换其他的。遵守 pr-quiz skill 里简体中文的通俗表达规则：题干用一两句短话讲一个具体场景，选项只写用户或调用方看到的结果，每道题最多一个代码名，用反引号括起来。',
    'rewrite.format': '只回复符合输出 schema 的 JSON 对象：不要 Markdown 代码块，前后也不要有其他文字。',

    'card.title': 'PR {ref} 作者答题',
    'card.subtitle': 'PR 作者在 PR 里勾选作答。其他人可以先自己想，再点开看答案。',
    'card.mention_answered': '已答 {answered}/{total} 题。',
    'card.mention_unanswered': '请到 PR 里勾选作答。',
    'card.answered': '作者已答 {answered}/{total} 题。',
    'card.unanswered': '作者还没有作答。',
    'card.show_answer': '看答案',
    'card.button': '去 PR 答题',
  }),
});

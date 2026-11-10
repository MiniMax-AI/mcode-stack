import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderInlineFinding, renderNeedsHumanReply, renderNeedsHumanThread, renderSummary } from '../core/render.mjs';

const plan = { head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40), tier: 'M', files: [{ path: 'x.ts' }], risk: [], plugin: { ref: 'abc', homepage: 'https://g/plugins/mcode-review' }, mr: { target_branch: 'dev' }, pipeline_id: 1, pipeline_url: 'http://p' };
const blocking = { id: 'F-111111', lens: 'general', severity: 'P1', title: '重试预算被瞬时错误耗尽', body: '/approve\n路径…', path: 'x.ts', line: 3, evidence_level: 3, verifier: 'confirmed', introduced: 'this_mr' };
const suggestion = { id: 'F-222222', lens: 'duplication', severity: 'P2', title: '复用已有的判断', body: 'b', path: 'y.ts', line: 1, evidence_level: 2, verifier: 'not_required', introduced: 'this_mr' };

test('summary leads with the verdict and counts and keeps the marker', () => {
  const text = renderSummary({ lang: 'zh', plan, verdict: { verdict: 'request_changes' }, findings: [blocking, suggestion], attention: [{ id: 'NH-desc', title: 'PR 描述缺少段落', why: '缺回滚方式', questions: ['请补充'] }], dismissed: [], quiz: null, round: 2, consecutive: 1, lensStatus: [{ lens: 'general', status: '完成' }], reusedFileCount: 3, phase: 'shadow' });
  assert.match(text, /^<!-- mcode-review:summary -->/);
  assert.match(text, /🔧 需修改（影子期：只评论，不阻塞合入）/);
  assert.match(text, /1 个阻塞、1 个需人工确认、1 个建议/);
  assert.match(text, /3 个文件沿用上一轮结论/);
  assert.match(text, /### 需要修改[\s\S]*F-111111/);
  assert.match(text, /### 建议[\s\S]*F-222222/);
});

test('unfinished lenses, carried findings and token usage are visible in the summary', () => {
  const carried = { ...suggestion, carried: true };
  const text = renderSummary({ lang: 'zh', plan, verdict: { verdict: 'needs_human' }, findings: [carried], attention: [], dismissed: [], quiz: { url: 'https://g/mr/1#note_9', status: '还没有作答' }, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow', incomplete: [{ lens: 'contracts', error: 'MiniMax-M3.1-Flash: 429 \x60exceeded\x60 token rate limit' }], usage: { input: 12345, output: 678, cache_read: 9000 } });
  assert.match(text, /⚠️ 本轮有 1 个方向没有跑完：契约与数据（MiniMax-M3.1-Flash: 429 exceeded token rate limit）/);
  // The author can finish the review locally with the same skill and their own model.
  assert.match(text, /可以重跑流水线补上，也可以在本地接着审：按\[说明\]\(https:\/\/g\/plugins\/mcode-review\)装好 pr-review skill，切到这个 PR 的分支，对 MiniMax Code 说"用 pr-review 按契约与数据方向审一下当前分支，目标分支是 dev"。本地用的是你自己的模型和额度。/);
  assert.match(text, /F-222222，重复与简化，本轮未复核/);
  assert.match(text, /### 作者答题\n\n作者答题见\[这条评论\]\(https:\/\/g\/mr\/1#note_9\)，还没有作答。\n/);
  assert.match(text, /\| token \| 输入 12,345，输出 678，缓存读取 9,000 \|/);
});

test('the local review hint asks for the general pass when only the general lens failed, and works without a homepage', () => {
  const noHome = { ...plan, plugin: { ref: 'abc' } };
  const text = renderSummary({ lang: 'zh', plan: noHome, verdict: { verdict: 'needs_human' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow', incomplete: [{ lens: 'general', error: '529' }] });
  assert.match(text, /装好 pr-review skill，切到这个 PR 的分支，对 MiniMax Code 说"用 pr-review 审一下当前分支，目标分支是 dev"/);
  // Without a known target the skill falls back to the remote default branch.
  const two = renderSummary({ lang: 'zh', plan: { ...plan, mr: undefined }, verdict: { verdict: 'needs_human' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow', incomplete: [{ lens: 'security' }, { lens: 'cross-feature' }] });
  assert.match(two, /"用 pr-review 按安全与权限、跨功能影响方向审一下当前分支"/);
  const done = renderSummary({ lang: 'zh', plan, verdict: { verdict: 'pass' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' });
  assert.doesNotMatch(done, /本地接着审/);
});

test('an empty result says there is nothing to change', () => {
  const text = renderSummary({ lang: 'zh', plan, verdict: { verdict: 'pass' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' });
  assert.match(text, /没有需要修改的地方/);
});

test('inline comments neutralise quick actions from model text', () => {
  const text = renderInlineFinding(blocking, { lang: 'zh' });
  assert.doesNotMatch(text, /^\/approve/m);
  assert.match(text, /回复理由并 resolve/);
});

test('the quiz line says where the quiz is, how far the author got, and when no quiz could be written', () => {
  const line = (quiz) => renderSummary({ lang: 'zh', plan, verdict: { verdict: 'pass' }, findings: [], attention: [], dismissed: [], quiz, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' }).match(/### 作者答题\n\n(.+)/)[1];
  assert.equal(line({ url: 'https://g/mr/1#note_9', status: '已答 2/4 题' }), '作者答题见[这条评论](https://g/mr/1#note_9)，已答 2/4 题。');
  assert.equal(line({ failed: true }), '这轮没能出题，下一轮会重试。');
  assert.equal(line({ url: 'https://g/mr/1#note_9', status: '还没有作答', failed: true }), '作者答题见[这条评论](https://g/mr/1#note_9)，还没有作答。这轮没能重新出题，下一轮会重试。');
  assert.equal(line({ legacy: true, url: 'https://g/mr/1#note_5' }), '旧版答题见[这条讨论](https://g/mr/1#note_5)，不再判分。');
  assert.doesNotMatch(renderSummary({ lang: 'zh', plan, verdict: { verdict: 'pass' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' }), /作者答题/);
});

test('suggestions carry their type and list defects before maintainability', () => {
  const upkeep = { ...suggestion, id: 'F-333333', type: 'maintainability', title: '两份判断以后可能分叉' };
  const defect = { ...suggestion, id: 'F-444444', type: 'defect', title: '重新开启被拒' };
  const text = renderSummary({ lang: 'zh', plan, verdict: { verdict: 'pass' }, findings: [upkeep, defect], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' });
  assert.match(text, /1\. \*\*\[P2·缺陷\] 重新开启被拒[\s\S]*2\. \*\*\[P2·可维护性\] 两份判断以后可能分叉/);
  assert.match(renderInlineFinding({ ...defect, type: 'leftover' }, { lang: 'zh' }), /\[P2·遗留\]/);
});

test('P2s found late go to a collapsed list of old issues; P1s found late stay in front', () => {
  const late = { ...suggestion, id: 'F-555555', type: 'defect', title: '旧代码里的问题', found_late: true };
  const lateP1 = { ...blocking, id: 'F-666666', verifier: 'unverified', title: '旧代码里的严重问题', found_late: true };
  const text = renderSummary({ lang: 'zh', plan, verdict: { verdict: 'pass' }, findings: [late, lateP1, suggestion], attention: [], dismissed: [], quiz: null, round: 2, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' });
  assert.match(text, /0 个阻塞、0 个需人工确认、2 个建议，另有 1 条旧问题/);
  assert.match(text, /### 建议[\s\S]*F-666666[\s\S]*<details><summary>旧问题清单：1 条[\s\S]*F-555555/);
});

test('questions link to their threads, and the summary says who closed what', () => {
  const linked = { ...plan, mr: { web_url: 'https://gitlab.example/g/p/-/merge_requests/1' } };
  const attention = [
    { id: 'NH-risk-ci', title: '改了风险路径：CI [和] 发布', noteId: 41, replies: 2 },
    { id: 'NH-other-abcdef', title: '新问题', noteId: null, created: true },
  ];
  const closed = [{ id: 'NH-ui', title: 'UI 改动没有附截图', by: 'dev', byAuthor: true }];
  const dismissed = [{ id: 'F-222222', title: '复用已有判断', by: 'owner', reason: '跨了服务边界\n不复用，见 \x60a.ts\x60' }];
  const text = renderSummary({ lang: 'zh', plan: linked, verdict: { verdict: 'needs_human' }, findings: [], attention, closed, dismissed, quiz: null, round: 3, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' });
  assert.match(text, /- \[改了风险路径：CI 和 发布\]\(https:\/\/gitlab\.example\/g\/p\/-\/merge_requests\/1#note_41\)（NH-risk-ci，2 条回复）/);
  assert.match(text, /- \*\*新问题\*\*（NH-other-abcdef，本轮新提）/);
  assert.match(text, /看过就 resolve，作者也可以/);
  assert.match(text, /F-222222：复用已有判断（@owner 关闭了讨论：跨了服务边界 不复用，见 a\.ts）/);
  assert.match(text, /已关闭的需人工确认：1 项[\s\S]*UI 改动没有附截图（NH-ui，@dev，PR 作者 关闭）/);
  assert.doesNotMatch(text, /\/review/);
});

test('question threads are safe to post and say how to close them', () => {
  const text = renderNeedsHumanThread({ id: 'NH-x', title: '侧聊要不要继承顾问', why: '会把完整对话发出去', questions: ['/approve 要继承吗？', '要提示用户吗？'], paths: ['a.ts', 'b\n/merge.ts'], lens: 'security' }, 'zh');
  assert.match(text, /\*\*\[需人工确认\] 侧聊要不要继承顾问\*\*（NH-x）/);
  assert.match(text, /需要回答：\n1\. \u200B\/approve 要继承吗？\n2\. 要提示用户吗？/, 'a quick action inside a question is neutralised');
  assert.doesNotMatch(text, /^\s*\/(approve|merge)/m);
  assert.match(text, /「安全与权限」方向提出。直接在这里回答；看过就 resolve 这条讨论，作者也可以/);
  assert.match(renderNeedsHumanThread({ id: 'NH-desc', title: 'PR 描述缺少段落', questions: [] }, 'zh'), /流水线规则提出/);
  assert.match(renderNeedsHumanReply({ id: 'NH-y', title: '还要问一句', questions: ['谁负责？'], lens: 'general' }, 'zh'), /「综合」方向在同一组文件上又提了一个问题：\*\*还要问一句\*\*[\s\S]*1\. 谁负责？/);
  const floating = renderInlineFinding({ ...blocking }, { anchored: false, lang: 'zh' });
  assert.match(floating, /位置：\x60x\.ts:3\x60/);
});

// English is the default language.
const enBlocking = { ...blocking, title: 'Transient errors use up the retry budget', body: '/approve\nThe path…' };
const enSuggestion = { ...suggestion, title: 'Reuse the existing check' };
const HAN = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;

test('the summary in English leads with the verdict and counts, with English plurals', () => {
  const attention = [{ id: 'NH-desc', title: 'The PR description is missing sections', noteId: 41, replies: 1 }, { id: 'NH-other-abcdef', title: 'New question', created: true }];
  const linked = { ...plan, mr: { target_branch: 'dev', web_url: 'https://gitlab.example/g/p/-/merge_requests/1' }, risk: [{ name: 'CI and release configuration' }, { name: 'Billing' }] };
  const text = renderSummary({ plan: linked, verdict: { verdict: 'request_changes' }, findings: [enBlocking, enSuggestion], attention, closed: [{ id: 'NH-ui', title: 'UI change without a screenshot', by: 'dev', byAuthor: true }], dismissed: [{ id: 'F-333333', title: 'Split the module', by: 'owner', reason: 'Crosses a\nservice boundary' }], quiz: { url: 'https://g/mr/1#note_9', status: '2 of 4 answered' }, round: 2, consecutive: 1, lensStatus: [{ lens: 'general', status: 'done (partly reused, model-a)' }, { lens: 'contracts', status: 'failed' }], reusedFileCount: 1, phase: 'shadow', incomplete: [{ lens: 'contracts', error: '429 rate limit' }], usage: { input: 12345, output: 678, cache_read: 9000 } });
  assert.match(text, /^<!-- mcode-review:summary -->\n## MCode Review: 🔧 Changes requested \(shadow phase: comments only, does not block merging\)\n\n1 blocking, 2 for a person, 1 suggestion\.\n/);
  assert.match(text, /\nReviewed \x60aaaaaaaaaa\x60, round 2, tier M, 1 file kept from the previous round\.\n/);
  assert.match(text, /⚠️ 1 direction did not finish this round: contracts and data \(429 rate limit\)\. It has no new results this round; earlier findings stay as they were\./);
  assert.match(text, /Rerun the pipeline to fill the gap, or continue locally: install the pr-review skill as the \[README\]\(https:\/\/g\/plugins\/mcode-review\) describes, check out this PR's branch and ask MiniMax Code "Review the current branch with pr-review, contracts and data only, target branch dev"\. A local review uses your own model and quota\./);
  assert.match(text, /### Changes needed\n1\. \*\*\[P1\] Transient errors use up the retry budget\*\* \(F-111111, general, verified\) \x60x\.ts:3\x60\n/);
  assert.match(text, /### For a person\n- \[The PR description is missing sections\]\(https:\/\/gitlab\.example\/g\/p\/-\/merge_requests\/1#note_41\) \(NH-desc, 1 reply\)\n- \*\*New question\*\* \(NH-other-abcdef, new this round\)\n\nAnswer in each thread/);
  assert.match(text, /### Suggestions\n1\. \*\*\[P2\] Reuse the existing check\*\* \(F-222222, duplication and simplification\) \x60y\.ts:1\x60\n/);
  assert.match(text, /### Dismissed\n- F-333333: Split the module \(@owner closed the thread: Crosses a service boundary\)/);
  assert.match(text, /Closed questions for a person: 1[\s\S]*- UI change without a screenshot \(NH-ui, closed by @dev, the PR author\)/);
  assert.match(text, /### Author quiz\n\nThe author quiz is in \[this comment\]\(https:\/\/g\/mr\/1#note_9\): 2 of 4 answered\.\n/);
  assert.match(text, /\| Item \| Value \|\n\| --- \| --- \|\n\| Commit \| \x60a{40}\x60 \(merge base \x60b{10}\x60\) \|\n\| Tier \| M, 1 file \|\n\| Directions \| general done \(partly reused, model-a\); contracts and data failed \|\n\| Round \| 2, blocking 1 in a row \|/);
  assert.match(text, /\| Tokens \| input 12,345, output 678, cache read 9,000 \|/);
  assert.match(text, /\| Risk paths \| CI and release configuration, Billing \|/);
  assert.match(text, /\| Plugin \| \x60abc\x60 \|\n\| Pipeline \| \[1\]\(http:\/\/p\) \|/);
  assert.doesNotMatch(text, HAN, 'nothing Chinese in an English summary');
});

test('English counts, old issues, flags and the quiz lines', () => {
  const late = { ...enSuggestion, id: 'F-555555', type: 'defect', title: 'An issue in old code', found_late: true };
  const flagged = { ...enSuggestion, id: 'F-666666', type: 'maintainability', verifier: 'unverified', severity_pending: true, introduced: 'pre_existing', also: ['F-777777', 'F-888888'], carried: true, path: '' };
  const text = renderSummary({ plan, verdict: { verdict: 'pass' }, findings: [late, flagged, enSuggestion], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 3, phase: 'enforce' });
  assert.match(text, /## MCode Review: ✅ Pass\n\n0 blocking, 0 for a person, 2 suggestions, plus 1 old issue\./);
  assert.match(text, /3 files kept from the previous round/);
  assert.match(text, /\*\*\[P2·maintainability\] Reuse the existing check\*\* \(F-666666, duplication and simplification, not verified, a person decides the severity, existed before this PR, another direction reported it too: F-777777, F-888888, not re-checked this round\)\n/);
  assert.match(text, /<details><summary>Old issues: 1, already in the version the last round reviewed and found only now<\/summary>[\s\S]*F-555555, duplication and simplification, in the previous version too/);
  assert.match(renderSummary({ plan, verdict: { verdict: 'needs_human' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow', incomplete: [{ lens: 'security' }, { lens: 'cross-feature' }] }), /⚠️ 2 directions did not finish this round: security and permissions; cross-feature impact\. They have no new results[\s\S]*"Review the current branch with pr-review, security and permissions, cross-feature impact only, target branch dev"/);
  assert.match(renderSummary({ plan: { ...plan, plugin: { ref: 'abc' }, mr: undefined }, verdict: { verdict: 'needs_human' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow', incomplete: [{ lens: 'general' }] }), /continue locally: install the pr-review skill, check out this PR's branch and ask MiniMax Code "Review the current branch with pr-review"\./);
  assert.match(renderSummary({ plan, verdict: { verdict: 'pass' }, findings: [], attention: [], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' }), /✅ Pass \(shadow phase[^\n]*\n\nNothing to change\.\n/);
  const line = (quiz) => renderSummary({ plan, verdict: { verdict: 'pass' }, findings: [], attention: [], dismissed: [], quiz, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' }).match(/### Author quiz\n\n(.+)/)[1];
  assert.equal(line({ failed: true }), 'No quiz could be written this round; the next round tries again.');
  assert.equal(line({ url: 'u', status: 'not answered yet', failed: true }), 'The author quiz is in [this comment](u): not answered yet. No new quiz could be written this round; the next round tries again.');
  assert.equal(line({ legacy: true, url: 'v' }), 'The old quiz is in [this thread](v) and is no longer graded.');
});

test('finding and question threads in English', () => {
  const finding = renderInlineFinding({ ...enBlocking, suggestion: 'Use >=', severity_pending: true, severity_suggested: 'P2', found_late: true });
  assert.match(finding, /^\*\*\[P1\] Transient errors use up the retry budget\*\* \(general, F-111111\)\n\n\u200B\/approve\nThe path…\n\nSuggestion: Use >=\n\n<sub>Evidence level 3, checked by a second model, the verifier says P2, so a person decides the severity, this code was already in the version the last round reviewed and was found only now; the latest push did not introduce it\. If you disagree, reply here with the reason and resolve the thread; it will not be reopened\.<\/sub>$/);
  assert.match(renderInlineFinding({ ...enBlocking, type: 'leftover' }, { anchored: false }), /^\*\*\[P1·leftover\] [^\n]+\n\nLocation: \x60x\.ts:3\x60\n/);
  const question = renderNeedsHumanThread({ id: 'NH-x', title: 'Should side chats inherit the advisor?', why: 'It sends the whole conversation.', questions: ['/approve Inherit it?', 'Tell the user?'], paths: Array.from({ length: 9 }, (_, i) => 'f' + i + '.ts'), lens: 'security', also: ['NH-y'] });
  assert.match(question, /^\*\*\[For a person\] Should side chats inherit the advisor\?\*\* \(NH-x\)\n\nIt sends the whole conversation\.\n\nPlease answer:\n1\. \u200B\/approve Inherit it\?\n2\. Tell the user\?\n\nFiles: \x60f0\.ts\x60, \x60f1\.ts\x60, [^\n]*\x60f7\.ts\x60, 9 files in all\n\n<sub>Raised by the security and permissions direction, and by 1 other direction\. Answer here, and resolve the thread once it is settled; the author can too\. The approver checks it before merging\.<\/sub>$/);
  assert.match(renderNeedsHumanThread({ id: 'NH-desc', title: 'The PR description is missing sections', questions: [] }), /<sub>Raised by a pipeline rule\. Answer here/);
  assert.equal(renderNeedsHumanReply({ id: 'NH-y', title: 'One more question', questions: ['Who owns it?'], lens: 'general' }), 'The general direction asked another question about the same files: **One more question**\n\nPlease answer:\n1. Who owns it?');
  for (const text of [finding, question]) assert.doesNotMatch(text, HAN);
});

test('on GitHub a question links to its review comment', () => {
  const github = { ...plan, host: 'github', mr: { web_url: 'https://github.com/acme/app/pull/1', target_branch: 'main' } };
  const text = renderSummary({ plan: github, verdict: { verdict: 'needs_human' }, findings: [], attention: [{ id: 'NH-desc', title: 'The PR description is missing sections', noteId: 41, replies: 0 }], dismissed: [], quiz: null, round: 1, consecutive: 0, lensStatus: [], reusedFileCount: 0, phase: 'shadow' });
  assert.match(text, /- \[The PR description is missing sections\]\(https:\/\/github\.com\/acme\/app\/pull\/1#discussion_r41\) \(NH-desc\)/);
});

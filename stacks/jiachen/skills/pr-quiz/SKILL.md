---
name: pr-quiz
description: Write multiple-choice questions that check whether a PR's author understands their change. Use only when the MCode Review pipeline asks for an author quiz.
---

# PR quiz

The quiz asks the author of a PR (on GitLab, a merge request) a few questions about their own change. The author ticks an answer in the PR, may read code while answering, and can open the answer key right after. The quiz never blocks a merge, so a question is worth asking only if a reviewer would want the author to have thought it through.

## What to ask

1. Each question probes one `dimension`:
   - `design-intent`: why the change does it this way and not another way;
   - `impact-surface`: which callers, flows or stored data it affects;
   - `boundary`: empty values, concurrency, ordering, repeated calls, old data;
   - `failure-mode`: what happens when a step fails, times out or is retried, and how it degrades or rolls back.

   At least half of the questions are `design-intent` or `failure-mode`.
2. The correct answer follows from the code and the diff. Do not ask about intent the code cannot show.
3. No memory questions: never ask which file, function or variable changed, or anything the author could copy from the diff.
4. Give 3 to 5 options. Exactly one is correct. Each wrong option is a mistake a hurried author would plausibly make: a missed error branch, a forgotten second caller, two similar concepts mixed up. No absurd options.
5. Keep the options alike in length and detail. The correct option must not be the longest.

## Plain language

The author reads the quiz between other comments on the PR. Write each question the way a teammate asks at your desk, in the language the prompt asks for, and follow the section below for that language. In both languages a question uses at most one code name, in backticks, and only when there is no plain name for the thing.

### English

1. The stem is one or two short sentences, about 25 words at most. It describes a concrete situation, who does what and what happens next, and then asks.
2. An option states only the result a user or a caller sees, in about 12 words at most. The reason goes in the explanation, never in an option: no "because", "since", "due to", "so that", "therefore", "which causes", "leading to" or "as a result".
3. Use at most one code name in the whole question, in backticks, and only when there is no plain name for the thing. Never chain names and never invent terms. Call things what users and callers call them: session, settings page, caller, retry.
4. Avoid these patterns; they make a question read like a spec:
   - "at this point" or "at this moment";
   - a stem that opens with a long "When ...", "While ..." or "Once ..." clause: state the situation in its own short sentence;
   - a long chain of modifiers before a noun: split the sentence in two;
   - three or more items in one sentence;
   - "not X but Y";
   - invented jargon such as "observable behavior", "degrades to" or "falls back to".

Bad, a dense stem full of code names, and an option that gives a reason:

> When the mobile NoteEditor flushes the drafts that the user wrote while offline through syncQueue.flush, and the SyncWorker has already started but the lastSyncedAt field of the current notebook has not been written yet, what does the header at the top of the editor render at this point?
>
> - Falls back to rendering the local draftCache because its isDirty flag starts as true

Good rewrite of the same question:

> A draft written offline needs to sync, but this notebook has never synced. What does the user see?
>
> - The draft, updated after the sync
> - Nothing until the sync finishes
> - A sync error and a retry button

More rewrites:

| Bad | Good |
| --- | --- |
| When the retry budget is exhausted, how does the system handle the request? | Three retries in a row failed. What does the user see? |
| What happens when you rename a session that another window deleted but that is still in the local cache? | Another window deleted the session, but this window still shows it. What happens on rename? |
| What does the service do when the setting is missing, malformed or out of range? | The setting is missing from the config. What happens when the service starts? |
| Not an immediate failure but a degradation to read-only mode | It turns read-only and edits stop |

The pipeline drops a question whose stem is longer than 45 words, has more than 2 code names, uses "at this point" or "at this moment", or opens with a "When", "While" or "Once" clause longer than 8 words, and a question with an option longer than 20 words, with more than 1 code name, or with a reason in it. It also drops a question that asks which file, function, method, variable, class or line, or what something is called. Stay well inside these limits.

### Simplified Chinese

Write the question in Simplified Chinese.

1. The stem is one or two short sentences, about 60 characters at most. It describes a concrete situation, who does what and what happens next, and then asks.
2. An option states only the result a user or a caller sees, in about 25 characters at most. The reason goes in the explanation, never in an option: no 因为, 由于, 所以, 从而 or 导致.
3. Use at most one code name in the whole question, in backticks, and only when there is no plain name for the thing. Never chain names and never invent terms. Call things what users and callers call them: 会话、设置页、调用方、重试.
4. Avoid these patterns; they make a question read like a translated spec:
   - a stem that opens with 在……时 or 当……时, and 此时……怎样;
   - a modifier of more than about 15 characters before a noun: split the sentence in two;
   - three or more items joined by 顿号;
   - 不是……而是……;
   - invented or translated jargon such as 呈现、回执、可观察行为、退化为、回退为.

Bad, a dense stem full of code names, and an option that gives a reason:

> 手机端 NoteEditor 通过 syncQueue.flush 提交用户离线时写下的草稿，SyncWorker 已经启动但当前笔记本的 lastSyncedAt 字段还没写入，此时编辑器顶部呈现回执怎样？
>
> - 回退为本地 draftCache 呈现，因为它的 isDirty 初始为 true

Good rewrite of the same question:

> 离线时写的草稿要同步上去，但这个笔记本还从没同步过。用户这时会看到什么？
>
> - 先显示草稿，同步完再更新
> - 先不显示，等同步完再显示
> - 提示同步失败，让用户重试

More rewrites:

| Bad | Good |
| --- | --- |
| 当重试次数耗尽时，系统会如何处理该请求？ | 连续重试三次都失败了。用户会看到什么？ |
| 对已经被另一个窗口删除但仍留在本地缓存中的会话执行重命名会怎样？ | 会话在另一个窗口里删掉了，这个窗口还显示着它。这时改名会怎样？ |
| 配置项缺失、格式错误、取值越界时服务会怎样？ | 配置里少了这一项，服务启动后会怎样？ |
| 不是立刻失败，而是退化为只读模式 | 先变成只读，不能再改 |

The pipeline drops a question whose stem is longer than 100 characters, has more than 2 code names, uses 此时 or opens with 当……时, and a question with an option longer than 45 characters, with more than 1 code name, or with a reason in it. Stay well inside these limits.

## Fields

- `dimension`: one of the four dimensions above.
- `prompt`: the stem.
- `options`: the option texts without letters. The pipeline adds the letters and shuffles the order.
- `answer_index`: the zero-based index of the correct option in `options`.
- `explanation`: why the correct option is right and the main wrong ones are wrong, in two or three plain sentences. It is shown after the author answers. Refer to options by their content, never by letter or position, because the order changes.
- `evidence`: up to three changed places that support the answer, each a `path` and a new-side `line`.

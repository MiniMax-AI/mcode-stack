# req-tpm

让需求提出人和自己的 Agent 一起，当这个需求的 TPM：从提出到效果验收，全程有文档、有工作项、有人在跟，不会悄悄丢掉。

需求正文放飞书文档，状态和流转放飞书项目（Meegle）。每个 skill 都可以单独装、单独用，同时维护两边。

## 生命周期

```mermaid
flowchart LR
  A[req-intake<br/>该不该做<br/>预期效果] --> B[req-prioritize<br/>成本/影响/风险<br/>负责人拍板]
  B --> C[req-design<br/>选项与决策<br/>波及面/检查点]
  C --> D[req-track<br/>进展/阻塞/下一步<br/>停滞显式标出]
  D --> E[req-ship<br/>回滚/可观测/DoD<br/>推进状态]
  E --> F[req-outcome<br/>对照预期效果<br/>有证据才关闭]
  F -- 未达成 --> C
  A -- 建议不做 --> X[关闭并记录原因]
  D -. 停滞 .-> D
```

| 阶段 | Skill | 产出写到文档哪一节 |
| --- | --- | --- |
| 受理 | `req-intake` | 1–3 |
| 排期 | `req-prioritize` | 4 |
| 方案 | `req-design` | 5–6 |
| 跟进 | `req-track` | 7 |
| 上线 | `req-ship` | 8 |
| 验收 | `req-outcome` | 9 |

## 几条规则

- 预期效果在受理时就写死：指标、基线、目标、测法、观察窗口。最后用它验收。
- 提出人提建议，负责人做优先级决定。Agent 不改别人需求的优先级。
- 停滞本身是一条信息：报告里置顶，不自动催人，也不沉默。
- 上线不等于完成。只有拿到效果证据才关闭。
- 对外可见的写操作（评论、@人、状态流转）先给提出人看，确认后执行。

## 依赖

- `meegle` CLI（飞书项目），已登录；字段和状态见 [`templates/meegle-field-mapping.md`](templates/meegle-field-mapping.md)。
- `lark-cli`，以用户身份（`--as user`）读写飞书文档。
- 需求文档模板：[`templates/requirement-doc.md`](templates/requirement-doc.md)。

---

**English.** `req-tpm` lets whoever raises a requirement act as its TPM together with their own agent: challenge it at intake and write a measurable expected outcome, get a priority decision from the owner, record the design decision and blast radius, track status on a cadence and flag stale items, check rollback/observability/DoD before shipping, and close only with evidence against the expected outcome. The body lives in a Feishu doc; status lives in Meegle (Feishu Project). Each skill installs on its own.

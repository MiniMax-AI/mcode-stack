---
name: req-outcome
description: "上线后对照 intake 写下的预期效果收集证据，判断是否达成；没达成就写清差距和下一步；只有拿到证据才关闭需求。Use after the observation window of a shipped requirement, when someone asks 这个需求效果怎么样 / 可以关了吗, or before closing a work item."
---

# 效果验收（req-outcome）

需求的终点是效果，不是上线。我们只在证据对上 intake 的预期效果之后关闭需求。

## 1. 取回预期效果

```bash
lark-cli docs +fetch --as user --doc <URL> --keyword "预期效果" --context-after 3
```

读出每一行的指标、基线、目标、测法、观察窗口。观察窗口没到，就只记中期读数，不下结论。

## 2. 按原测法取数

用 intake 写的同一个测法、同一个口径取数，自己复算一次。换了口径要写明，并说明为什么。不允许用「感觉好多了」「用户反馈不错」代替指标；定性反馈可以附上，但不算达成证据。

## 3. 逐条判定

| 预期 | 基线 | 目标 | 实测（来源） | 结论 |
| --- | --- | --- | --- | --- |
| ... | ... | ... | ...（看板链接/查询） | 达成 / 未达成 / 无法判断 |

- **未达成**：写差距、可能原因（带证据）、下一步（继续优化 / 新需求 / 接受现状），下一步要有人和时间。
- **无法判断**：通常是没埋点或口径变了，写清缺什么，回到 `req-ship` 补可观测性。

## 4. 写回并关闭

把表格写进「9. 效果验收」。

全部达成，或提出人和负责人书面接受了未达成项，才推进到关闭状态（命令同 `req-ship` 第 3 节）。未达成且有后续时，在工作项评论里写下一步和新需求链接：

```bash
meegle comment add --project-key <PK> --work-item-id <ID> --content "<验收结论 + 文档链接>"
```

## 输出

验收表、结论、关闭与否；没关闭时写下一次验收时间。

## 用到的命令

先确认身份和空间（每个会话一次）：

```bash
meegle project search --project-key "<空间名或 key>" --format json
meegle workitem meta-types --project-key <PK> --format json
lark-cli docs +fetch --as user --doc <需求文档 URL> --scope outline
```

字段 key、状态 key、transition_id 一律现查，不要凭记忆填，见 `templates/meegle-field-mapping.md`。

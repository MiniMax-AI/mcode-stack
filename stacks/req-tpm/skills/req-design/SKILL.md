---
name: req-design
description: "为已排期的需求做方案：列至少两个选项、写决策记录、评估波及面（blast radius）、定验收检查点，全部落进需求文档。Use when a requirement is scheduled and before implementation, or when someone asks 方案怎么定 / 这个改动会影响哪些地方."
---

# 方案设计（req-design）

方案讨论最容易散在群聊和会议里。我们要求结论回到需求文档，形成一条能被后来人读懂的决策记录。

## 1. 输入

- 需求文档（`lark-cli docs +fetch --as user --doc <URL>`），重点读背景、预期效果、待确认问题。
- 相关代码或系统现状：从真实仓库和文档里读，不凭印象。

待确认问题里还有影响方案的项，先回去问提出人，不进入设计。

## 2. 至少两个选项

每个选项一段：做法、改动范围、成本、主要风险、放弃它的理由。「什么都不改，只改文档/流程」也算一个选项，值得写。

## 3. 决策记录

```text
决定：选项 B
原因：...
放弃了：选项 A，因为 ...
谁定的、何时：...
假设（被推翻时要重新评审）：...
```

## 4. 波及面

列出这次改动可能波及、但不在 diff 里的地方：调用方、配置、数据迁移、对外接口、文档、其他团队。每条写「怎么确认没坏」（一个测试、一条命令、一个负责人确认）。

## 5. 验收检查点

把 intake 的预期效果拆成实施过程中的检查点，每个检查点有可执行的检查方式：

| 检查点 | 何时 | 怎么查 | 通过标准 |
| --- | --- | --- | --- |
| 方案评审通过 | 开发前 | 文档评审记录 | 负责人确认 |
| 关键路径测试 | 合入前 | `<测试命令>` | 全绿，且新测试在旧代码上失败 |
| 灰度指标 | 上线后 1 天 | 埋点看板 | 不劣于基线 |

## 6. 写回文档并推进节点

写进「5. 方案设计」「6. 验收检查点」（用 `+fetch --detail with-ids` 拿 block_id，再 `+update --command block_insert_after` 或 `block_replace`）。

方案评审在 Meegle 上若是一个节点，评审结论按 meegle skill 的 `sop-transition-node.md` 写：

```bash
meegle workflow get-node --project-key <PK> --work-item-id <ID> --node-id-list '["<评审节点 key>"]' --format json
meegle workflow update-node --project-key <PK> --work-item-id <ID> --node-id <评审节点 key> \
  --fields '[{"field_key":"node_finished_opinion","field_value":"<评审意见>"}]'
```

节点流转（`workflow transition --action confirm`）由节点负责人确认后再执行。

## 输出

文档里的选项、决策记录、波及面、检查点四节齐全；给提出人一段摘要和仍未决的问题。

## 用到的命令

先确认身份和空间（每个会话一次）：

```bash
meegle project search --project-key "<空间名或 key>" --format json
meegle workitem meta-types --project-key <PK> --format json
lark-cli docs +fetch --as user --doc <需求文档 URL> --scope outline
```

字段 key、状态 key、transition_id 一律现查，不要凭记忆填，见 `templates/meegle-field-mapping.md`。

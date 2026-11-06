---
name: req-track
description: "按固定节奏跟进进行中的需求，用站会格式记录进展、阻塞和下一步；超过约定时间没有更新的需求要显式标出来，不能悄悄沉下去。Use for daily or weekly requirement check-ins, when asked 这个需求到哪了 / 有没有卡住的, or from a scheduled routine."
---

# 需求跟进（req-track）

需求不是做砸的，多数是没人问着慢慢沉掉的。这一步就是定期问一句，并且把「没人更新」本身当成一条要上报的信息。

## 1. 约定节奏

在 intake 或 design 时和提出人约好：开发中默认每个工作日一次，排队中每周一次。写进文档「1. 文档信息」的「跟进节奏」。

## 2. 拉状态

```bash
meegle workitem get --project-key <PK> --work-item-id <ID> --format json
meegle workitem list-op-records --project-key <PK> --work-item-id <ID> --format json
meegle comment list --project-key <PK> --work-item-id <ID> --format json
```

多个需求时用 `workitem query` 按提出人或标签筛，见 meegle skill 的 `mql-people-roles.md`。

## 3. 站会三问

对每个需求只写三行，事实来自上面的记录和关联的 PR/CI，不来自猜测：

```text
进展：自上次以来完成了什么（附链接）
阻塞：卡在哪、等谁、从哪天开始
下一步：谁、做什么、预计何时
```

## 4. 判定停滞

满足任一条就标 **停滞**：

- 操作记录和评论在约定节奏的两倍时间内没有新内容；
- 同一阻塞连续两次跟进没变化；
- 计划时间已过但状态没动。

停滞不自动改状态、不自动催人。我们做的是：在给提出人的报告里置顶这一项，写清停了多久、最后一次动静是什么、建议找谁。提出人决定是否在工作项上评论或 @ 人：

```bash
meegle comment add --project-key <PK> --work-item-id <ID> --content "<站会三行>"
```

## 5. 记录

把每次的三行追加到文档「7. 进展记录」末尾，保持时间顺序：

```bash
lark-cli docs +update --as user --doc <URL> --command append --doc-format markdown --content @standup.md
```

## 输出

一张表：需求、状态、进展、阻塞、下一步、是否停滞。停滞项放最上面。只读汇总，不给人排名。

## 用到的命令

先确认身份和空间（每个会话一次）：

```bash
meegle project search --project-key "<空间名或 key>" --format json
meegle workitem meta-types --project-key <PK> --format json
lark-cli docs +fetch --as user --doc <需求文档 URL> --scope outline
```

字段 key、状态 key、transition_id 一律现查，不要凭记忆填，见 `templates/meegle-field-mapping.md`。

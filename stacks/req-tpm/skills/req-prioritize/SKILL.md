---
name: req-prioritize
description: "对一个已受理的需求，对照当前在做的工作（WIP）评估成本、影响、风险，给出排期建议和理由；提出人提建议，负责人拍板。Use after req-intake, at backlog grooming or sprint planning, or when someone asks 这个需求优先级多高 / 能不能插队."
---

# 需求排优先级（req-prioritize）

优先级不是提出人喊出来的，也不是 Agent 算出来的。我们的分工是：提出人和他的 Agent 把账算清楚、给出建议，负责人（空间里配置的 PM/Owner 角色）做决定。Agent 不改别人需求的优先级。

## 1. 拉当前 WIP

```bash
meegle workitem query --project-key <PK> \
  --mql "SELECT name, priority, status, current_status_operator FROM <类型 key> WHERE <状态不在已完成/已关闭>" \
  --format json
```

MQL 写法先读 meegle skill 的 `references/mql-basics.md` 与 `mql-operators.md`；状态条件的具体写法见 `mql-time-status.md`。单次最多 50 条，多了按 `--session-id` 翻页。

## 2. 三项各给一个档位和证据

| 维度 | 档位 | 必须附的证据 |
| --- | --- | --- |
| 影响 | 高 / 中 / 低 | 受影响人数或场景频率，来自 intake 的实证 |
| 成本 | S（≤2 人日）/ M（≤1 周）/ L（>1 周） | 粗拆的步骤，谁估的 |
| 风险 | 高 / 中 / 低 | 碰到的模块、数据、权限、对外接口 |

没证据的格子写「未知」，不要往中间档凑。

## 3. 和 WIP 比

- 这个需求要占谁的时间？那个人手上已有几项在做？
- 插进来会推迟哪一项？把被推迟项的名字写出来。
- 不插队的话最早什么时候能开始？

## 4. 写建议

```text
建议：本迭代 / 下迭代 / 进 backlog / 不做
理由：（一到三条，对应上面的证据）
代价：插进来会推迟 <工作项名>
需要负责人决定的点：...
```

把建议写进需求文档「4. 优先级评估」：

```bash
lark-cli docs +fetch --as user --doc <URL> --scope outline --detail with-ids
lark-cli docs +update --as user --doc <URL> --command block_insert_after \
  --block-id <「4. 优先级评估」标题的 block_id> --doc-format markdown --content @prio.md
```

在工作项上留评论并 @ 负责人（这是对外可见的动作，先给提出人看过再发）：

```bash
meegle comment add --project-key <PK> --work-item-id <ID> --content "<建议摘要 + 文档链接>"
```

## 5. 负责人决定之后

由负责人或提出人本人改优先级字段；Agent 只在提出人明确说「按负责人的决定改」时执行：

```bash
meegle workitem update --project-key <PK> --work-item-id <ID> \
  --fields '[{"field_key":"priority","field_value":"<option_id>"}]'
```

`priority` 是 meegle skill 示例里出现过的 key；option_id 必须先用 `meegle workitem meta-fields` 查。

## 输出

建议卡片 + 负责人的决定（谁、何时、在哪说的）。没拿到决定前状态保持「待排期」。

## 用到的命令

先确认身份和空间（每个会话一次）：

```bash
meegle project search --project-key "<空间名或 key>" --format json
meegle workitem meta-types --project-key <PK> --format json
lark-cli docs +fetch --as user --doc <需求文档 URL> --scope outline
```

字段 key、状态 key、transition_id 一律现查，不要凭记忆填，见 `templates/meegle-field-mapping.md`。

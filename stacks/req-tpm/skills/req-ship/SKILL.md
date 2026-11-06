---
name: req-ship
description: "上线前做就绪检查（回滚方案、可观测性、完成定义 DoD），全部有证据后再推进 Meegle 状态或节点。Use before a requirement is deployed or marked done, when someone says 可以上线了吗 / 准备发布, or before transitioning the work item to a released state."
---

# 上线就绪（req-ship）

「代码合了」不等于「可以上线」，更不等于「需求完成」。这一步把上线前必须有的东西逐条对证据，缺一条就不推进状态。

## 1. 就绪清单

| 项 | 要的证据 | 缺了怎么办 |
| --- | --- | --- |
| 完成定义（DoD） | design 里的检查点逐条打勾，附 PR、测试输出链接 | 回 design 或实施 |
| 回滚方案 | 具体操作（回退版本号、开关名、命令）和谁有权限执行 | 写出来再上 |
| 可观测性 | 能看到 intake 预期效果指标的看板或查询，上线前截一次基线 | 先补埋点，否则 outcome 无法验收 |
| 影响面通知 | 波及面里列的人或团队已知会（链接） | 提出人去通知 |
| 发布窗口 | 时间、负责人 | 和负责人对齐 |

证据看真实输出：CI 是在最终提交上跑的吗？测试有没有被过滤跳过？

## 2. 写回文档

把清单和证据写进「8. 上线记录」。

## 3. 推进 Meegle

先查这个工作项是状态流还是节点流、当前能去哪里、需要什么必填项：

```bash
# 状态流
meegle workflow list-state-transitions --project-key <PK> --work-item-id <ID> --format json
meegle workflow list-state-required --project-key <PK> --work-item-id <ID> --state-key <目标状态 key> --format json
meegle workflow transition-state --project-key <PK> --work-item-id <ID> --transition-id <transition_id>

# 节点流
meegle workflow get-node --project-key <PK> --work-item-id <ID> --format json
meegle workflow transition --project-key <PK> --work-item-id <ID> --node-id <节点 key> --action confirm
```

`list-state-required` 默认返回全部必填项；加 `--mode unfinished` 只看还没填的。

流转前把命令和目标状态给提出人看，确认后执行；流转后用 `workitem get` 读回状态。

注意：推进到「已上线」不是「已完成」。关闭留给 `req-outcome`。

## 输出

就绪清单（每项：通过/缺失 + 证据链接）、执行了哪条流转命令及读回的状态、上线时截的基线。

## 用到的命令

先确认身份和空间（每个会话一次）：

```bash
meegle project search --project-key "<空间名或 key>" --format json
meegle workitem meta-types --project-key <PK> --format json
lark-cli docs +fetch --as user --doc <需求文档 URL> --scope outline
```

字段 key、状态 key、transition_id 一律现查，不要凭记忆填，见 `templates/meegle-field-mapping.md`。

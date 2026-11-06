# Meegle 字段 / 状态 ↔ 需求文档映射

标注说明：**已核实** = 在 meegle CLI 源码自带的 skill 文档里出现过；**假设** = 没核实，必须在目标空间用 `meegle workitem meta-fields` / `meta-roles` / `workflow list-state-transitions` 现查后替换。

## 字段

| 文档位置 | Meegle 字段 | key | 状态 |
| --- | --- | --- | --- |
| 标题 | 名称 | `name` | 已核实（skill 示例） |
| 2. 背景与问题（摘要）+ 文档链接兜底 | 描述 | `description` | 已核实（`workitem get` 默认字段） |
| 4. 优先级 | 优先级 | `priority` | key 已核实（skill 示例），option_id 需现查 |
| 1. 状态 | 状态 | `status` | 已核实（MQL 示例 key） |
| 当前处理人 | 当前负责人 | `current_status_operator` | 已核实（`workitem get` 默认字段） |
| 关注人 | 关注人 | `watchers` | 已核实 |
| 需求文档链接 | 自定义链接字段 | 未知 | **假设**：空间需配置一个「需求文档」链接字段 |
| 预期效果（摘要） | 自定义多行文本 | 未知 | **假设** |
| 提出人 / 负责人 / 执行人 | 角色 | role_key 未知 | **假设**：用 `meta-roles` 查；角色只能经 `--role-operate` 改 |
| 方案评审意见 | 节点字段 | `node_finished_opinion` | 已核实（sop-transition-node） |
| 评审结论 | 节点字段 | `node_finished_conclusion` | 已核实，option_id 需现查 |

## 状态 / 节点（全部为假设，对应敏捷看板列）

| 阶段（skill） | 建议状态 | 进入条件 |
| --- | --- | --- |
| req-intake | 待评估 | 文档 + 工作项已互链 |
| req-prioritize | 待排期 → 已排期 | 负责人决定已记录 |
| req-design | 方案中 → 方案已评审 | 决策记录 + 检查点齐全 |
| req-track | 开发中 | 有执行人和计划时间 |
| req-ship | 已上线 | 就绪清单全部有证据 |
| req-outcome | 已验收关闭 / 验收未达成 | 验收表有实测来源 |

工作项是状态流还是节点流取决于空间配置：状态流用 `workflow transition-state`，节点流用 `workflow transition`。

---
name: req-intake
description: "在需求刚提出时，先挑战它是否该做，写下一条能验证的预期效果，再用模板建飞书需求文档和飞书项目（Meegle）工作项，两边互相链接。Use when someone raises a product or technical requirement, says 提需求 / 我想要 / 能不能加, or before any requirement work starts without a doc and a work item."
---

# 需求受理（req-intake）

需求跟丢，多半丢在第一步：一句话在群里提了，没有文档，没有工作项，也没人写下"做成什么样算成"。这一步我们只做三件事：问清值不值得做，写下可验证的预期效果，把文档和工作项建出来并互相挂上。提出人是这个需求的 TPM，Agent 是他的搭档，不是替他拍板。

## 1. 先挑战，再记录

按下面顺序问提出人，答不上来的写进文档「待确认问题」，不替他编：

1. **谁在什么场景下遇到什么问题？** 要一个真实例子（会话、截图、工单、数据），没有例子就标「无实证」。
2. **不做会怎样？** 现在怎么绕过去的，绕过去的代价是什么。
3. **有没有更小的做法？** 改文档、改配置、已有功能就能解决的，直接建议不立需求。
4. **和谁有关？** 需求方、可能的执行人、要通知的人。

结论只有三种：立项 / 建议不做（附原因，提出人确认后关闭） / 先补信息。

## 2. 写预期效果（Expected Outcome）

这是整条链路最后验收的依据（`req-outcome` 会回来对它）。每条必须同时有：

| 项 | 例子 |
| --- | --- |
| 指标或可观察行为 | `/resume` 列表首屏加载 P95 |
| 基线（现在的值，带来源） | 2.4 s，来自上周埋点 |
| 目标 | ≤ 800 ms |
| 怎么测、谁来测 | 同一埋点，上线后 7 天窗口，提出人看 |
| 观察窗口 | 上线后 7 天 |

写不出基线就先写「基线待测」和测法，不允许只写「体验更好」「更稳定」。

## 3. 建飞书需求文档

用 `templates/requirement-doc.md` 填好后创建（Markdown 导入）：

```bash
lark-cli docs +create --as user --doc-format markdown \
  --title "【需求】<一句话标题>" --content @req.md \
  [--parent-token <需求文件夹或 wiki 节点 token>]
```

记下返回的文档 URL。

## 4. 建 Meegle 工作项并互链

```bash
meegle workitem meta-create-fields --project-key <PK> --work-item-type <类型 key> --format json
meegle workitem meta-roles --project-key <PK> --work-item-type <类型 key> --format json
meegle workitem create --project-key <PK> --work-item-type <类型 key> \
  --fields '[{"field_key":"name","field_value":"<标题>"},{"field_key":"<需求文档链接字段>","field_value":"<文档 URL>"}]' \
  --format json
```

- 模板 ID 是必填项（meegle skill 原文），从 `meta-create-fields` 里取。
- 「需求文档链接」字段的 key 未核实，见字段映射文档；没有专门字段时，把链接写进 `description`。
- 回写文档「1. 文档信息」里的工作项链接：

```bash
lark-cli docs +update --as user --doc <文档 URL> --command str_replace \
  --pattern "工作项：待创建" --content "工作项：<Meegle 链接>"
```

## 5. 验收这一步

- `meegle workitem get --project-key <PK> --work-item-id <ID> --format json` 能读回标题和文档链接。
- `lark-cli docs +fetch --as user --doc <URL> --keyword "工作项"` 能看到 Meegle 链接。
- 预期效果表每一行都有基线（或测法）和观察窗口。

## 输出

给提出人一张卡片：结论、预期效果表、文档链接、工作项链接、待确认问题。下一步通常是 `req-prioritize`。

## 用到的命令

先确认身份和空间（每个会话一次）：

```bash
meegle project search --project-key "<空间名或 key>" --format json
meegle workitem meta-types --project-key <PK> --format json
lark-cli docs +fetch --as user --doc <需求文档 URL> --scope outline
```

字段 key、状态 key、transition_id 一律现查，不要凭记忆填，见 `templates/meegle-field-mapping.md`。

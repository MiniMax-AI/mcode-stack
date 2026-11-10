# 画图规则（所有风格通用）

每张图都是某个风格模板 `styles/<style>/diagram.html` 的副本，只改 `main()`。四个模板的 helper 名字、签名、9 个色槽完全相同，区别只在外观（`STYLE.md`）。本文件是与风格无关的规则；风格自己的字体、配色、额外规则见对应 `STYLE.md`。

## 硬规则

1. **只画 brief 里有的东西。** 先列出用户文字里的名词（角色 / 实体）和动词（动作 / 流转），只画这些。brief 没提到模型、工具、外部服务、存储、消息通道、异常、状态气泡、时间线，就不画。5 个名词的 brief 画 5 个节点，不补全成 12 个节点的「完整系统架构」。拿不准时先问。
2. **颜色跟着概念走，不跟着图走。** 多图系列先写 `diagram-binding.md`（`templates/diagram-binding.md`）：概念 → 色槽 → 形状，之后只追加不改。每张图 `main()` 顶部写 `// Concept color binding` 注释，与绑定表一致。
3. **色槽按抽象语义选**（下表），不按槽名字面意思。不为单张图新增颜色；新概念优先换形状。
4. **框内文字色 = 框的描边色**（`btext` / `node` 已这样做）；模板配色已验证对比度 ≥ 4.5:1，不要改成别的颜色。
5. **箭头一律 `C.flow`**，线不上色；唯一例外是红色虚线异常路径（`{ stroke: C.error.stroke, strokeLineDash: [10, 7] }`）。**红色只用于异常。**
6. **颜色数量按需求定**，最多 9 种；超过 5 种加 `legend()`，只列本图用到的颜色。颜色不能是唯一线索：每个框都有文字。
7. **主角加大加粗**：主角框是其他框的 1.3–1.5 倍，`{ box: { strokeWidth: 3.2 } }`，不靠更亮的颜色。
8. **不用 emoji。** 警示用红色 + 六边形，强调用加粗 + 主色。
9. **`main()` 的颜色和字体只用模板常量。** 用 `C.<slot>`、`C.flow`、`C.caption`、`C.title`、`LABEL_BG`、`FONT_TI` / `FONT_BD`，不写十六进制颜色和字体名；线条粗细、`roughness` 可以照手绘风写，其他风格的 `restyle()` 会把它们换成自己的值。这样同一个 `main()` 能在四种风格里渲染（`scripts/styles.py`），换风格不用重画。少数必须的例外（二维码底的 `'#ffffff'`）写注释说明。
10. **helper 一个都不改、不绕开。** 直接用 `ctx` 画的东西进不了 deck。

## 9 个色槽的抽象语义

| 槽 | 抽象语义（跨领域） | Agent 领域的用法 |
|---|---|---|
| `C.user` | 人 / 发起者 / 系统入口 | 用户、人类输入、人工审批 |
| `C.im` | 通道 / 传输 / 队列 / 消息 / 网关 | IM 渠道、Bus、队列、网关 |
| `C.agent` | 本图主角 / 核心子系统 / 控制面 | 主 Agent、Orchestrator |
| `C.subagent` | 执行者 / 次要子系统 / 处理流水线 | 子 Agent、Worker、Verifier |
| `C.llm` | 模型 / 算法 / 推理 | LLM、Embedding、Reranker |
| `C.tools` | 能力 / 工具 / 隔离环境 | 工具调用、MCP、Sandbox |
| `C.memory` | 存储 / 持久化 / 数据 | 记忆、DB、向量库、对象存储 |
| `C.external` | 外部依赖 / 背景参照 | 第三方 API、外部服务 |
| `C.error` | 异常 / 失败 / 降级（克制使用） | 拒绝、兜底、失败分支 |

## 形状语义

| 形状 | 用途 | helper |
|---|---|---|
| 框 | 实体 / 服务 / 资源 | `box(x, y, w, h, color, override?)`；带文字用 `node()` 或 `bnode()` |
| 长条 | 通道 / 队列 / Bus | `channel(x, y, w, h, color)` |
| 折角卡片 | 任务 / Job / 工作单元 | `taskCard(x, y, w, h, color)` |
| 气泡 | 状态通知 / 推送 | `bubble(x, y, w, h, color, 'left' \| 'right')` |
| 六边形 | 异常 / 决策 / 兜底 | `hexagon(cx, cy, w, h, color)` |
| 虚线时间线 | 时序 / 阶段 | `timeline(x1, y, x2, marks)` |
| 分区框 | 子系统 / 信任区 / 分组 | `frame(x, y, w, h, color, label, labelW)` |

文字：`lbl({ text, sub, ... })` 两行，`plain({ text, ... })` 单行（HTML，`<b>` / `<br>` 可用，字面 `<` `&` 要转义），`title()` / `subtitle()` 是标题。压在线上的文字加 `bg: LABEL_BG`。

## 渲染与自检

模板画完置 `window.__renderDone = true`。用 Playwright 渲染（视口 = 画布尺寸，等 `document.fonts.ready` 和 `__renderDone`），或：

```bash
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 \
  --virtual-time-budget=8000 --screenshot="$PWD/out.png" "file://$PWD/details/01_topic.html"
```

逐张看 PNG：

- [ ] 没有 emoji；字体符合所选风格的 `STYLE.md`
- [ ] 没有字压字、框穿字、箭头穿字；文字都在所属框内，换行后不溢出
- [ ] 每种颜色对应 brief 里的一类概念；超过 5 色有图例；每个框有文字
- [ ] 主角明显更大更粗；箭头都是 `C.flow`，只有异常路径是红色虚线
- [ ] `main()` 有 `// Concept color binding` 注释，且与 `diagram-binding.md` 一致
- [ ] 画布上的每个节点和箭头都能对应到 brief 里的一个名词或动词

# 示例：检索增强问答助手是怎样回答问题的

一个中立的完整范例：讲一个 RAG（检索增强生成）知识问答助手从入库到作答的全过程，只用通用概念（文档、解析、切块、向量模型、向量索引、关键词索引、查询改写、混合检索、重排序、提示词组装、大模型、引用、拒答护栏）。`handdrawn` 风格，中英双语（英文在上、中文在下）。

19 页：封面 → 总览 → 3 个主题 × 5 页（总览聚焦该区 → 细节图全图 → 3 个聚光点）→ 总览 → 结束页。

| 主题 | 总览原则小标题 | 细节图 |
|---|---|---|
| ① 离线入库 | ① Every chunk keeps its source / 每个片段都带着来源 | `details/01_ingestion.html` |
| ② 在线检索 | ② Recall wide, then rank narrow / 先广召回，再精排序 | `details/02_retrieval.html` |
| ③ 回答生成 | ③ Answer only from evidence / 只依据证据作答 | `details/03_generation.html` |

`previews/` 是成品截图（1920×1080 JPEG）：`00_cover`、`overview`、`01_ingestion`、`02_retrieval`、`03_generation`、`99_end`，以及两张转场中间帧 `trans_overview_to_d1`（总览 ① 区 → 细节图，p = 0.55）、`trans_d1_to_spot`（细节图 → 第 1 个聚光点，p = 0.5）。

## 复现

把本目录当项目根目录，拷入引擎和脚本，再按下面填 CONFIG：

```bash
SK=/path/to/magic-move-deck      # 技能目录（SKILL.md 所在目录）
mkdir presentation
cp $SK/templates/keynote.html $SK/scripts/build_deck.py $SK/scripts/snapshot_deck.py presentation/
cd presentation && python3 build_deck.py      # → assets/deck_data.js + rag_assistant_deck.html
```

构建输出应为（每个画出的节点都拿到名字）：

```
cv: 1920x1080  shapes=3 texts=7 images=0 nodes=1 keyed=1
ov: 2400x1510  shapes=42 texts=98 images=0 nodes=15 keyed=15
d1: 1920x1080  shapes=18 texts=62 images=0 nodes=6 keyed=6
d2: 1920x1080  shapes=27 texts=66 images=0 nodes=11 keyed=11
d3: 1920x1080  shapes=23 texts=70 images=0 nodes=7 keyed=7
end: 1920x1080  shapes=3 texts=9 images=0 nodes=1 keyed=1
```

换风格：`python3 $SK/scripts/styles.py apply neon overview.html details/*.html` 后重新构建即可，`main()` 不用改。

## build_deck.py

```python
DECK_NAME = 'rag_assistant_deck'
SOURCES = [
    ('cv', 'details/00_cover.html'),
    ('ov', 'overview.html'),
    ('d1', 'details/01_ingestion.html'),
    ('d2', 'details/02_retrieval.html'),
    ('d3', 'details/03_generation.html'),
    ('end', 'details/99_end.html'),
]
```

## keynote.html

`<title>RAG Knowledge Assistant · 检索增强问答助手</title>`

```js
const SECTIONS = [
  { d: 'd1', ov: [30, 340, 740, 1060], spots: [
    [60, 230, 890, 330],      // 先清洗、保留文档结构，再切块
    [60, 600, 1260, 420],     // 每个片段都带着出处、章节和访问权限
    [1400, 230, 460, 790] ] },// 同一批片段写入两种索引：语义 + 精确词
  { d: 'd2', ov: [800, 340, 780, 1060], spots: [
    [60, 230, 380, 580],      // 追问先改写成能独立检索的查询
    [425, 225, 890, 830],     // 两路召回，按用户权限过滤后再合并
    [1365, 225, 495, 590] ] },// 重排序只留下最相关的几段
  { d: 'd3', ov: [1610, 340, 760, 1060], spots: [
    [470, 260, 560, 630],     // 提示词 = 问题 + 编号证据 + 指令
    [1090, 255, 770, 635],    // 大模型作答，每句结论都标注 [n] 来源
    [1095, 480, 765, 200] ] },// 证据不足就拒答，不编造
];
const ZONES = [
  [/入库|Ingestion/, 'I'],
  [/检索|Retrieval/, 'R'],
  [/生成|Generation/, 'G'],
];
```

## 概念颜色锁定（diagram-binding）

完整表与裁决理由见 `diagram-binding.md`。

| 色槽 | 概念 |
|---|---|
| `C.user` | 用户 |
| `C.memory` | 文档 · 向量索引 · 关键词索引 · Top-k 片段 |
| `C.tools` | 解析清洗 · 切块（片段卡片）· 离线入库分区 |
| `C.subagent` | 向量模型 · 重排序 |
| `C.agent` | 查询改写 · 混合检索（主角，加粗）· 合并去重 · 权限过滤 · 两路召回 · 提示词组装 · 证据检查 · 在线检索分区 |
| `C.llm` | 大模型 · 回答生成分区 |
| `C.im` | 带引用的回答 |
| `C.error` | 拒答（六边形 + 红色虚线） |
| `C.flow` | 所有正常箭头 |

## 值得照抄的写法

| 文件 | 看什么 |
|---|---|
| `overview.html` | 2400×1510 总览；3 个 `frame()` 分区，`fl()` 标签以圈号结尾；原则小标题「① English」+ 正下方中文行放在分区**上方**一条横带里，落在所有 `SECTIONS[].ov` 之外：聚焦页上它们在画面外，飞成细节图标题时两行都从上方进来，提早落位的中文行不必横穿英文行；8 色 > 5，底部 `legend()` |
| `details/01_ingestion.html` | 细节图骨架：`bl` / `fl` / `btext` / `bnode` 本地函数；中文标题与总览小标题下那行**完全同文**，转场是同一行文字变形而不是两段文字交叉淡化；总览上的竖排链条在细节图里改成横向布局，同名框照样飞过去；`taskCard()` 片段卡片画在「切块」框里，转场时从框里长出 |
| `details/02_retrieval.html` | 框里套框（混合检索里的召回 → 权限过滤 → 合并）；另一主题的分区（离线入库的两个索引）以同名小分区出现，总览上的大分区缩成它；关键词 / 向量的左右顺序与总览一致，飞行中两个索引不交叉 |
| `details/03_generation.html` | `stack()` 堆叠框（Top-k 片段）；回答在上、大模型在下，与总览的纵向顺序一致，避免两框在转场中相撞；证据检查 → 红色虚线 → 拒答六边形（「拒答 · 说「不知道」」与总览「拒答」按 ` · ` 前的部分配对）；超过 5 色时的 `legend()` |
| `details/00_cover.html` | 卡片：颜色全部来自 `C.card`；标题「RAG Knowledge Assistant」/「检索增强问答助手」的每个词都在总览标题里，封面 → 总览时全部飞行；副题写成普通 `plain()`，不占 `title()` |
| `details/99_end.html` | 结束卡片：标题与封面相同（64 / 38 px）；三条要点换了措辞，避免和总览小标题同文配对 |

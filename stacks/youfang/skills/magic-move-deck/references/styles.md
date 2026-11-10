# 风格系统：样张、切换与新增风格

## 内置风格

| id | 名称 | 一句话 |
|---|---|---|
| `handdrawn` | 手绘 Hand-drawn | rough.js 手绘线条 + 宋体 / Times + 暖米白纸面 |
| `minimal` | 简约 Minimal | 精确几何 + 圆角 + 无衬线 + 近白底 |
| `neon` | 暗色科技 Neon | 深蓝底 + 霓虹描边柔光 + 切角面板 |
| `brutalist` | 新野兽派 Brutalist | 奶油底 + 粗黑描边 + 高饱和平涂 + 硬投影 |

每个风格是一个目录 `styles/<id>/`：`diagram.html`（模板）、`STYLE.md`（外观、9 色槽、额外规则）、`preview.png`（同一张示例图在该风格下的样张）。`python3 scripts/styles.py list` 列出全部风格。

## 为什么一个 `main()` 能换风格

所有模板对 `main()` 暴露同一套接口，`build_deck.py` 和 `keynote.html` 也只依赖这套接口：

| 接口 | 要求 |
|---|---|
| 画布 | `<div class="stage" style="width: Wpx; height: Hpx;">` + `<canvas id="c" width="W" height="H">` + `<div id="labels">`；脚本结尾恰好一处 `main();\nwindow.__renderDone = true;` |
| 全局 | `canvas`、`ctx`、`rc`（rough.js canvas）、`L`（labels 容器）、`FONT_TI`、`FONT_BD`、`LABEL_BG` |
| `C` | 9 个槽 `user im agent subagent llm tools memory external error`，每个 `{ stroke, fill }`；`flow bg title subtitle caption`；`glow`（deck 里每个形状的 CSS filter，`{c}` 代表该形状描边色，或 `null`）；`card`（`stroke fill accent title text muted glass pane shadow`） |
| helper | `opts arrow box channel taskCard bubble hexagon timeline lbl plain title subtitle node frame legend`，签名与 `styles/handdrawn/diagram.html` 相同 |
| CSS | `.label`、`.ti`（标题字体，700）、`.bd`（正文字体，400）；`.stage` 的 `background` 就是 deck 的纸色 |
| 可选 | `restyle(args, method)`：把 rough.js 每次调用的参数换成本风格的值（返回新数组，不改原参数）；模板自己包装 `rc` 时调用它，`build_deck.py` 镜像 SVG 时也调用它，两边一致 |

`title()` / `subtitle()` 必须分别用 `700 ${size}px ${FONT_TI}` + `C.title`、`400 ${size}px ${FONT_BD}` + `C.subtitle` 绘制：`build_deck.py` 按这个字重和颜色把它们改写成可飞行的 HTML 文字。

节点识别依赖闭合形状：`rc.rectangle / polygon / ellipse / circle`，或以 `Z` 结尾的 `rc.path`（圆角框）。`box()` 要画一个闭合形状；若加投影等附属形状，附属形状要紧挨着框之前绘制、描边色相同、与框高度重叠（`build_deck.py` 视为堆叠框 = 同一节点）。

`build_deck.py` 从每张图导出 `theme`（纸色、`.ti` / `.bd` 字体、`C.glow`、`C.card`），`keynote.html` 自动应用：页面底色、飞行标题的光晕色、形状发光、封面毛玻璃都跟随模板，不需要手改 deck。

## 样张：`styles.py samples`

```bash
python3 <skill>/scripts/styles.py samples details/01_topic.html --out style-samples
```

取这张图的 `main()` 和画布尺寸，套进每个风格模板，输出 `style-samples/<id>.html` + `<id>.png`，以及 2×2 的 `contact-sheet.png`（A–D 标注风格名）。图里引用的图片按原图目录解析。

## 切换风格：`styles.py apply`

```bash
python3 <skill>/scripts/styles.py apply minimal overview.html details/*.html
```

原地替换：换成目标风格的 helper，保留每个文件自己的 `main()` 和画布尺寸。之后重新 `build_deck.py`，看截图：无衬线字体比 Times 宽 10–15%，框内英文可能需要放宽。

## 新增一个风格

1. 复制最接近的 `styles/<id>/` 为新目录，改 `diagram.html` 的 CSS、`FONT_*`、`C`（9 槽对比度 ≥ 4.5:1，`C.card`、`C.glow`）、`opts` / `restyle` 和形状 helper 的外观；**不改任何 helper 的名字和签名**。
2. 写 `STYLE.md`：第一行 `# 中文名 English`，第二行 `<!-- order: N -->`，第三行 `> 一句话描述`（`styles.py` 读这三行），然后是视觉要素、9 色槽表、额外规则。
3. 用示例跑样张，把该风格的 PNG 存为 `styles/<id>/preview.png`：`python3 scripts/styles.py samples examples/rag-assistant/details/01_ingestion.html --out /tmp/ss --styles <id>`。
4. 用示例项目 `apply` 新风格后完整构建一次 deck，按 `verification.md` 截图检查封面、总览 ↔ 细节转场和聚光点。

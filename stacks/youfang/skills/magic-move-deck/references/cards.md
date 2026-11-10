# 封面与结束页卡片

可选。`build_deck.py` 的 `SOURCES` 里有 `cv` 就有封面，有 `end` 就有结束页；起点模板 `templates/card-main.js`。

## 画面

- 封面：总览图推近 6%、蒙一层毛玻璃（`keynote.html` 的 `#glass`），卡片浮在上面（`#card` 是更密的一层毛玻璃，按卡片里**面积最大的形状**定位）。总览自己的 `title()` 在封面上隐藏，因为卡片标题就是它。
- 结束页同样是毛玻璃上的卡片，**标题和封面相同**；另外可以放截图、二维码、slogan、致谢。

## 转场 `coverTrans`

封面 → 总览：卡片标题的字词用神奇效果飞到总览左上角标题的位置，颜色从卡片标题色（`C.card.title`）渐变到总览标题色；卡片和其余元素在 `[0, .14]` 淡出；随后毛玻璃从标题处向外径向擦开（`[.42, 1]`），其余全局细节显现。总览 → 结束页是它的倒放：毛玻璃合上，总览标题的字词飞回卡片标题；只在卡片上出现的元素（截图、二维码）淡入。

改卡片或时间参数时守住这几条：

- **标题行按文字种类配对，不按行号。** `cjk()` 判断一行是不是中文：中文行配中文行、英文行配英文行。哪一边的行序变了都不会配错，所以不要改成按行号。推论：卡片上每种文字最多一行 `title()`；单语 deck 的卡片只用一行 `title()`，否则两行都会去配总览的同一行，多出重复淡入的词。
- **词的单位**：拉丁单词、单个 CJK 字。两边相同的词飞行；卡片独有的词淡出，总览独有的词在 `[.42, .7]` 淡入。卡片标题尽量用总览标题里的词。
- **超车词。** 同一行里横向要越过同行其他词的词（「云端 Agent」→「Agent 云端」里的「Agent」）。有超车词的那一行保持平，超车词朝远离另一行的方向跳开；没有超车词的那一行朝远离另一行的方向弧起。
- **超车词的纵向位置跟着整行走（行进度 `q` 插值），跳开量是叠加的纯偏移。** 用自己的进度插值会在跳开中途压到另一行的字。跳开量不小于字高。
- **卡片和其余元素的淡出窗口 `[0, .14]` 不要放慢。** 向下跳开的词在 p≈0.10–0.22 会扫过卡片标题的下划线，下划线必须在那之前淡完；不要靠缩小跳开量或下移下划线来避让。

## 配色

卡片是 9 色槽的唯一例外，用所选风格模板里的 `C.card`（`templates/card-main.js` 开头 `const K = C.card; C.title = K.title;`，`title()` 调用时读取 `C.title`）。卡片框用风格自己的 `box()` 画，所以手绘风是手绘框、简约风是圆角框、暗色科技是切角发光框、新野兽派带硬投影。

| 字段 | 用途 |
|---|---|
| `stroke` / `fill` | 卡片边框 / 填充（填充半透明，透出后面的毛玻璃） |
| `accent` | 标题下划线、分隔线、二维码说明文字 |
| `title` | 卡片大标题；飞到总览时渐变为总览标题色 `C.title` |
| `text` / `muted` | 正文 / 次要文字（团队、分享人） |
| `glass` | `#glass` 毛玻璃的 CSS `background`（通常是渐变） |
| `pane` / `shadow` | `#card` 卡片底板的半透明背景 / `box-shadow` |

`build_deck.py` 导出 `C.card`，`keynote.html` 自动用 `glass` / `pane` / `shadow` 设置毛玻璃，不需要改 deck 的 CSS。要套用品牌色时，在卡片 `main()` 开头覆盖 `C.card` 的字段（如 `Object.assign(C.card, { stroke: '#…', accent: '#…', glass: '…' })`），封面和结束页写同样的覆盖。

## 字号

封面标题英文 72px、中文 44px；结束页标题英文 64px、中文 38px；英文在上。卡片上的英文文案以官网 / 产品原文为准，不自造 slogan。

## 图片

在 `main()` 里定义局部 `pic(src, x, y, w, h)`（模板已有）：往 `#labels` 加 `<img class="label">`。图片放在图旁的 `assets/`，路径相对于图的 HTML；`build_deck.py` 内联成 data URI（支持 webp / png / jpg / svg）。产品截图先缩到约 480px 宽再放，控制单文件体积。

## 二维码

33×33 模块、纠错等级 Q、`#171717` 印白底，生成为 SVG（需要 `pip install qrcode`，可在 venv 里装）：

```python
import qrcode
URL, OUT = 'https://example.com/download', 'details/assets/qr.svg'
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, border=2)
qr.add_data(URL); qr.make(fit=True)
n, b, d = qr.modules_count + 4, 2, ''
for y, row in enumerate(qr.modules):
    x = 0
    while x < len(row):
        if not row[x]: x += 1; continue
        s = x
        while x < len(row) and row[x]: x += 1
        d += f'M{s+b} {y+b}h{x-s}v1h-{x-s}z'
open(OUT, 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges"><rect width="{n}" height="{n}" fill="#ffffff"/><path fill="#171717" d="{d}"/></svg>')
```

放在白色方块里（模板注释里的 QR tile；暗色风格也必须是白底）。生成后用手机扫 deck 第一页和最后一页确认。

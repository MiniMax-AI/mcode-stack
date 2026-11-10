# 验证、视频与分享

结论以截图目检为准，不能只看脚本退出码。

## 1. 构建输出

`python3 build_deck.py` 每张图打印一行：

```
d1: 1920x1080  shapes=34 texts=59 images=0 nodes=10 keyed=10
```

- `nodes` 是闭合形状组成的节点数，`keyed` 是拿到名字的节点数。`keyed` 明显少于你画的节点 → 有框里没有文字，或文字没画进框（先画框、再画字，字的中心要落在框内）。
- 名字没对上的元素不会飞到对方位置，只会跟着所在的框或区域移动、同时淡入淡出。
- 只改排版 / 顺序 / 字号、没改文案时，导出改前改后 `assets/deck_data.js` 里每张图的节点名（`nodes[].key`）和分区名（`shapes[].fkey`）对比，应完全一致：

```bash
python3 - <<'EOF'
import json
d = json.loads(open('assets/deck_data.js').read().removeprefix('window.DECK_DATA = ').rstrip().rstrip(';'))
for k, v in d.items():
    print(k, [n['key'] for n in v['nodes']], [s['fkey'] for s in v['shapes'] if 'fkey' in s])
EOF
```

## 2. 截图检查：`scripts/snapshot_deck.py`

测试钩子 `window.__deck.freeze(i, j, p)` 把 i→j 的转场冻结在进度 p（索引从 0 开始；同一组 i→j 复用同一个转场对象，返回时长 ms）；`__deck.setState(i)` 直接显示第 i 页。脚本封装了常用检查，页面报错时退出码为 1：

```bash
python3 snapshot_deck.py keynote.html --out /tmp/shots --slides                 # 逐页截图
python3 snapshot_deck.py keynote.html --out /tmp/shots --trans 1-2,2-1 --p 0.06,0.15,0.3,0.5
python3 snapshot_deck.py keynote.html --out /tmp/shots --overlap 1-2,2-1        # 标题飞行时英文行 × 中文行文字框重叠（只算画面内）
python3 snapshot_deck.py deck.html --offline                                     # 单文件：0 个 http 引用、断网逐页可渲染
```

检查清单：

- [ ] 每页截图无报错、无空白页；聚光点取景完整，结论所在元素在画面里。
- [ ] 改动涉及的转场：p≈0.06–0.5 多取几帧，看有没有字压字、框穿字；**倒放方向 j→i 也要看**。
- [ ] 改了细节图标题或引擎 2c：所有「总览聚焦 ↔ 细节全图」转场跑 `--overlap`（N 个主题，有封面时是 `2-3, 7-8, 12-13 …` 共 N 对，双向），按输出的坐标和 p 冻结截图确认墨迹是否相碰。扫描会算上所有飞行中的英文 × 中文行（包括总览侧正在淡出的小标题、双圈号标题合并进来的第二个小标题），所以几像素高的擦边是常态；几十像素宽、十几像素高且两边都清晰可见的重叠要改图（缩短标题、调整总览小标题位置）。
- [ ] 改了卡片或 `coverTrans`：`0→1`、`1→0`、`倒数第二→最后`、`最后→倒数第二` 四个转场在 p=0.04–0.46 之间逐帧看，重点看超车词是否压到另一行或卡片下划线。
- [ ] 二维码能扫出目标链接。
- [ ] 单文件版拷到别处断网打开能翻完全部页；不引入外链字体或脚本，只依赖所选风格 `STYLE.md` 里的系统字体。
- [ ] 换过风格（`styles.py apply`）后：框内文字没有溢出（无衬线比 Times 宽），暗色风格没有写死的黑字 / 白底。

页数对照：`[cv] + ov + 5N + ov + [end]`。

## 3. 演示操作

单文件 `<DECK_NAME>.html` 用 Chrome 打开，`F` 全屏；`→` / 空格 / `Enter` / `PageDown` 下一页，`←` 上一页，`Home` / `End` 首末页；鼠标点击翻页，点左侧 20% 后退；网址末尾加 `#N` 直接打开第 N 页。

## 4. 视频：`scripts/render_video.py`

```bash
python3 render_video.py music.mp3             # 4K + 1080p，输出到 video/（加进 .gitignore）
python3 render_video.py --mux-only music.mp3  # 只换配乐，复用 video/silent_*.mp4
```

- 用 `freeze` 逐帧截图（60fps），节奏与网页一致、与机器快慢无关；每页停留时长在 `hold_seconds()` 改。34 页约录 9 分钟。
- 片头片尾从纸色（deck 的底色，随风格变化）淡入淡出；配乐自动裁切、淡入淡出、响度归一到 -16 LUFS（true peak ≤ -1 dBFS）。
- 配乐要优雅、节奏弱，用小提琴或民族乐器，不要鼓点和明显律动。注意版权。
- 依赖 ffmpeg（`brew install ffmpeg`）。

## 5. 分享与部署

- 单文件完全离线，可直接发送、拷贝，或作为静态页面部署到任意静态托管（GitHub Pages、对象存储、内部静态站点等），改名 `index.html` 即可。
- 源文件（图的 `.html`、`keynote.html`、脚本）和生成物（`assets/deck_data.js`、单文件）一起提交；改了图跑 `build_deck.py`，只改 `keynote.html` 跑 `build_deck.py --bundle`。
- 部署会改变线上内容：执行前先征得用户同意；部署后下载线上文件和本地单文件对比哈希（`shasum`），并把链接写进项目 README。

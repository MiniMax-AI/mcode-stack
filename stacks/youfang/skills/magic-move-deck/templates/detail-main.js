function main() {
  // Starter main() for a 1920×1080 detail diagram of a Magic Move deck.
  // Use: copy the chosen styles/<style>/diagram.html (already 1920×1080), replace its main() with this one,
  // then draw. Never edit or bypass the helpers above main(): build_deck.py hooks rc.*, plain, lbl, title,
  // subtitle, frame, arrow, timeline, taskCard, bubble, legend by name; anything painted straight onto ctx
  // never reaches the deck. Every style exposes the same helpers, so this main() renders in any style:
  // don't hard-code a look (roughness, fonts, hex colours) — use C.<slot>, opts(), FONT_TI / FONT_BD.
  //
  // Concept color binding (must match the series' diagram-binding table):
  //   C.agent = ...   C.tools = ...   C.flow = all normal arrows   C.error = rejected / unreachable (red dashed)

  // ---------- Bilingual helpers (pairs are always passed as (中文, English); English leads, larger) ----------
  // Two-line label: English line, then a smaller Chinese line under it.
  const bl = (zh, en, zhSize = 13) => `${en}<br><span style="font-size:${zhSize}px">${zh}</span>`;
  // One-line label "English<em space>中文" — every frame() label uses it (build_deck.py splits on the em space).
  const fl = (zh, en) => `${en}&emsp;<span style="font-size:14px">${zh}</span>`;
  // Shrink the last label to its text width, so its ivory background only masks what it covers.
  const fitLast = () => { L.lastChild.style.width = 'max-content'; };
  // Block centered in (x, y, w, h): EN title / smaller CN title / detail pairs (EN over smaller CN; 'gap' = spacer).
  // The CN title is the node's pairing name: keep it the first bold CJK line inside the box.
  const btext = (x, y, w, h, color, [tz, te], subs = [], o = {}) => {
    const size = o.size || 22, zhSize = o.zhSize || Math.round(size * 0.68);
    const subSize = o.subSize || 15, zhSubSize = o.zhSubSize || 13, pairGap = o.pairGap || 4;
    let html = `<div class="ti" style="font-size:${size}px">${te || tz}</div>`;
    if (te) html += `<div class="ti" style="font-size:${zhSize}px;margin-top:1px">${tz}</div>`;
    let pending = 0, first = true;
    subs.forEach((s) => {
      if (s === 'gap') { pending += 12; return; }
      const [sz, se] = s, mt = (first ? 8 : pairGap) + pending;
      first = false; pending = 0;
      html += `<div style="margin-top:${mt}px;opacity:.88">` +
              `<div style="font-size:${subSize}px">${se || sz}</div>` +
              (se ? `<div style="font-size:${zhSubSize}px">${sz}</div>` : '') + `</div>`;
    });
    plain({ text: html, x, y, w, color: color.stroke, size: subSize });
    L.lastChild.style.top = y + (h - L.lastChild.offsetHeight) / 2 + 'px';   // measured: a wrapped line stays centered
  };
  // Node = box + centered bilingual block. Main subject: bigger box + { box: { strokeWidth: 3.2 } }.
  const bnode = (x, y, w, h, color, t, subs, o = {}) => {
    box(x, y, w, h, color, o.box || {});
    btext(x, y, w, h, color, t, subs, o);
  };
  const RED = { stroke: C.error.stroke, strokeLineDash: [10, 7] };

  // ---------- Title: exactly two title() calls — English (starts with the overview principle's ①–⑳), then Chinese ----------
  const head = '① Principle in English';
  ctx.font = `700 40px ${FONT_TI}`;
  const headW = ctx.measureText(head).width + 24;
  title(head, 60, 66, 40);
  title('中文标题', 60 + headW, 66, 28);
  subtitle('One English sentence: the claim this diagram proves.', 60, 104, 21);
  subtitle('一句中文：这张图要证明的结论', 60, 134, 18);

  // ---------- Zones: frame() + fl(); the label carries a zone keyword listed in keynote.html ZONES ----------
  frame(40, 220, 900, 800, C.agent, fl('受信控制面', 'Trusted control plane'), 10); fitLast();
  frame(980, 220, 900, 800, C.tools, fl('隔离执行区', 'Isolated execution zone'), 10); fitLast();

  // ---------- Nodes: same Chinese name as on the overview, so the box morphs instead of fading ----------
  bnode(100, 300, 360, 240, C.agent, ['业务服务', 'Business service'],
        [['会话 · 权限', 'Sessions · permissions']], { size: 30, zhSize: 19, subSize: 17, zhSubSize: 14, box: { strokeWidth: 3.2 } });
  bnode(1040, 300, 300, 200, C.tools, ['安全沙箱', 'Sandbox'], [['一任务一沙箱', 'One task, one sandbox']]);
  arrow(462, 400, 1038, 400);
  plain({ text: bl('工具调用', 'Tool calls', 14), x: 600, y: 350, w: 300, color: C.caption, size: 16 });
}

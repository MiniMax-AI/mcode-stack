function main() {
  // Starter main() for the opening card (key 'cv') or closing card (key 'end'), 1920×1080.
  // Use: copy the chosen styles/<style>/diagram.html, replace its main() with this one.
  // Colours come from the style's C.card (card frame / fill / accent / title / text); the deck's frosted glass
  // behind the card (C.card.glass / pane / shadow) is applied by keynote.html automatically.
  // In the deck the card floats over the frosted overview; rendered alone it is a standalone cover.
  // Contract with keynote.html:
  //   - the card is the LARGEST shape in this diagram (keynote's frosted #card pane is sized from it);
  //   - its title is drawn with title() — its words fly to the overview's title() words with the same text,
  //     CJK line ↔ CJK line, Latin line ↔ Latin line (by script, not by line order);
  //   - the closing card repeats the opening card's title, so overview → end replays the cover move backwards.
  const K = C.card;
  C.title = K.title;                    // title() reads C.title at call time
  const W = canvas.width, cx = W / 2;
  const centered = (text, size) => { ctx.font = `700 ${size}px ${FONT_TI}`; return cx - ctx.measureText(text).width / 2; };
  // Picture on the label layer; build_deck.py inlines it as a data URI. Path is relative to this HTML file.
  // Pictures never pair in Magic Move — they only fade.
  const pic = (src, x, y, w, h) => {
    const im = document.createElement('img');
    im.src = src; im.className = 'label';
    Object.assign(im.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    L.appendChild(im);
  };

  // The card: drawn with the style's own box(), so it matches the diagrams (rough / rounded / chamfered / shadowed).
  box(330, 249, 1260, 580, { stroke: K.stroke, fill: K.fill });

  // Use the overview title's words: every shared word flies; the rest fades.
  const en = 'Deck Title In English', zh = '中文演示标题';
  title(en, centered(en, 72), 446, 72);   // closing card: 64 / 38 px
  title(zh, centered(zh, 44), 514, 44);
  rc.line(cx - 290, 557, cx + 290, 557, { stroke: K.accent, strokeWidth: 2.2, roughness: 1.1, bowing: 1 });

  lbl({ text: 'Team Name', sub: '团队名', x: cx - 470, y: 640, w: 420, color: K.muted, size: 32, subSize: 19 });
  rc.line(cx, 642, cx, 712, { stroke: K.accent, strokeWidth: 1.6, roughness: 1.2 });
  lbl({ text: 'Speaker Name', sub: '分享人', x: cx + 50, y: 640, w: 420, color: K.muted, size: 32, subSize: 19 });

  // Optional QR tile, bottom right (see references/cards.md for generating assets/qr.svg).
  // const qx = 1668, qy = 776, qs = 196;
  // rc.rectangle(qx, qy, qs, qs, { stroke: K.stroke, strokeWidth: 2, roughness: 1.3, bowing: 1, fill: '#ffffff', fillStyle: 'solid' });
  // pic('assets/qr.svg', qx + 14, qy + 14, qs - 28, qs - 28);
  // plain({ text: 'Scan to ...', x: qx - 40, y: qy + qs + 12, w: qs + 80, color: K.accent, size: 18, weight: 700 });
}

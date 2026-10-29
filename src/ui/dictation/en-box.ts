/**
 * 英文单词听写的四线三格:孩子写字页、家长页、录像页共用一份画法,插进各页的内联脚本与样式。
 * 一格 = 一个单词,坐标 2048 × 512(笔迹的点也记在这个尺子上,y 朝下);四条线在 80 / 200 / 320 / 440,第三条是基线(红)。
 * 写字屏的格子铺满、按屏幕大小只露尺子的一段(en-page.ts 的 fitPad);对一对、录像、家长页照 EN_VIEW。
 * 格子上下各多露一截:画的视窗是 EN_VIEW(0 -192 2048 896,16 : 7),四条线在中间,写出格的笔画照样看得见;尺子不变,出格的点 y 为负或大于 512。
 * 单词的样子用单词卡那套字形画(drawtell/glyphs:52 个字母的印刷体笔顺,按四线三格归一化):x 高 = 中格 120,
 * b d h k l 与大写顶第一线、g j p q y 到第四线、t 的头在上格中间。原来用字体(Chalkboard SE),升部只到上格六成、降部只到下格一半,孩子照着描也矮。
 * 不逐字母比,只叠着给孩子自己对:长单词横着压(坐标压,笔画粗细不变);有字形包里没有的字(数字、标点)整个词退回字体。
 * 脚本是 ES5、没有反斜杠与反引号。
 */
import { GLYPHS, SPACE_ADVANCE } from 'drawtell/glyphs';
import { EXTRA, GAP } from '../kid/letters.ts';

const r = (v: number): number => Math.round(v * 1000) / 1000;

/** 字形压成一张表:{ 字: [宽, [一笔: 起点 x, 起点 y, 段…]…] },段 = 'L' x y | 'A' cx cy rx ry a0 a1 | 'C' x1 y1 x2 y2 x y;x 高为 1,基线 y = 0,y 朝下 */
function glyphTable(): Record<string, [number, (string | number)[][]]> {
  const out: Record<string, [number, (string | number)[][]]> = {};
  for (const [ch, g] of GLYPHS) {
    out[ch] = [r(g.advance), g.strokes.map((st) => [r(st.start[0]), r(st.start[1]), ...st.segs.flatMap((s): (string | number)[] =>
      s.k === 'L' ? ['L', r(s.to[0]), r(s.to[1])]
        : s.k === 'A' ? ['A', r(s.cx), r(s.cy), r(s.rx), r(s.ry), s.a0, s.a1]
          : ['C', r(s.c1[0]), r(s.c1[1]), r(s.c2[0]), r(s.c2[1]), r(s.to[0]), r(s.to[1])])])];
  }
  for (const [ch, g] of Object.entries(EXTRA)) out[ch] = [g.advance, g.strokes.map((pts) => [pts[0][0], pts[0][1], ...pts.slice(1).flatMap(([x, y]) => ['L', x, y])])];
  return out;
}

export const EN_BOX_JS = `
  var EN_W = 2048, EN_H = 512, EN_LINES = [80, 200, 320, 440], EN_TOP = -192, EN_VH = 896, EN_VIEW = '0 -192 2048 896';
  var enLines = function (sv) { var g = sv('g', { 'class': 'enl' }); for (var k = 0; k < EN_LINES.length; k++) g.append(sv('line', { x1: -EN_W, y1: EN_LINES[k], x2: 2 * EN_W, y2: EN_LINES[k], 'class': k === 2 ? 'base' : 'ln' })); return g; };
  /** 字形(单词卡同一套):x 高 = 中格 120,基线在第三条线 */
  var EN_GL = ${JSON.stringify(glyphTable())}, EN_GAP = ${GAP}, EN_SPACE = ${SPACE_ADVANCE}, EN_U = 120, EN_BASE = 320;
  /** 一笔 → path 的 d(尺子坐标);x0 是这个字母的左边,sx 横着压(弧的 rx 跟着压,笔画粗细不变);弧一段不超过 90 度,省得大弧小弧分不清 */
  var enStrokeD = function (st, x0, sx) {
    var X = function (x) { return Math.round((x0 + x * EN_U * sx) * 10) / 10; }, Y = function (y) { return Math.round((EN_BASE + y * EN_U) * 10) / 10; };
    var d = 'M' + X(st[0]) + ' ' + Y(st[1]), i = 2;
    while (i < st.length) {
      if (st[i] === 'L') { d += ' L' + X(st[i + 1]) + ' ' + Y(st[i + 2]); i += 3; continue; }
      if (st[i] === 'C') { d += ' C' + X(st[i + 1]) + ' ' + Y(st[i + 2]) + ' ' + X(st[i + 3]) + ' ' + Y(st[i + 4]) + ' ' + X(st[i + 5]) + ' ' + Y(st[i + 6]); i += 7; continue; }
      var cx = st[i + 1], cy = st[i + 2], rx = st[i + 3], ry = st[i + 4], a0 = st[i + 5], a1 = st[i + 6], n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
      for (var j = 1; j <= n; j++) { var a = (a0 + (a1 - a0) * j / n) * Math.PI / 180; d += ' A' + Math.round(rx * EN_U * sx * 10) / 10 + ' ' + Math.round(ry * EN_U * 10) / 10 + ' 0 0 ' + (a1 > a0 ? 1 : 0) + ' ' + X(cx + rx * Math.cos(a)) + ' ' + Y(cy + ry * Math.sin(a)); }
      i += 7;
    }
    return d;
  };
  /** 一个单词多宽(x 高为 1,字间距同单词卡);有写不出的字 → -1 */
  var enWidth = function (word) {
    var x = 0, last = false;
    for (var i = 0; i < word.length; i++) { var ch = word.charAt(i); if (ch === ' ') { x += EN_SPACE; last = false; continue; } var g = EN_GL[ch]; if (!g) return -1; x += g[0] + EN_GAP; last = true; }
    return last ? x - EN_GAP : x;
  };
  /** 写不出的字(数字、标点):整个词用字体,长了压窄 */
  var enWordFont = function (sv, word, cls, room) { var t = sv('text', { x: EN_W / 2, y: EN_BASE, 'text-anchor': 'middle', 'class': (cls || 'enw') + ' font', 'data-word': word }); if (word.length > 12 || word.length * 132 > room) { t.setAttribute('textLength', String(Math.round(Math.min(room, word.length * 132)))); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); } t.textContent = word; return t; };
  /** 单词的样子(一个 g,一笔一条 path,居中);maxW = 最多多宽(写字屏只看得到尺子的一段),放不下就横着压 */
  var enWord = function (sv, word, cls, maxW) {
    var room = Math.min(EN_W - 160, maxW || EN_W), w = enWidth(word);
    if (w < 0) return enWordFont(sv, word, cls, room);
    var full = w * EN_U, sx = full > room ? room / full : 1, x = EN_W / 2 - full * sx / 2;
    var g = sv('g', { 'class': cls || 'enw', 'data-word': word, 'data-x': String(Math.round(x)), 'data-w': String(Math.round(full * sx)) });
    for (var i = 0; i < word.length; i++) {
      var ch = word.charAt(i);
      if (ch === ' ') { x += EN_SPACE * EN_U * sx; continue; }
      var gl = EN_GL[ch];
      for (var k = 0; k < gl[1].length; k++) g.append(sv('path', { d: enStrokeD(gl[1][k], x, sx) }));
      x += (gl[0] + EN_GAP) * EN_U * sx;
    }
    return g;
  };
  /** 一小条四线格里的单词(再写一遍时上面照着看的那个):视窗只框住单词左右,四条线上下各留一点 */
  var enModel = function (sv, word) {
    var g = enWord(sv, word, 'enw solid'), x = Number(g.getAttribute('data-x') || 160), w = Number(g.getAttribute('data-w') || EN_W - 320);
    var svg = sv('svg', { viewBox: (x - 60) + ' 40 ' + (w + 120) + ' 440', 'class': 'enm', 'aria-label': word, role: 'img' });
    svg.append(enLines(sv), g);
    return svg;
  };
`;

export const EN_BOX_CSS = `
  .enl line { stroke:#cfd8e3; stroke-width:6; }
  .enl line.base { stroke:#e7a3a3; }
  .enw { opacity:.3; }
  .enw path { fill:none; stroke:#2f6fd6; stroke-width:30; stroke-linecap:round; stroke-linejoin:round; }
  .enw.trace { opacity:.4; }
  .enw.trace path { stroke:#9b978e; }
  .enw.solid { opacity:1; }
  .enw.font { font-size:240px; font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; fill:#2f6fd6; }
  .enw.font.trace { fill:#9b978e; }
  .eni path { fill:none; stroke:#2b2b2b; stroke-width:22; stroke-linecap:round; stroke-linejoin:round; }
`;

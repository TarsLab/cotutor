/**
 * 英文单词听写的四线三格(《wip/听写设想.md》拍板 15):孩子写字页、家长页、录像页共用一份画法,插进各页的内联脚本与样式。
 * 一格 = 一个单词,坐标 2048 × 512(笔迹的点也记在这个尺子上,y 朝下);四条线在 80 / 200 / 320 / 440,第三条是基线(红)。
 * 格子上下各多露一截(《wip/听写设想.md》拍板 22):画的视窗是 EN_VIEW(0 -192 2048 896,16 : 7),四条线在中间,写出格的笔画照样看得见;尺子不变,出格的点 y 为负或大于 512。
 * 单词的样子用字体画(不逐字母比,只叠着给孩子自己对):基线压在第三条线上,长单词压窄。脚本是 ES5、没有反斜杠与反引号。
 */
export const EN_BOX_JS = `
  var EN_W = 2048, EN_H = 512, EN_LINES = [80, 200, 320, 440], EN_TOP = -192, EN_VH = 896, EN_VIEW = '0 -192 2048 896';
  var enLines = function (sv) { var g = sv('g', { 'class': 'enl' }); for (var k = 0; k < EN_LINES.length; k++) g.append(sv('line', { x1: 0, y1: EN_LINES[k], x2: EN_W, y2: EN_LINES[k], 'class': k === 2 ? 'base' : 'ln' })); return g; };
  var enWord = function (sv, word, cls) { var t = sv('text', { x: EN_W / 2, y: 320, 'text-anchor': 'middle', 'class': cls || 'enw' }); if (word.length > 12) { t.setAttribute('textLength', String(EN_W - 160)); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); } t.textContent = word; return t; };
`;

export const EN_BOX_CSS = `
  .enl line { stroke:#cfd8e3; stroke-width:6; }
  .enl line.base { stroke:#e7a3a3; }
  .enw { font-size:240px; font-family:"Chalkboard SE","Comic Sans MS","Marker Felt",sans-serif; fill:#2f6fd6; fill-opacity:.3; }
  .enw.trace { fill:#9b978e; fill-opacity:.4; }
  .eni path { fill:none; stroke:#2b2b2b; stroke-width:22; stroke-linecap:round; stroke-linejoin:round; }
`;

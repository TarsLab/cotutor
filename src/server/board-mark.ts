/**
 * 板书的底纹(《产品规划.md》拍板 27):老师页的板是一张有质感的纸,三门主科在右边竖着写一个很淡的学科名,像课本的书脊。
 * - 纸:底色照旧 var(--paper),上面平铺一块 800 见方的 SVG(大片云斑 + 细颗粒 + 一百来根短纤维,feTurbulence 拼缝不露),所有老师都铺
 * - 字:照课本封面——语文毛笔「语文」、数学粗宋「数学」、英语「ENGLISH」;轮廓是 board-mark-art.ts 里烤好的(scripts/bake-board-marks.py),页面不加载字体
 *   别的老师(口播、家长自己加的)只铺纸不写字
 * 字放在 #wrap 里垫底的 #bmark:不跟板书滚,卡铺上来盖住就盖住;字号 s 跟着板走(板高的 48%、板宽的 72% 取小的)。
 * 脚本是 ES5、没有反斜杠与反引号(插进老师页的模板字符串)。tests/board-mark.test.ts 盯着。
 */
import { canonicalSubject } from '../schema/config.ts';
import { BOARD_MARK_ART } from './board-mark-art.ts';

export type BoardMarkId = keyof typeof BOARD_MARK_ART;

const BY_SUBJECT: Readonly<Record<string, BoardMarkId>> = { 语文: 'yuwen', 数学: 'shuxue', 英语: 'english' };

/** 这位老师的板上写什么:三门主科(含别名)各一个,别的 null(只铺纸) */
export function boardMarkOf(subject: string | null | undefined): BoardMarkId | null {
  return BY_SUBJECT[canonicalSubject(subject) ?? ''] ?? null;
}

/**
 * 怎么摆:right = 外框右沿离板右沿多远(乘 s;负数出纸边),top = 离板顶多少 px(加安全区),o = 不透明度。
 * 三种字墨量差得多(粗宋最重、ENGLISH 最轻),浓淡分开压到看着一样淡;ENGLISH 是孩子认得的词,字母不切边
 */
export const BOARD_MARK_PLACE: Readonly<Record<BoardMarkId, { right: number; top: number; o: number }>> = {
  yuwen: { right: -0.07, top: 30, o: 0.065 },
  shuxue: { right: -0.07, top: 28, o: 0.05 },
  english: { right: 0.03, top: 34, o: 0.05 },
};

/** 字的墨色(暖一点的深褐,压在纸色上) */
export const BOARD_INK = '#4a3f2e';

// ---- 纸:一块能平铺的 SVG ----
const TILE = 800;
/** 短纤维:固定种子,每次一样;整根落在块里头,拼起来不断 */
function fibers(n: number): string {
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const r = (v: number): string => v.toFixed(0);
  let d = '';
  for (let k = 0; k < n; k++) {
    const len = 10 + rnd() * 34;
    // 一根最长 44、弯 7:离边 60 起,整根落在块里
    const x = 60 + rnd() * (TILE - 120);
    const y = 60 + rnd() * (TILE - 120);
    const a = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * 14;
    const x2 = x + Math.cos(a) * len;
    const y2 = y + Math.sin(a) * len;
    const cx = (x + x2) / 2 + Math.cos(a + Math.PI / 2) * bend;
    const cy = (y + y2) / 2 + Math.sin(a + Math.PI / 2) * bend;
    d += `M${r(x)} ${r(y)}Q${r(cx)} ${r(cy)} ${r(x2)} ${r(y2)}`;
  }
  return d;
}

/** 纸的那块 SVG:云斑(很低频,像宣纸吃墨不匀)、细颗粒、纤维;两层噪声都 stitchTiles,平铺看不出缝 */
export const PAPER_SVG = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">`,
  '<defs>',
  `<filter id="c" x="0" y="0" width="${TILE}" height="${TILE}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.003 0.0045" numOctaves="3" seed="11" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.54  0 0 0 0 0.38  0 0 0 0.6 -0.22"/></filter>`,
  `<filter id="g" x="0" y="0" width="${TILE}" height="${TILE}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.39  0 0 0 0 0.28  0 0 0 0.7 -0.32"/></filter>`,
  '</defs>',
  `<rect width="${TILE}" height="${TILE}" filter="url(#c)" opacity="0.55"/>`,
  `<rect width="${TILE}" height="${TILE}" filter="url(#g)" opacity="0.7"/>`,
  `<path d="${fibers(110)}" fill="none" stroke="#7d6c4f" stroke-width="0.6" stroke-linecap="round" opacity="0.14"/>`,
  '</svg>',
].join('');

export const PAPER_URI = `data:image/svg+xml,${encodeURIComponent(PAPER_SVG)}`;

/** 老师页的样式:纸铺在 #tutor 上(实时的左栏白纸盖住它那块;板顶上那条渐隐用同一张 --paper-tex),字在 #bmark */
export const BOARD_MARK_CSS = `
  #tutor { --paper-tex:url("${PAPER_URI}") 0 0 / ${TILE}px ${TILE}px; background:var(--paper-tex), var(--paper); }
  #bmark { position:absolute; inset:0; z-index:-1; overflow:hidden; pointer-events:none; container-type:size; color:${BOARD_INK}; }
  #bmark[hidden] { display:none; }
  #bmark svg { position:absolute; display:block; --s:min(48vh, 72vw); top:calc(env(safe-area-inset-top) + var(--bm-top) * 1px); right:calc(var(--s) * var(--bm-right)); width:calc(var(--s) * var(--bm-w)); height:calc(var(--s) * var(--bm-h)); opacity:var(--bm-o); }
  @supports (width:1cqh) { #bmark svg { --s:min(48cqh, 72cqw); } }
`;

/** 平板横屏实时、左撇子:白纸在右边,字挪到左边(插进老师页那段横屏媒体查询里) */
export const BOARD_MARK_HAND_LEFT_CSS = `body.live.hand-left #bmark svg { right:auto; left:calc(var(--s) * var(--bm-right)); }`;

const MARKS_JSON = JSON.stringify(
  Object.fromEntries(
    (Object.keys(BOARD_MARK_ART) as BoardMarkId[]).map((id) => {
      const a = BOARD_MARK_ART[id];
      const p = BOARD_MARK_PLACE[id];
      return [id, { w: a.w, h: a.h, d: a.d, right: p.right, top: p.top, o: p.o }];
    }),
  ),
);

/** markBoard(el, t):把 t.mark 那个字放进 el(#bmark);t 没有 mark(别的老师、还不知道是谁)就收起来 */
export const BOARD_MARK_JS = `
  var BOARD_MARKS = ${MARKS_JSON};
  var markBoard = function (el, t) {
    if (!el) return;
    var id = t && t.mark;
    var m = id ? BOARD_MARKS[id] : null;
    if (!m) { el.hidden = true; el.textContent = ''; el.removeAttribute('data-mark'); return; }
    if (el.getAttribute('data-mark') === id) { el.hidden = false; return; }
    el.setAttribute('data-mark', id);
    el.innerHTML = '<svg viewBox="0 0 ' + Math.round(m.w * 1000) + ' ' + Math.round(m.h * 1000) + '" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path fill="currentColor" d="' + m.d + '"></path></svg>';
    var s = el.firstChild.style;
    s.setProperty('--bm-w', m.w); s.setProperty('--bm-h', m.h); s.setProperty('--bm-right', m.right); s.setProperty('--bm-top', m.top); s.setProperty('--bm-o', m.o);
    el.hidden = false;
  };
`;

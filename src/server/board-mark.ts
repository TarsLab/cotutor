/**
 * 板书的底纹(《产品规划.md》拍板 27、28):三门主科在板右边竖着写一个很淡的学科名,像课本的书脊;板是平的纸色,不铺纸纹。
 * - 字:照课本封面——语文毛笔「语文」、数学粗宋「数学」、英语「ENGLISH」;轮廓是 board-mark-art.ts 里烤好的(scripts/bake-board-marks.py),页面不加载字体
 *   别的老师(口播、家长自己加的)不写字
 * 字放在 #wrap 里垫底的 #bmark:不跟板书滚,卡铺上来盖住就盖住;字号 s 跟着板走(板高的 48%、板宽的 72% 取小的)。
 * 脚本是 ES5、没有反斜杠与反引号(插进老师页的模板字符串)。tests/board-mark.test.ts 盯着。
 */
import { canonicalSubject } from '../schema/config.ts';
import { BOARD_MARK_ART } from './board-mark-art.ts';

export type BoardMarkId = keyof typeof BOARD_MARK_ART;

const BY_SUBJECT: Readonly<Record<string, BoardMarkId>> = { 语文: 'yuwen', 数学: 'shuxue', 英语: 'english' };

/** 这位老师的板上写什么:三门主科(含别名)各一个,别的 null(空着) */
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

/** 老师页的样式:字在 #bmark */
export const BOARD_MARK_CSS = `
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

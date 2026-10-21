/**
 * cotutor 的品牌标记(LICENSE 附加条件第 2 条):logo、名字、仓库链接,只在这里定义一份。
 * 家长端各页的页脚用 BRAND_FOOTER,工作台的页头用 brandLogo + BRAND_CSS;「XX的老师们」前面的那颗用 titleLogo(孩子端首页、家长端记录与首页,
 * 《首页设计.md》拍板 33):家长端彩色;孩子端跟标题同色、不带链接(首页的颜色是分给老师的,孩子端也没有外链)。
 * 录像的两页(/parent/talk/reel、/parent/dictation/reel)是全屏播放器,不放。
 * 哪几页带它见 tests/brand.test.ts:每页都带、孩子端一个都不带。
 *
 * logo 是「一起教」双 C(《产品规划.md》拍板 23,几何在 src/lib/logo.ts):大 C 是家长、小 C 是老师,开口都朝右;大号时小 C 侧头 28°,像正要点头。
 * 会动的只有两个 C 的转角,小 C 先动、大 C 慢一拍小一号地跟:ct-draw 画出来(打开的第一下)、悬停或点一下时点一下头(该你了)。
 */

import { LOGO_CLAY, LOGO_INK, logoBody, logoGeom } from '../lib/logo.ts';

export const BRAND_NAME = 'cotutor';
export const BRAND_URL = 'https://github.com/TarsLab/cotutor';

export interface BrandLogoOpts {
  /** 边长(px) */
  size?: number;
  /** 大 C 的颜色;缺省随字色 */
  outer?: string;
  /** 小 C 的颜色;缺省同大 C */
  inner?: string;
  /** 小 C 的不透明度(色块上白线时小 C 淡一档) */
  innerOpacity?: number;
}

/** logo 的 SVG(几何在 src/lib/logo.ts,网页图标与主屏幕图标同一份) */
export function brandLogo({ size = 18, outer = 'currentColor', inner = outer, innerOpacity = 1 }: BrandLogoOpts = {}): string {
  return `<svg class="ct-logo" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${logoBody(logoGeom(size), { outer, inner, innerOpacity })}</svg>`;
}

/** 「XX的老师们」前面那颗:家长端彩色;孩子端单色,颜色随所在处(跟标题同色) */
export function titleLogo(parent: boolean): string {
  return parent ? brandLogo({ size: 26, outer: LOGO_INK, inner: LOGO_CLAY }) : brandLogo({ size: 26 });
}

/** logo 的动作(类名带 ct- 前缀):.ct-draw 画出来一次、.ct-nod 点一下头(都用 BRAND_JS 的 ctReplay 重放);放在 .ct-hover 里的,悬停时点一下头。「减弱动态效果」就都不动 */
export const BRAND_CSS = `
  .ct-logo { overflow:visible; display:block; flex:none; }
  .ct-logo .ct-go, .ct-logo .ct-gi { transform-origin:50px 50px; }
  .ct-draw .ct-out { animation:ct-draw-out .9s cubic-bezier(.6,0,.3,1) backwards; }
  .ct-draw .ct-gi { animation:ct-draw-in .5s ease-out .45s backwards; }
  .ct-hover:hover .ct-gi, .ct-nod .ct-gi { animation:ct-nod .9s ease-in-out; }
  .ct-hover:hover .ct-go, .ct-nod .ct-go { animation:ct-nod-small .9s ease-in-out .12s; }
  @keyframes ct-draw-out { from { stroke-dasharray:0 251.33; stroke-dashoffset:-201.06; } to { stroke-dasharray:201.06 251.33; stroke-dashoffset:0; } }
  @keyframes ct-draw-in { from { opacity:0; transform:scale(.6); } to { opacity:1; transform:none; } }
  @keyframes ct-nod { 0%,100% { transform:rotate(0); } 30% { transform:rotate(26deg); } 60% { transform:rotate(-10deg); } 80% { transform:rotate(4deg); } }
  @keyframes ct-nod-small { 0%,100% { transform:rotate(0); } 30% { transform:rotate(12deg); } 60% { transform:rotate(-5deg); } 80% { transform:rotate(2deg); } }
  @media (prefers-reduced-motion:reduce) { .ct-logo * { animation:none !important; transition:none !important; } }
`;

/** 页面里的一小段脚本(ES5、没有反斜杠与反引号,插进各页的模板字符串):ctReplay(el, 类) 重放一次动作;#ct-mark 点一下就点一下头 */
export const BRAND_JS = `
  var ctReplay = function (el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  var ctMark = document.getElementById('ct-mark');
  if (ctMark) ctMark.addEventListener('click', function () { ctReplay(ctMark, 'ct-nod'); });
`;

/** 家长端的页脚一行:放在页面内容的最后;样式自带(类名带 ct- 前缀,各页的 CSS 撞不上),字色跟着页面走 */
export const BRAND_FOOTER = `<div class="ct-brand" data-cotutor-brand><style>${BRAND_CSS}
  .ct-brand { margin:32px auto 0; padding:0 0 calc(env(safe-area-inset-bottom) + 12px); text-align:center; }
  .ct-brand > a { display:inline-flex; align-items:center; gap:6px; color:inherit; opacity:.5; text-decoration:none; font:500 12px/1 system-ui, -apple-system, sans-serif; letter-spacing:.02em; }
  .ct-brand > a:hover { opacity:.8; }
</style><a class="ct-hover" href="${BRAND_URL}" target="_blank" rel="noopener">${brandLogo({ size: 14 })}<span>${BRAND_NAME}</span></a></div>`;

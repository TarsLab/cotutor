/**
 * cotutor 的品牌标记(LICENSE 附加条件第 2 条):logo、名字、仓库链接,只在这里定义一份。
 * 家长端各页的页脚用 BRAND_FOOTER,工作台的页头用 brandLogo + BRAND_CSS;孩子端不放(标题、主题、老师的头像是这个家庭的)。
 * 录像的两页(/parent/talk/reel、/parent/dictation/reel)是全屏播放器,不放。
 * 哪几页带它见 tests/brand.test.ts:每页都带、孩子端一个都不带。
 *
 * logo 是「一起教」(《产品规划.md》拍板 23):大 C 是家长、小 C 是老师,开口都朝右,和老师头像的 C 形开口环同一套几何
 * (开口 72°、圆头,《首页设计.md》拍板 15)。大号时小 C 侧头 28°,像正要点头;24 px 以下两圈加粗、小 C 摆正(侧头小了看不出)。
 * 会动的只有两个 C 的转角,小 C 先动、大 C 慢一拍小一号地跟:ct-draw 画出来(打开的第一下)、链接悬停时点一下头(该你了)。
 */

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

/** 两档几何:大号照设计稿,24 px 以下加粗、小 C 半径收一点、不侧头 */
const BIG = { outW: 10, inR: 19, inW: 9, tilt: 28 };
const SMALL = { outW: 13, inR: 17, inW: 12, tilt: 0 };
const OUT_R = 40;
/** 描 80%、留 20%(开口 72°),转 36° 让开口居中在右 */
const dash = (r: number): string => {
  const c = 2 * Math.PI * r;
  return `${(c * 0.8).toFixed(2)} ${c.toFixed(2)}`;
};

/** logo 的 SVG:外层 g.ct-go / g.ct-gi 是动作挂的地方(BRAND_CSS),侧头在里面一层,动的时候不丢 */
export function brandLogo({ size = 18, outer = 'currentColor', inner = outer, innerOpacity = 1 }: BrandLogoOpts = {}): string {
  const g = size > 24 ? BIG : SMALL;
  const op = innerOpacity < 1 ? ` opacity="${innerOpacity}"` : '';
  return `<svg class="ct-logo" width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" stroke-linecap="round" aria-hidden="true">`
    + `<g class="ct-go"><circle class="ct-out" cx="50" cy="50" r="${OUT_R}" stroke="${outer}" stroke-width="${g.outW}" stroke-dasharray="${dash(OUT_R)}" transform="rotate(36 50 50)"/></g>`
    + `<g class="ct-gi"><g transform="rotate(${g.tilt} 50 50)"><circle class="ct-in" cx="50" cy="50" r="${g.inR}" stroke="${inner}" stroke-width="${g.inW}" stroke-dasharray="${dash(g.inR)}" transform="rotate(36 50 50)"${op}/></g></g></svg>`;
}

/** logo 的动作(类名带 ct- 前缀):.ct-draw 画出来一次;放在 a.ct-hover 里的 logo,悬停时点一下头。「减弱动态效果」就都不动 */
export const BRAND_CSS = `
  .ct-logo { overflow:visible; display:block; flex:none; }
  .ct-logo .ct-go, .ct-logo .ct-gi { transform-origin:50px 50px; }
  .ct-draw .ct-out { animation:ct-draw-out .9s cubic-bezier(.6,0,.3,1) backwards; }
  .ct-draw .ct-gi { animation:ct-draw-in .5s ease-out .45s backwards; }
  .ct-hover:hover .ct-gi { animation:ct-nod .9s ease-in-out; }
  .ct-hover:hover .ct-go { animation:ct-nod-small .9s ease-in-out .12s; }
  @keyframes ct-draw-out { from { stroke-dasharray:0 251.33; stroke-dashoffset:-201.06; } to { stroke-dasharray:201.06 251.33; stroke-dashoffset:0; } }
  @keyframes ct-draw-in { from { opacity:0; transform:scale(.6); } to { opacity:1; transform:none; } }
  @keyframes ct-nod { 0%,100% { transform:rotate(0); } 30% { transform:rotate(26deg); } 60% { transform:rotate(-10deg); } 80% { transform:rotate(4deg); } }
  @keyframes ct-nod-small { 0%,100% { transform:rotate(0); } 30% { transform:rotate(12deg); } 60% { transform:rotate(-5deg); } 80% { transform:rotate(2deg); } }
  @media (prefers-reduced-motion:reduce) { .ct-logo * { animation:none !important; } }
`;

/** 家长端的页脚一行:放在页面内容的最后;样式自带(类名带 ct- 前缀,各页的 CSS 撞不上),字色跟着页面走 */
export const BRAND_FOOTER = `<div class="ct-brand" data-cotutor-brand><style>${BRAND_CSS}
  .ct-brand { margin:32px auto 0; padding:0 0 calc(env(safe-area-inset-bottom) + 12px); text-align:center; }
  .ct-brand > a { display:inline-flex; align-items:center; gap:6px; color:inherit; opacity:.5; text-decoration:none; font:500 12px/1 system-ui, -apple-system, sans-serif; letter-spacing:.02em; }
  .ct-brand > a:hover { opacity:.8; }
</style><a class="ct-hover" href="${BRAND_URL}" target="_blank" rel="noopener">${brandLogo({ size: 14 })}<span>${BRAND_NAME}</span></a></div>`;

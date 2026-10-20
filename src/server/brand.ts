/**
 * cotutor 的品牌标记(LICENSE 附加条件第 2 条):logo、名字、仓库链接,只在这里定义一份。
 * 家长端各页的页脚用 BRAND_FOOTER,工作台的页头用 brandLogo;孩子端不放(标题、主题、老师的头像是这个家庭的)。
 * 录像的两页(/parent/talk/reel、/parent/dictation/reel)是全屏播放器,不放。
 * 哪几页带它见 tests/brand.test.ts:每页都带、孩子端一个都不带。
 */

export const BRAND_NAME = 'cotutor';
export const BRAND_URL = 'https://github.com/TarsLab/cotutor';

/** logo:一块板子上两行字、底下一个支架。工作台页头是白线压在色块上,页脚随字色 */
export const brandLogo = (stroke: string, size = 18): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M7 9h6M7 12.5h9M9 21l3-4 3 4"/></svg>`;

/** 家长端的页脚一行:放在页面内容的最后;样式自带(类名带 ct- 前缀,各页的 CSS 撞不上),字色跟着页面走 */
export const BRAND_FOOTER = `<div class="ct-brand" data-cotutor-brand><style>
  .ct-brand { margin:32px auto 0; padding:0 0 calc(env(safe-area-inset-bottom) + 12px); text-align:center; }
  .ct-brand > a { display:inline-flex; align-items:center; gap:6px; color:inherit; opacity:.5; text-decoration:none; font:500 12px/1 system-ui, -apple-system, sans-serif; letter-spacing:.02em; }
  .ct-brand > a:hover { opacity:.8; }
</style><a href="${BRAND_URL}" target="_blank" rel="noopener">${brandLogo('currentColor', 14)}<span>${BRAND_NAME}</span></a></div>`;

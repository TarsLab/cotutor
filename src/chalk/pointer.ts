/**
 * 默认笔尖:内联 SVG 铅笔,笔尖落在图片 (0,0)——animateMotion 沿路径移动的是图片原点。
 * 视觉与 kid-canvas 的铅笔单工具呼应;粉笔味交给纸面配色。
 */

const PENCIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
  <g>
    <polygon points="0,0 9,3 3,9" fill="#4a4a4a"/>
    <rect x="5" y="1" width="22" height="8" rx="2" fill="#f2b634" stroke="#b98a2e" stroke-width="1" transform="rotate(45 5 1)"/>
  </g>
</svg>`;

export const DEFAULT_POINTER_IMG = `data:image/svg+xml,${encodeURIComponent(PENCIL_SVG)}`;

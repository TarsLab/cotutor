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

/** 橡皮:擦除端的中点落在图片 (5,5),由 excalidraw-io 用 x/y = -5 对回路径 */
const ERASER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g transform="translate(5 5) rotate(45)">
    <rect x="0" y="-6" width="30" height="12" rx="2.5" fill="#f6a5b4" stroke="#c2687a" stroke-width="1"/>
    <rect x="11" y="-6" width="19" height="12" rx="1.5" fill="#4c7fd0" stroke="#345a9c" stroke-width="1"/>
  </g>
</svg>`;

export const ERASER_POINTER_IMG = `data:image/svg+xml,${encodeURIComponent(ERASER_SVG)}`;

/** 纸面底色:与 chalk-player.css 的 .chalk-stage 同值;橡皮笔画缺省用它盖住旧笔迹 */
export const PAPER_COLOR = '#fffdf7';

export const DEFAULT_POINTER_IMG = `data:image/svg+xml,${encodeURIComponent(PENCIL_SVG)}`;

/**
 * 听写两页(语文 page.ts、英文 en-page.ts)共用的按钮(《wip/听写设想.md》拍板 28):同一套字、同一套图标、同一份样式。
 * 起因:两页的按钮各抄一份,英文页第一版起就没有图标,字也各叫各的(擦掉 / 擦掉重写 / 擦掉这一格);修了几次都只修点名的那几颗,又漂开。
 * 两页的按钮只从这里出:页面里写死的用 btn(),脚本里现建的用 ico() 与 lbl();按钮上的字在 <span> 里,换字只换 span。
 * tests/dictation.test.ts 查两页每颗按钮都带图标、写字那排的字一样;再加一种按钮,先在 ICON 里加图标。
 * 字符串里没有反斜杠与反引号:插进各页的模板字符串。
 */
import { cameraSvg, playSvg } from '../server/photo-ui.ts';

const svg = (paths: string, stroke = 'currentColor'): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICON = {
  /** 再念:喇叭 */
  again: svg('<path d="M11 5L6 9H3v6h3l5 4V5z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path>'),
  /** 撤销 */
  undo: svg('<path d="M9 14L4 9l5-5"></path><path d="M4 9h11a5 5 0 0 1 0 10h-3"></path>'),
  /** 擦掉:橡皮 */
  clear: svg('<path d="M20 20H8l-4-4 10-10 6 6-6 6"></path>'),
  /** 不会写,给答案:灯泡 */
  reveal: svg('<path d="M9 18h6"></path><path d="M10 21h4"></path><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"></path>'),
  /** 写好了、对好了:勾 */
  done: svg('<path d="M5 12.5l4.5 4.5L19 7.5"></path>'),
  /** 看笔顺:圈里一个播放 */
  order: svg('<circle cx="12" cy="12" r="9"></circle><path d="M10 8.5v7l5.5-3.5z"></path>'),
  /** 再看一遍、从头写:转一圈 */
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path>'),
  /** 开始、接着写:播放(拍照屏「接着写」同一个) */
  start: playSvg(),
  /** 再写一遍:笔 */
  write: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"></path><path d="M13.5 6.5l4 4"></path>'),
  /** 拿开蓝字 / 叠上蓝字:两张叠着的纸,蓝的 */
  overlay: svg('<rect x="3" y="3" width="13" height="13" rx="2"></rect><rect x="8" y="8" width="13" height="13" rx="2"></rect>', '#4f86d1'),
  /** 交上去:纸飞机 */
  send: svg('<path d="M21 3L10 14"></path><path d="M21 3l-7 18-4-7-7-4z"></path>'),
  /** 看看写的:眼睛 */
  look: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>'),
  /** 回首页 */
  home: svg('<path d="M3 11l9-8 9 8"></path><path d="M5 10v10h14V10"></path>'),
  /** 加一个词 */
  add: svg('<path d="M12 5v14"></path><path d="M5 12h14"></path>'),
  /** 上一笔 / 下一笔 */
  prev: svg('<path d="M15 18l-6-6 6-6"></path>'),
  next: svg('<path d="M9 18l6-6-6-6"></path>'),
  /** 重拍:老师页输入条那个相机 */
  camera: cameraSvg(),
} as const;

export type IconName = keyof typeof ICON;

/** 写字那排(两页一样,拍板 28):再念、撤销、擦掉、不会写,给答案、写好了 */
export const WRITE_TOOLS = ['再念', '撤销', '擦掉', '不会写,给答案', '写好了'] as const;

/** 页面里写死的按钮:图标在字前面;attrs 原样拼进标签(id、data-*、hidden……);label 空 = 只有图标,要写 aria-label */
export const btn = (cls: string, icon: IconName, label: string, attrs = ''): string =>
  `<button class="${cls}" type="button"${attrs ? ' ' + attrs : ''}>${ICON[icon]}${label ? `<span>${label}</span>` : ''}</button>`;

/** 脚本里现建的按钮:h('button', {...}, ico('write'), lbl('再写一遍'));换字用 setLbl(按钮, 字, 图标) */
export const BTN_JS = `
  /**
   * 主按钮换了意思之后半秒内点不动(《wip/听写设想.md》拍板 31):换屏、换字、看笔顺换成照着写时调 guard();
   * 连点、手快时第二下不落到新的意思上(10-18 孩子「我来写」原地变「写好了」)。样子是先淡着再亮,不出字;录像里不调
   */
  var guardUntil = 0, guardTimer = 0;
  var guard = function () {
    guardUntil = Date.now() + 500;
    var ms = document.querySelectorAll('.main'); for (var i = 0; i < ms.length; i++) ms[i].classList.add('arm');
    clearTimeout(guardTimer);
    guardTimer = setTimeout(function () { var ms = document.querySelectorAll('.main.arm'); for (var i = 0; i < ms.length; i++) ms[i].classList.remove('arm'); }, 500);
  };
  document.addEventListener('click', function (e) { if (Date.now() < guardUntil && e.target.closest && e.target.closest('.main')) { e.stopPropagation(); e.preventDefault(); } }, true);
  var ICON = { ${Object.entries(ICON).map(([k, v]) => `${k}: '${v}'`).join(', ')} };
  var ico = function (n) { var t = document.createElement('template'); t.innerHTML = ICON[n]; return t.content.firstChild; };
  var lbl = function (t) { var s = document.createElement('span'); s.textContent = t; return s; };
  var setLbl = function (b, t, n) { b.replaceChildren(ico(n), lbl(t)); };
`;

/** 两页同一份:次按钮白底、主按钮老师的颜色(--sc),图标 22 / 24 px;页面要有 --sc、--line、--tutor-line、--tutor-ink */
export const BTN_CSS = `
  .tool { display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:56px; padding:0 20px; border-radius:28px; border:1px solid var(--line); background:#fff; font-size:17px; }
  .tool.sm { min-height:48px; font-size:15px; padding:0 16px; }
  .tool:disabled { opacity:.4; }
  .tool svg { width:22px; height:22px; flex:none; }
  .tool.reveal { border:2px solid var(--tutor-line); background:#fff; color:var(--tutor-ink); font-weight:600; }
  .main { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:64px; padding:0 40px; border-radius:32px; border:0; background:var(--sc); color:#fff; font-size:20px; font-weight:600; }
  .main svg { width:24px; height:24px; flex:none; stroke-width:2.2; }
  .main:disabled { opacity:.45; }
  .main { transition:opacity .25s; }
  .main.arm { opacity:.45; transition:none; }
`;

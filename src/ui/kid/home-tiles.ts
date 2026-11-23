/**
 * 首页左页那些卡上的图(设计稿 https://claude.ai/artifact/KJFiRZD6E45YEKGQBbw98Q):卡是竖版的,照课本 185×260(5:7),框在 cards/tutor/card.css。
 * 册(课本、作业本、练习册)铺封面,不用这里的图(kid-page 的 coverArt);这里是别的卡竖着画的图,和封面一样大、并排不跳:
 * - 方砖(TILE_ART,按老师的 mark 挑,三门主科各一套,别的老师用不带学科内容的一套):预习 = 一页课本圈住要学的 + 一颗小星星,
 *   检查作业 = 作业本 + 放大镜(检查作业铺作业本时是封面,这张只给没铺作业本的),复习 = 学过的一摞,口语课 = 说话的气泡 + 孩子;
 *   课本那块有课本才出、总是封面,图只是兜底。
 * - 家长排的 activity(ACT_ART):按它往页上铺什么挑——课本(一页夹一根书签)、照片(一幅竖的图 + 说话的气泡)、都不铺的(气泡 + 孩子)。
 * - 常驻的听写(EXTRA_ART):语文两列三行空的田字格 + 一支笔,英语拍照听写三条四线格 + 相机。
 * 都是 viewBox 0 0 150 210,铺满框;currentColor = 学科色(卡上的 --sc),浅色线是固定的米色 / 灰蓝。学科特色只在图里,点了和 activity 按钮一样(见 kid-page 的 pickButton)。
 */
import type { HomeTileId } from '../../schema/index.ts';
import type { BoardMarkId } from './board-mark.ts';

type TileArt = Record<HomeTileId, string>;

const SONG = 'font-family="Songti SC, STSong, serif"';
const ROUND = 'font-family="ui-rounded, -apple-system, sans-serif"';
const HAND = 'font-family="Chalkboard SE, Comic Sans MS, Marker Felt, sans-serif"';
const MONO = 'font-family="Menlo, monospace"';
const STAR = '<path d="M116 16 L118 22 L124 24 L118 26 L116 32 L114 26 L108 24 L114 22 Z" fill="#f2b84b"></path>';
const text = (x: number, y: number, s: string, size: number, font: string, fill: string, more = ''): string =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="${fill}" ${font}${more}>${s}</text>`;

/** 预习:竖的一页课本,要学的那个用学科色的笔圈一圈,右上角一颗小星星;txt 空 = 圈住一行字 */
const preview = (txt: string, size: number, font: string): string =>
  `<rect x="30" y="30" width="90" height="130" rx="3" fill="#fffdf6" stroke="#d9b97a" stroke-width="1.5"></rect>` +
  `<path d="M42 50 H108 M42 62 H108 M42 128 H108 M42 140 H96" stroke="#e7dcc2" stroke-width="4" stroke-linecap="round"></path>` +
  (txt ? text(76, 95 + size * 0.36, txt, size, font, '#3a352c', ' font-weight="700"') : '<path d="M48 88 H102 M48 102 H94" stroke="#d9b97a" stroke-width="4" stroke-linecap="round"></path>') +
  `<path d="M52 82 C70 72 104 78 102 96 C100 116 58 118 50 102 C45 90 56 80 80 78" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>${STAR}`;

/** 检查作业:竖的作业本(上沿几个环)写着两行,右下角学科色的放大镜;a、b 空 = 只有横线 */
const check = (a: string, b: string, size: number, font: string): string =>
  `<rect x="26" y="24" width="98" height="140" rx="5" fill="#fff" stroke="#d9b97a" stroke-width="1.5"></rect>` +
  `<path d="M44 25 V17 M62 25 V17 M80 25 V17 M98 25 V17" stroke="#b9a988" stroke-width="2.5" stroke-linecap="round"></path>` +
  `<path d="M36 62 H114 M36 94 H114 M36 126 H114" stroke="#ecdcb8" stroke-width="1.2"></path>` +
  (a ? `<text x="38" y="57" font-size="${size}" fill="#8f836c" ${font}>${a}</text>` : '<path d="M40 52 H96" stroke="#cdbf9f" stroke-width="3" stroke-linecap="round"></path>') +
  (b ? `<text x="38" y="89" font-size="${size}" fill="#8f836c" ${font}>${b}</text>` : '<path d="M40 84 H84" stroke="#cdbf9f" stroke-width="3" stroke-linecap="round"></path>') +
  '<circle cx="102" cy="150" r="20" fill="#ffffffd9" stroke="currentColor" stroke-width="4"></circle><path d="M116 164 L130 178" stroke="currentColor" stroke-width="6" stroke-linecap="round"></path>';

/** 复习:学过的一摞,后面两张淡的,最上面那张学科色;字空 = 横线 */
const review = (a: string, b: string, c: string, font: string, big: number, small: number): string => {
  const back = (y: number, s: string): string =>
    `<rect x="38" y="${y}" width="74" height="44" rx="5" fill="#fffdf6" stroke="#d8ccb0" stroke-width="1.5"></rect>` +
    (s ? text(75, y + 22 + small * 0.36, s, small, font, '#b9a988') : `<path d="M54 ${y + 22} H96" stroke="#e2d6bd" stroke-width="3" stroke-linecap="round"></path>`);
  return back(30, c) + back(80, b) +
    '<rect x="30" y="130" width="90" height="54" rx="6" fill="#fff" stroke="currentColor" stroke-width="2.2"></rect>' +
    (a ? text(75, 157 + big * 0.36, a, big, font, 'currentColor', ' font-weight="700"') : '<path d="M46 150 H104 M46 164 H90" stroke="currentColor" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"></path>');
};

/** 口语课:上面一个说话的气泡(字按学科;空 = 三个点),下面一个孩子 */
const talk = (txt: string, size: number, font: string): string =>
  '<path d="M40 30 H110 A10 10 0 0 1 120 40 V82 A10 10 0 0 1 110 92 H78 L62 108 L66 92 H40 A10 10 0 0 1 30 82 V40 A10 10 0 0 1 40 30 Z" fill="#fff" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"></path>' +
  (txt ? text(75, 61 + size * 0.36, txt, size, font, 'currentColor', ' font-weight="700"') : '<circle cx="60" cy="61" r="4" fill="currentColor"></circle><circle cx="75" cy="61" r="4" fill="currentColor"></circle><circle cx="90" cy="61" r="4" fill="currentColor"></circle>') +
  '<circle cx="66" cy="142" r="24" fill="#fbe3c8"></circle><path d="M38 190 C40 168 92 168 94 190 Z" fill="currentColor" opacity=".55"></path>' +
  '<circle cx="58" cy="139" r="2.4" fill="#5a4a3a"></circle><circle cx="74" cy="139" r="2.4" fill="#5a4a3a"></circle><path d="M60 150 Q66 155 72 150" fill="none" stroke="#5a4a3a" stroke-width="2" stroke-linecap="round"></path>';

/** 课本:竖的一页,夹一根学科色的书签(家长排的铺课本的 activity;课本方砖没有封面时兜底) */
const BOOK_PAGE = '<rect x="30" y="26" width="90" height="140" rx="3" fill="#fff" stroke="currentColor" stroke-width="2"></rect><path d="M44 52 H106 M44 68 H106 M44 84 H100 M44 100 H106 M44 116 H92 M44 132 H106" stroke="#d9b97a" stroke-width="3" stroke-linecap="round"></path><path d="M96 22 V60 L103 53 L110 60 V22" fill="currentColor"></path>';

const set = (p: string, c: string, r: string, t: string): TileArt => ({ textbook: BOOK_PAGE, preview: p, check: c, review: r, talk: t });

export const TILE_ART: Readonly<Record<BoardMarkId | 'plain', TileArt>> = {
  yuwen: set(preview('春', 30, SONG), check('天 地 人', '日 月 水', 14, SONG), review('山', '水', '火', SONG, 24, 16), talk('你好', 20, SONG)),
  shuxue: set(preview('3+4', 22, ROUND), check('27+15', '= 42', 14, MONO), review('8×7', '6+9', '15−7', ROUND, 22, 15), talk('3+4', 20, ROUND)),
  english: set(preview('Aa', 28, HAND), check('apple', 'pen', 14, HAND), review('cat', 'dog', 'sun', HAND, 22, 16), talk('Hi!', 22, HAND)),
  // 别的老师:同样的一页、本子、一摞、气泡,不带学科内容
  plain: set(preview('', 0, ROUND), check('', '', 0, ROUND), review('', '', '', ROUND, 0, 0), talk('', 0, ROUND)),
};

/** 家长排的 activity 卡上的图:按这个 activity 往页上铺什么挑(按钮带的 base);练习册的按钮铺封面,这张只兜底 */
export const ACT_ART: Readonly<Record<'textbook' | 'photo' | 'talk' | 'workbook' | 'homework', string>> = {
  textbook: BOOK_PAGE,
  photo: '<rect x="27" y="30" width="96" height="120" rx="3" fill="#e3eff6"></rect><circle cx="98" cy="58" r="10" fill="#f6c453"></circle><path d="M27 150 L62 98 L86 126 L102 110 L123 138 V150 Z" fill="#a9cf9b"></path><circle cx="48" cy="134" r="6" fill="#e8a0a0"></circle><path d="M48 140 V150" stroke="#7a9c66" stroke-width="2"></path>' +
    '<path d="M58 160 H112 A6 6 0 0 1 118 166 V180 A6 6 0 0 1 112 186 H76 L66 194 L68 186 H58 A6 6 0 0 1 52 180 V166 A6 6 0 0 1 58 160 Z" fill="#fff" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path><circle cx="74" cy="173" r="2.2" fill="currentColor"></circle><circle cx="85" cy="173" r="2.2" fill="currentColor"></circle><circle cx="96" cy="173" r="2.2" fill="currentColor"></circle>',
  talk: talk('', 0, ROUND),
  workbook: '<rect x="30" y="26" width="90" height="140" rx="3" fill="#fff" stroke="currentColor" stroke-width="2"></rect><path d="M42 50 H86 M42 76 H72 M42 102 H72 M42 128 H72" stroke="#d9b97a" stroke-width="3" stroke-linecap="round"></path><g fill="none" stroke="#b9a988"><rect x="82" y="68" width="22" height="16"></rect><rect x="82" y="94" width="22" height="16"></rect><rect x="82" y="120" width="22" height="16"></rect></g>',
  homework: check('', '', 0, ROUND),
};

/** 常驻的听写:dict = 语文(照课本词语表选一课),两列三行空的田字格 + 一支学科色的笔;snap = 英语拍照听写,三条四线格(第一条写着 Aa)+ 右下角相机 */
export const EXTRA_ART: Readonly<Record<'dict' | 'snap', string>> = {
  dict: '<g fill="#fff" stroke="#d9b97a" stroke-width="1.5"><rect x="34" y="34" width="38" height="38"></rect><rect x="78" y="34" width="38" height="38"></rect><rect x="34" y="78" width="38" height="38"></rect><rect x="78" y="78" width="38" height="38"></rect><rect x="34" y="122" width="38" height="38"></rect><rect x="78" y="122" width="38" height="38"></rect></g>' +
    '<path d="M53 34 V72 M34 53 H72 M97 34 V72 M78 53 H116 M53 78 V116 M34 97 H72 M97 78 V116 M78 97 H116 M53 122 V160 M34 141 H72 M97 122 V160 M78 141 H116" stroke="#ecdcb8" stroke-width="1" stroke-dasharray="3 3"></path>' +
    '<path d="M98 184 L130 152 L138 160 L106 192 L96 194 Z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="M124 158 L132 166" stroke="currentColor" stroke-width="2"></path>',
  snap: '<rect x="22" y="36" width="106" height="132" fill="#fff"></rect><path d="M22 40 H128 M22 50 H128 M22 70 H128 M22 84 H128 M22 94 H128 M22 114 H128 M22 128 H128 M22 138 H128 M22 158 H128" stroke="#cdd6e2" stroke-width="1"></path><path d="M22 60 H128 M22 104 H128 M22 148 H128" stroke="#e39a9a" stroke-width="1.2"></path>' +
    `<text x="34" y="60" font-size="22" fill="#8fa0b2" ${HAND}>Aa</text>` +
    '<circle class="cam" cx="118" cy="168" r="18" fill="currentColor" stroke="#fffdf8" stroke-width="3"></circle><path d="M109 164 H112 L113.5 160 H122.5 L124 164 H127 V175 H109 Z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"></path>',
};

/** 内联进孩子端页面:tileArt(mark, id)、actArt(base)、extraArt(k) → 整个 <svg>(aria-hidden,字在框下的 .btx 里) */
export const HOME_TILES_JS = `
  var ART_SVG = function (body) { return '<svg viewBox="0 0 150 210" aria-hidden="true" focusable="false">' + body + '</svg>'; };
  var TILE_ART = ${JSON.stringify(TILE_ART)};
  var tileArt = function (mark, id) { var set = TILE_ART[mark] || TILE_ART.plain; return ART_SVG(set[id] || ''); };
  var ACT_ART = ${JSON.stringify(ACT_ART)};
  var actArt = function (base) { return ART_SVG(ACT_ART[base] || ACT_ART.talk); };
  var EXTRA_ART = ${JSON.stringify(EXTRA_ART)};
  var extraArt = function (k) { return ART_SVG(EXTRA_ART[k]); };
`;

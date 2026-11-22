/**
 * 首页老师牌上常驻的方砖(预习、检查作业、复习、口语课;口语课只有英语老师家里有):
 * 和别的入口一样是书页上的一幅图画框(框在 cards/tutor/card.css),图在框里、字在框下;三科同一个位置、同一个样子,分辨全靠图——
 * 预习 = 翻开的书 + 一颗小星星,检查作业 = 作业本 + 放大镜,复习 = 学过的一摞,口语课 = 拍来的一页 + 说话的气泡。学科特色只在图里(颜色只用学科色,currentColor)。
 * 图按老师的 mark(板的底纹那个:三门主科各一套)挑,别的老师用不带学科内容的一套。数学三张都有阿拉伯数字。
 * 预习那张把要学的用学科色的笔圈一圈。方砖下面不写小字(家长填的范围不上孩子的牌)。点了和 activity 按钮一样:新开话题、发出方砖上的字。
 */
import type { HomeTileId } from '../../schema/index.ts';
import type { BoardMarkId } from './board-mark.ts';

type TileArt = Record<HomeTileId, string>;

// 都是 viewBox 0 0 88 60;currentColor = 学科色(方砖上的 --sc),浅色线是固定的米色 / 灰蓝
const STAR = '<path d="M44 1 L45.6 5.4 L50 7 L45.6 8.6 L44 13 L42.4 8.6 L38 7 L42.4 5.4 Z" fill="#f2b84b"></path>';
const BOOK = '<path d="M44 15 C34 9 21 9 9 13 V53 C21 49 34 49 44 55 Z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="M44 15 C54 9 67 9 79 13 V53 C67 49 54 49 44 55 Z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>';
const NOTEBOOK = '<rect x="8" y="6" width="58" height="48" rx="4" fill="#fff" stroke="#d9b97a" stroke-width="1.5"></rect><path d="M18 7 V2 M30 7 V2 M42 7 V2 M54 7 V2" stroke="#b9a988" stroke-width="2" stroke-linecap="round"></path>';
const LENS = '<circle cx="66" cy="40" r="11" fill="#ffffffd9" stroke="currentColor" stroke-width="3"></circle><path d="M74 48 L82 56" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"></path>';
const SONG = 'font-family="Songti SC, STSong, serif"';
const ROUND = 'font-family="ui-rounded, -apple-system, sans-serif"';
const HAND = 'font-family="Chalkboard SE, Comic Sans MS, Marker Felt, sans-serif"';
const MONO = 'font-family="Menlo, monospace"';
/** 预习圈住的那个:学科色的笔一圈,收笔处多画一截 */
const loop = (d: string): string => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>`;
/** 一摞里后面那张(淡的;不歪) */
const back = (x: number, y: number, w: number, h: number, text: string, size: number, font: string, rx = 3): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="#fff" stroke="#e2d6bd" stroke-width="1.5"></rect>${text ? `<text x="${x + w / 2}" y="${y + h / 2 + size * 0.36}" font-size="${size}" text-anchor="middle" fill="#b9a988" ${font}>${text}</text>` : ''}`;
/** 口语课:一页拍来的课本 + 一个说话的气泡(气泡里的字按学科) */
const TALK_PAGE = '<rect x="6" y="12" width="40" height="42" rx="4" fill="#fff" stroke="#d9b97a" stroke-width="1.5"></rect><path d="M13 23 H39 M13 31 H39 M13 39 H32" stroke="#d9b97a" stroke-width="2" stroke-linecap="round"></path>';
const bubble = (text: string, size: number, font: string): string =>
  `${TALK_PAGE}<path d="M44 5 H79 A5 5 0 0 1 84 10 V30 A5 5 0 0 1 79 35 H59 L50 44 L52 35 H44 A5 5 0 0 1 39 30 V10 A5 5 0 0 1 44 5 Z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>${text ? `<text x="61.5" y="${20 + size * 0.36}" font-size="${size}" font-weight="700" text-anchor="middle" fill="currentColor" ${font}>${text}</text>` : '<circle cx="52" cy="20" r="2.4" fill="currentColor"></circle><circle cx="61.5" cy="20" r="2.4" fill="currentColor"></circle><circle cx="71" cy="20" r="2.4" fill="currentColor"></circle>'}`;
/** 田字格一格 */
const grid = (x: number, y: number, s: number, ch: string, size: number, color = '#8f836c'): string =>
  `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="none" stroke="#e2d6bd"></rect>${ch ? `<text x="${x + s / 2}" y="${y + s / 2 + size * 0.38}" font-size="${size}" text-anchor="middle" fill="${color}" ${SONG}>${ch}</text>` : ''}`;

export const TILE_ART: Readonly<Record<BoardMarkId | 'plain', TileArt>> = {
  yuwen: {
    preview: `${STAR}${BOOK}<path d="M15 24 H37 M15 32 H37 M15 40 H31" stroke="#d9b97a" stroke-width="2" stroke-linecap="round"></path><rect x="52" y="21" width="21" height="21" fill="#fff" stroke="currentColor" stroke-width="1.5"></rect><path d="M62.5 21 V42 M52 31.5 H73" stroke="currentColor" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 2"></path><text x="62.5" y="37.5" font-size="16" font-weight="700" text-anchor="middle" fill="currentColor" ${SONG}>春</text>${loop('M54 19 C66 12 82 18 80 32 C78 47 56 49 49 38 C44 29 51 19 66 17')}`,
    check: `${NOTEBOOK}${grid(14, 14, 14, '天', 11)}${grid(30, 14, 14, '地', 11)}${grid(46, 14, 14, '人', 11)}${grid(14, 32, 14, '日', 11)}${grid(30, 32, 14, '月', 11)}${LENS}`,
    talk: bubble('你好', 13, SONG),
    review: `${back(4, 24, 24, 24, '水', 14, SONG)}${back(60, 24, 24, 24, '火', 14, SONG)}<rect x="28" y="14" width="32" height="32" rx="3" fill="#fff" stroke="currentColor" stroke-width="2"></rect><path d="M44 14 V46 M28 30 H60" stroke="currentColor" stroke-opacity=".3" stroke-width="1" stroke-dasharray="2 2"></path><text x="44" y="37" font-size="20" font-weight="700" text-anchor="middle" fill="currentColor" ${SONG}>山</text>`,
  },
  shuxue: {
    preview: `${STAR}${BOOK}<path d="M17 21 V35 M22 21 V35 M27 21 V35" stroke="#e3a64a" stroke-width="2.6" stroke-linecap="round"></path><text x="22" y="47" font-size="11" font-weight="700" text-anchor="middle" fill="#8f836c" ${ROUND}>3</text><text x="61.5" y="31" font-size="13" font-weight="800" text-anchor="middle" fill="currentColor" ${ROUND}>3+4</text><text x="61.5" y="46" font-size="13" font-weight="800" text-anchor="middle" fill="currentColor" ${ROUND}>=?</text>${loop('M50 17 C66 10 84 18 81 33 C78 50 52 52 45 40 C40 30 48 18 64 15')}`,
    check: `${NOTEBOOK}<text x="44" y="21" font-size="11" text-anchor="end" fill="#8f836c" ${MONO}>27</text><text x="44" y="33" font-size="11" text-anchor="end" fill="#8f836c" ${MONO}>+15</text><path d="M20 37 H46" stroke="#8f836c" stroke-width="1.2"></path><text x="44" y="48" font-size="11" text-anchor="end" fill="#8f836c" ${MONO}>42</text>${LENS}`,
    talk: bubble('3+4', 13, ROUND),
    review: `${back(4, 6, 36, 22, '6+9', 11, ROUND, 5)}${back(48, 6, 36, 22, '15−7', 11, ROUND, 5)}<rect x="19" y="25" width="50" height="32" rx="5" fill="#fff" stroke="currentColor" stroke-width="2"></rect><text x="44" y="47" font-size="17" font-weight="800" text-anchor="middle" fill="currentColor" ${ROUND}>8×7</text>`,
  },
  english: {
    preview: `${STAR}${BOOK}<path d="M14 23 H38 M14 29 H38 M14 41 H38" stroke="#cdd6e2" stroke-width="1.2"></path><path d="M14 35 H38" stroke="#e39a9a" stroke-width="1.2"></path><text x="62" y="39" font-size="18" font-weight="700" text-anchor="middle" fill="currentColor" ${HAND}>Aa</text>${loop('M52 22 C64 16 80 22 77 32 C74 44 54 45 48 37 C44 30 50 22 63 20')}`,
    check: `${NOTEBOOK}<path d="M14 14 H58 M14 19 H58 M14 29 H58 M14 34 H58 M14 39 H58 M14 49 H58" stroke="#cdd6e2" stroke-width="1"></path><path d="M14 24 H58 M14 44 H58" stroke="#e39a9a" stroke-width="1"></path><text x="16" y="24" font-size="11" fill="#8f836c" ${HAND}>apple</text><text x="16" y="44" font-size="11" fill="#8f836c" ${HAND}>pen</text>${LENS}`,
    talk: bubble('Hi!', 16, HAND),
    review: `${back(6, 3, 44, 24, 'dog', 13, HAND, 5)}<rect x="30" y="25" width="50" height="30" rx="5" fill="#fff" stroke="currentColor" stroke-width="2"></rect><text x="55" y="46" font-size="16" font-weight="700" text-anchor="middle" fill="currentColor" ${HAND}>cat</text>`,
  },
  // 别的老师:同样的书、本子、一摞,不带学科内容
  plain: {
    preview: `${STAR}${BOOK}<path d="M15 24 H37 M15 32 H37 M15 40 H31 M51 24 H73 M51 32 H73 M51 40 H67" stroke="#d9b97a" stroke-width="2" stroke-linecap="round"></path>`,
    check: `${NOTEBOOK}<path d="M15 18 H58 M15 28 H52 M15 38 H46" stroke="#cdbf9f" stroke-width="2" stroke-linecap="round"></path>${LENS}`,
    talk: bubble('', 0, ROUND),
    review: `${back(4, 6, 36, 22, '', 12, ROUND, 5)}${back(48, 6, 36, 22, '', 12, ROUND, 5)}<rect x="19" y="25" width="50" height="32" rx="5" fill="#fff" stroke="currentColor" stroke-width="2"></rect><path d="M28 36 H60 M28 45 H52" stroke="currentColor" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"></path>`,
  },
};

/**
 * 家长排的 activity 卡上的图:按这个 activity 往页上铺什么挑(按钮带的 base)——课本(翻开的书夹一根书签)、照片(一幅风景)、
 * 都不铺的(说话的气泡)。和方砖同一个 viewBox,currentColor = 学科色
 */
export const ACT_ART: Readonly<Record<'textbook' | 'photo' | 'talk', string>> = {
  textbook: `${BOOK}<path d="M15 24 H37 M15 32 H37 M15 40 H31 M51 24 H73 M51 32 H73 M51 40 H67" stroke="#d9b97a" stroke-width="2" stroke-linecap="round"></path><path d="M62 9 V27 L66 23 L70 27 V9" fill="currentColor"></path>`,
  photo: '<rect x="12" y="6" width="64" height="48" rx="2" fill="#e3eff6"></rect><circle cx="60" cy="17" r="5" fill="#f6c453"></circle><path d="M12 54 L33 30 L46 43 L56 35 L76 54 Z" fill="#a9cf9b"></path><circle cx="27" cy="46" r="3" fill="#e8a0a0"></circle>',
  talk: '<path d="M16 6 H72 A6 6 0 0 1 78 12 V38 A6 6 0 0 1 72 44 H40 L27 55 L29 44 H16 A6 6 0 0 1 10 38 V12 A6 6 0 0 1 16 6 Z" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><circle cx="31" cy="25" r="3" fill="currentColor"></circle><circle cx="44" cy="25" r="3" fill="currentColor"></circle><circle cx="57" cy="25" r="3" fill="currentColor"></circle>',
};

/** 内联进孩子端页面:tileArt(mark, id)、actArt(base) → 整个 <svg>(aria-hidden,字在旁边的 .btx 里) */
export const HOME_TILES_JS = `
  var TILE_ART = ${JSON.stringify(TILE_ART)};
  var tileArt = function (mark, id) {
    var set = TILE_ART[mark] || TILE_ART.plain;
    return '<svg viewBox="0 0 88 60" aria-hidden="true" focusable="false">' + (set[id] || '') + '</svg>';
  };
  var ACT_ART = ${JSON.stringify(ACT_ART)};
  var actArt = function (base) {
    return '<svg viewBox="0 0 88 60" aria-hidden="true" focusable="false">' + (ACT_ART[base] || ACT_ART.talk) + '</svg>';
  };
`;

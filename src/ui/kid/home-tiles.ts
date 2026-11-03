/**
 * 首页老师牌上常驻的三块方砖(预习、检查作业、复习;设计稿 https://claude.ai/artifact/NpPFoyvuF17dbRSEUuRJfW):
 * 一行三块,白底、学科色细边、图在上字在下;三科同一个位置、同一个样子,分辨全靠图——
 * 预习 = 翻开的书 + 一颗小星星,检查作业 = 作业本 + 放大镜,复习 = 学过的一摞。学科特色只在图里(颜色只用学科色,currentColor)。
 * 图按老师的 mark(板书底纹那个:三门主科各一套)挑,别的老师用不带学科内容的一套。数学三张都有阿拉伯数字。
 * 方砖下面不写小字(家长填的范围不上孩子的牌)。点了和 activity 按钮一样:新开话题、发出方砖上的字;今天做过的先问接着还是重新开始。
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
/** 一摞里后面那张(淡的、斜着) */
const back = (x: number, y: number, w: number, h: number, rot: number, cx: number, cy: number, text: string, size: number, font: string, rx = 3): string =>
  `<g transform="rotate(${rot} ${cx} ${cy})"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="#fff" stroke="#e2d6bd" stroke-width="1.5"></rect>${text ? `<text x="${x + w / 2}" y="${y + h / 2 + size * 0.36}" font-size="${size}" text-anchor="middle" fill="#b9a988" ${font}>${text}</text>` : ''}</g>`;
/** 田字格一格 */
const grid = (x: number, y: number, s: number, ch: string, size: number, color = '#8f836c'): string =>
  `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="none" stroke="#e2d6bd"></rect>${ch ? `<text x="${x + s / 2}" y="${y + s / 2 + size * 0.38}" font-size="${size}" text-anchor="middle" fill="${color}" ${SONG}>${ch}</text>` : ''}`;

export const TILE_ART: Readonly<Record<BoardMarkId | 'plain', TileArt>> = {
  yuwen: {
    preview: `${STAR}${BOOK}<path d="M15 24 H37 M15 32 H37 M15 40 H31" stroke="#d9b97a" stroke-width="2" stroke-linecap="round"></path><rect x="52" y="21" width="21" height="21" fill="#fff" stroke="currentColor" stroke-width="1.5"></rect><path d="M62.5 21 V42 M52 31.5 H73" stroke="currentColor" stroke-opacity=".35" stroke-width="1" stroke-dasharray="2 2"></path><text x="62.5" y="37.5" font-size="16" font-weight="700" text-anchor="middle" fill="currentColor" ${SONG}>春</text>`,
    check: `${NOTEBOOK}${grid(14, 14, 14, '天', 11)}${grid(30, 14, 14, '地', 11)}${grid(46, 14, 14, '人', 11)}${grid(14, 32, 14, '日', 11)}${grid(30, 32, 14, '月', 11)}${LENS}`,
    review: `${back(10, 24, 27, 27, -14, 24, 38, '水', 16, SONG)}${back(45, 24, 27, 27, 12, 58, 38, '火', 16, SONG)}<rect x="25" y="16" width="32" height="32" rx="3" fill="#fff" stroke="currentColor" stroke-width="2"></rect><path d="M41 16 V48 M25 32 H57" stroke="currentColor" stroke-opacity=".3" stroke-width="1" stroke-dasharray="2 2"></path><text x="41" y="39" font-size="20" font-weight="700" text-anchor="middle" fill="currentColor" ${SONG}>山</text>`,
  },
  shuxue: {
    preview: `${STAR}${BOOK}<path d="M17 21 V35 M22 21 V35 M27 21 V35" stroke="#e3a64a" stroke-width="2.6" stroke-linecap="round"></path><text x="22" y="47" font-size="11" font-weight="700" text-anchor="middle" fill="#8f836c" ${ROUND}>3</text><text x="61.5" y="31" font-size="13" font-weight="800" text-anchor="middle" fill="currentColor" ${ROUND}>3+4</text><text x="61.5" y="46" font-size="13" font-weight="800" text-anchor="middle" fill="currentColor" ${ROUND}>=?</text>`,
    check: `${NOTEBOOK}<text x="44" y="21" font-size="11" text-anchor="end" fill="#8f836c" ${MONO}>27</text><text x="44" y="33" font-size="11" text-anchor="end" fill="#8f836c" ${MONO}>+15</text><path d="M20 37 H46" stroke="#8f836c" stroke-width="1.2"></path><text x="44" y="48" font-size="11" text-anchor="end" fill="#8f836c" ${MONO}>42</text>${LENS}`,
    review: `${back(12, 12, 44, 28, -12, 34, 26, '6+9', 12, ROUND, 5)}${back(34, 10, 44, 28, 9, 56, 24, '15−7', 12, ROUND, 5)}<rect x="20" y="24" width="50" height="32" rx="5" fill="#fff" stroke="currentColor" stroke-width="2"></rect><text x="45" y="46" font-size="17" font-weight="800" text-anchor="middle" fill="currentColor" ${ROUND}>8×7</text>`,
  },
  english: {
    preview: `${STAR}${BOOK}<path d="M14 23 H38 M14 29 H38 M14 41 H38" stroke="#cdd6e2" stroke-width="1.2"></path><path d="M14 35 H38" stroke="#e39a9a" stroke-width="1.2"></path><text x="62" y="39" font-size="18" font-weight="700" text-anchor="middle" fill="currentColor" ${HAND}>Aa</text>`,
    check: `${NOTEBOOK}<path d="M14 14 H58 M14 19 H58 M14 29 H58 M14 34 H58 M14 39 H58 M14 49 H58" stroke="#cdd6e2" stroke-width="1"></path><path d="M14 24 H58 M14 44 H58" stroke="#e39a9a" stroke-width="1"></path><text x="16" y="24" font-size="11" fill="#8f836c" ${HAND}>apple</text><text x="16" y="44" font-size="11" fill="#8f836c" ${HAND}>pen</text>${LENS}`,
    review: `${back(10, 14, 48, 28, -10, 36, 28, 'dog', 13, HAND, 5)}<rect x="24" y="26" width="50" height="30" rx="5" fill="#fff" stroke="currentColor" stroke-width="2"></rect><text x="49" y="47" font-size="16" font-weight="700" text-anchor="middle" fill="currentColor" ${HAND}>cat</text>`,
  },
  // 别的老师:同样的书、本子、一摞,不带学科内容
  plain: {
    preview: `${STAR}${BOOK}<path d="M15 24 H37 M15 32 H37 M15 40 H31 M51 24 H73 M51 32 H73 M51 40 H67" stroke="#d9b97a" stroke-width="2" stroke-linecap="round"></path>`,
    check: `${NOTEBOOK}<path d="M15 18 H58 M15 28 H52 M15 38 H46" stroke="#cdbf9f" stroke-width="2" stroke-linecap="round"></path>${LENS}`,
    review: `${back(12, 14, 44, 28, -12, 34, 28, '', 12, ROUND, 5)}${back(34, 12, 44, 28, 9, 56, 26, '', 12, ROUND, 5)}<rect x="20" y="24" width="50" height="32" rx="5" fill="#fff" stroke="currentColor" stroke-width="2"></rect><path d="M29 35 H61 M29 44 H53" stroke="currentColor" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"></path>`,
  },
};

/** 内联进孩子端页面:tileArt(mark, id) → 整个 <svg>(aria-hidden,字在旁边的 .btx 里) */
export const HOME_TILES_JS = `
  var TILE_ART = ${JSON.stringify(TILE_ART)};
  var tileArt = function (mark, id) {
    var set = TILE_ART[mark] || TILE_ART.plain;
    return '<svg viewBox="0 0 88 60" aria-hidden="true" focusable="false">' + (set[id] || '') + '</svg>';
  };
`;

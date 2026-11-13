/**
 * 白板:没有照片可拍时的一块白板(复习常常没有可拍的东西),老师在上面写一个词、一道算式,孩子在上面圈、画。
 * 《画板为主设计》「新做」:白板上最普通的一种画法。点阵、方向盘也是白板上的画法,这个只写字。
 * 一行一段字,竖着排在正中;字号照最长的那行放得下算。每一行是孩子能指的一样东西(圈住了就说这一行)。
 */

import type { ChalkSkeleton } from '../types.ts';
import { markPhrases } from './marks.ts';
import type { Kit, KitScene } from './types.ts';

const W = 1000;
const H = 625;
const INK = '#1e1e1e';
const LINES_MAX = 4;
const CHARS_MAX = 16;
const FONT_MAX = 110;
const LINE = 1.25;

/** 手写体里一段字大约多宽(字号的倍数):汉字一个字宽,数字、字母、符号窄一些(同 photo.ts) */
const widthOf = (s: string): number => Array.from(s).reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? 0.62 : 1), 0);

function readWrites(v: string): string {
  const rows = v.split(/[;;]/).map((x) => x.trim().replace(/\|/g, '')).filter(Boolean);
  if (!rows.length || rows.length > LINES_MAX || rows.some((r) => Array.from(r).length > CHARS_MAX)) throw new Error(`白板的「写」最多 ${LINES_MAX} 行、一行最多 ${CHARS_MAX} 个字,几行用分号隔开,如:傍晚;18 ÷ 3 = 6`);
  return rows.join(';');
}

const rowsOf = (p: Readonly<Record<string, string>>): string[] => (p['写'] ?? '').split(';').filter(Boolean);

export const white: Kit = {
  name: '白板',
  about: '没有照片时的一块白板:你在上面写一个词、一道算式,孩子在上面圈、画。',
  ops: ['圈', '画', '看'],
  params: [
    { key: '写', note: `写在白板正中的字:一个词、一道算式。几行用分号隔开,最多 ${LINES_MAX} 行,一行最多 ${CHARS_MAX} 个字。不写就是一块空白板,孩子自己画。`, read: readWrites, fallback: '' },
  ],
  build(p): KitScene {
    const rows = rowsOf(p);
    const sk: ChalkSkeleton[] = [];
    if (rows.length) {
      const wide = Math.max(...rows.map(widthOf));
      const font = Math.round(Math.min(FONT_MAX, (W * 0.8) / wide, (H * 0.8) / (rows.length * LINE * 1.15)));
      const gap = font * LINE * 1.15;
      const top = H / 2 - (rows.length * gap) / 2;
      rows.forEach((r, i) => {
        const w = widthOf(r) * font;
        sk.push({ type: 'text', id: `white-${i}-${r}`, label: r, text: r, x: Math.round(W / 2 - w / 2), y: Math.round(top + i * gap + (gap - font * LINE) / 2), width: Math.round(w), height: Math.round(font * LINE), fontSize: font, strokeColor: INK, animateDuration: 260 * Array.from(r).length });
      });
    }
    return { skeletons: sk, groups: [], turns: [], frame: [0, 0, W, H] };
  },
  read(_p, state, scene) {
    const marks = (state.marks ?? []).filter((s) => s.length);
    if (!marks.length) return '还没画';
    const said = markPhrases(scene, state);
    return [`画了 ${marks.length} 笔`, ...said.filter((s) => s !== '有一笔画在空白处')].join(';') + (said.includes('有一笔画在空白处') ? ';有画在空白处的,看图' : '');
  },
};

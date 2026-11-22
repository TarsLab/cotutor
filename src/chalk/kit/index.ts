/**
 * 图形的入口(纯函数,浏览器外可用):有哪几种、[[摆 …]] 的参数怎么读。白纸条上的图形(src/board/strip.ts)从这里拿。
 * 画面与读数由各图形自己定(dots.ts 点阵、compass.ts 方向盘);一笔指着什么、转到哪了在 marks.ts。
 * 课本与照片页的几何在 book.ts,照片认出的字换成课本的样子在 photo.ts,练习册的一页换成课本的样子在 workbook.ts。
 * 加一种图形 = 加一个文件 + KITS 里一行 + src/board/acts.ts 的 SHAPES,再在 cards/动作怎么写.md 里写它的写法。
 */

import { compass } from './compass.ts';
import { dots } from './dots.ts';
import type { Kit } from './types.ts';

export { BOOK_ASPECT, BOOK_GAP, BOOK_MAX_PAGES, BOOK_TOC, BOOK_W, PICK_CHARS, SECTION_NAMES, bookCut, bookCellsOf, bookFind, bookSpot, bookFrame, bookHeight, bookPages, bookPick, bookRows, bookSheets, bookTarget, bookView, findLesson, lessonBlocks, lessonName, lineBox, pickEnglish, pickable, type BookBlock, type BookSheet, type SceneCell } from './book.ts';
export { PHOTO_ITEM, photoBookPage, photoText, type PhotoLine, type PhotoQuestion, type PhotoText, type PhotoWord } from './photo.ts';
export { workbookBookPage, workbookInk, workbookPage, workbookPageId, workbookText, workbookWriteRegions } from './workbook.ts';
export type { Kit, KitParam, KitScene, KitState, KitTurn } from './types.ts';
export { kitMarks, markPhrases, turnOf, turnPoint, turnedSkeletons, type KitMark } from './marks.ts';

export const KITS: readonly Kit[] = [dots, compass];

export function kitOf(name: string): Kit | undefined {
  return KITS.find((k) => k.name === name);
}

/** 「上: 东」「线:竖 3」这样的一行;键不是这种图形的参数就不算 */
const PARAM_LINE = /^(\S{1,8}?)\s*[::]\s*(\S.*)$/;

const fallbackOf = (d: Kit['params'][number]): string => (d.values ? d.values[0] : (d.fallback ?? ''));

/** [[摆 …]] 后面的几行 → 参数(补齐缺省)和没认出来的那一截(prompt);写错了就抛 */
export function readKitLines(kit: Kit, lines: readonly string[]): { params: Record<string, string>; prompt: string } {
  const params: Record<string, string> = {};
  const rest: string[] = [];
  for (const l of lines) {
    const short = kit.shorthand?.(l);
    if (short) { for (const [k, v] of Object.entries(short)) { const d = kit.params.find((x) => x.key === k); params[k] = d?.read ? d.read(v) : v; } continue; }
    const m = PARAM_LINE.exec(l);
    const def = m ? kit.params.find((x) => x.key === m[1]) : undefined;
    if (!m || !def) { rest.push(l); continue; }
    const v = m[2].trim();
    if (def.values) {
      if (!def.values.includes(v)) throw new Error(`${kit.name}的「${def.key}」只能写:${def.values.join('、')}`);
      params[def.key] = v;
    } else params[def.key] = def.read ? def.read(v) : v;
  }
  for (const d of kit.params) {
    if (params[d.key] !== undefined) continue;
    if (d.required) throw new Error(`${kit.name}要写「${d.key}」:${d.note}`);
    params[d.key] = fallbackOf(d);
  }
  // 参数照这种画法列的顺序排(存下来的样子不随老师写的先后变)
  const ordered: Record<string, string> = {};
  for (const d of kit.params) ordered[d.key] = params[d.key];
  return { params: ordered, prompt: rest.join(' ').trim() };
}

/** 存下来的参数(卡的 props)再查一遍、补齐缺省;不对的值退回缺省(老对话里存的,不抛) */
export function kitParams(kit: Kit, raw: Readonly<Record<string, unknown>> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of kit.params) {
    const v = raw?.[d.key];
    if (typeof v !== 'string') { out[d.key] = fallbackOf(d); continue; }
    if (d.values) { out[d.key] = d.values.includes(v) ? v : d.values[0]; continue; }
    try { out[d.key] = d.read ? d.read(v) : v; } catch { out[d.key] = fallbackOf(d); }
  }
  return out;
}

/**
 * 教具的入口(纯函数,浏览器外可用):有哪几种、围栏里的参数怎么读、孩子做了什么说成给老师的那几句。
 * 画面与读数由各教具自己定(photo.ts 照片、white.ts 白板、compass.ts 方向盘、dots.ts 点阵);一笔指着什么、转到哪了在 marks.ts。
 * 舞台(src/ui/stage/kit.tsx)与板书的教具卡(src/board/cards/kit.ts)都从这里拿。
 * 加一种教具 = 加一个文件 + KITS 里一行,再在 cards/kit/card.md 里写它的参数、操作与例子。
 */

import { compass } from './compass.ts';
import { dots } from './dots.ts';
import { PHOTO_PICK, photo } from './photo.ts';
import { white } from './white.ts';
import type { Kit, KitState } from './types.ts';

export { KIT_MARK_MAX, KIT_MARK_POINTS, KIT_PICK_CHARS, KIT_PICK_MAX } from './types.ts';
export { PHOTO_PICK, photoPick, pickable, type PhotoLine, type PhotoWord } from './photo.ts';
export type { Kit, KitEnv, KitParam, KitScene, KitState, KitTurn } from './types.ts';
export { kitMarks, markPhrases, turnOf, turnPoint, turnedSkeletons, type KitMark } from './marks.ts';

export const KITS: readonly Kit[] = [photo, white, dots, compass];

/** 只看、不动笔的那种「操作」:写明了才算,不写操作时不在全开里;只开放它的卡没有笔、没有「给老师看」 */
export const KIT_LOOK = '看';
/** 写明了才有的操作:「看」,和「点字」(要先认照片上的字,只有写了「认字收到什么」的 activity 里才有东西可点) */
const ASKED_ONLY: readonly string[] = [KIT_LOOK, PHOTO_PICK];
const openOps = (kit: Kit): string[] => kit.ops.filter((x) => !ASKED_ONLY.includes(x));

/** 这张卡是不是没有东西要交回来:只开放「看」「点字」(点字是孩子自己看笔顺,不用「给老师看」) */
export const kitLookOnly = (ops: readonly string[]): boolean => ops.length > 0 && ops.every((x) => ASKED_ONLY.includes(x));

export function kitOf(name: string): Kit | undefined {
  return KITS.find((k) => k.name === name);
}

/** 「上: 东」「线:竖 3」这样的一行;键不是这种教具的参数(也不是「操作」)就不算,那是题目里的一句话 */
const PARAM_LINE = /^(\S{1,8}?)\s*[::]\s*(\S.*)$/;
const LIST = /[、,,\s]+/;

const fallbackOf = (d: Kit['params'][number]): string => (d.values ? d.values[0] : (d.fallback ?? ''));

/**
 * 围栏正文(教具名之后的那几行)→ 参数、这一步开放的操作、题目。参数补齐缺省;写错了就抛(卡退成文字,家长视图报一行)。
 * 「操作: 切、涂」只开放这几种;不写 = 这种教具的全部操作。
 */
export function readKitLines(kit: Kit, lines: readonly string[]): { params: Record<string, string>; ops: string[]; prompt: string } {
  const params: Record<string, string> = {};
  let ops: string[] | null = null;
  const rest: string[] = [];
  for (const l of lines) {
    const short = kit.shorthand?.(l);
    if (short) { for (const [k, v] of Object.entries(short)) { const d = kit.params.find((x) => x.key === k); params[k] = d?.read ? d.read(v) : v; } continue; }
    const m = PARAM_LINE.exec(l);
    if (m && m[1] === '操作') {
      const want = m[2].split(LIST).map((x) => x.trim()).filter(Boolean);
      const bad = want.filter((x) => !kit.ops.includes(x));
      if (bad.length || !want.length) throw new Error(`${kit.name}上孩子能做的操作只有:${kit.ops.join('、')}`);
      ops = kit.ops.filter((x) => want.includes(x));
      continue;
    }
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
  return { params: ordered, ops: ops ?? openOps(kit), prompt: rest.join(' ').trim() };
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

/** 存下来的操作清单:只留这种教具有的;空的、不对的 = 全开 */
export function kitOps(kit: Kit, raw: unknown): string[] {
  const want = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  const ok = kit.ops.filter((x) => want.includes(x));
  return ok.length ? ok : openOps(kit);
}

/**
 * 孩子在教具上做了什么,给老师的那几句:这一步请他做的操作、应用照几何算的大概。图另附(老师以图为准)。
 * 例:「请他做的:切;大概:画了 2 道竖线,大致分成 6、6、6」。
 */
export function describeKit(kit: Kit, params: Readonly<Record<string, string>>, state: KitState, ops: readonly string[] = kit.ops): string {
  return `请他做的:${ops.join('、')};大概:${kit.read(params, state, kit.build(params, { aspect: state.aspect }))}`;
}

/** 孩子做了没有(舞台、页面判断「给老师看」能不能按) */
export function kitTouched(state: KitState | null | undefined): boolean {
  return Boolean(state && ((state.moves ?? 0) > 0 || (state.marks?.length ?? 0) > 0));
}

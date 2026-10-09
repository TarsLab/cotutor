/**
 * 一堂课的时钟(纯函数,浏览器外可用):课包的每一步首尾相接成一条时间线,像视频一样能问「第 t 毫秒是什么样」。
 * ChalkPlayer 是接力式(一步画完停在气口);这里不停气口——停不停是播放器的事,时钟只管时间。
 *
 * 一段 = 一步,段长 = max(这步画多久, 这步配音多久):画完了定格、声音接着讲;声音先完,等画完。
 * 课的 0 毫秒对着 SVG 时间线的 START_MS(开头那一秒空白不算进课里)。笔画按配音拉伸(stretchToAudio,只拉不缩、封顶 5 倍)。
 * 笔顺里的动作(擦掉、换画板,core/actions.ts)和画一笔一样占时间;被擦的元素记下擦它的那段时间,擦完就不在画面上了。
 */

import type { ChalkSkeleton, ChalkStep } from '../player/types.ts';
import { resolveActions } from './actions.ts';
import { durationOf, FREEZE_EPS_MS, START_MS, stretchToAudio } from '../player/timeline.ts';

export interface LessonSegment {
  /** 第几步(0 起,与 steps 同序) */
  index: number;
  /** 这一段在课里的起点与长度(毫秒) */
  start: number;
  len: number;
  /** 这一步笔画在 SVG 时间线上的窗(毫秒,含 START_MS) */
  drawStart: number;
  drawEnd: number;
  /** 配音时长;没有配音 = null */
  audioMs: number | null;
  line: string;
  audioSrc?: string;
}

/** 一个元素(或动作)在 SVG 时间线上的账 */
export interface ElementWindow {
  /** 什么时候开始画、画完(毫秒) */
  start: number;
  end: number;
  /** 第几步画的(0 起;没进任何一步 = -1) */
  step: number;
  /** 在第几块画板上(0 起;换画板的动作算在旧板上) */
  board: number;
  /** 被擦掉的那段时间(擦它的动作的窗);没被擦 = 没有 */
  erased?: { start: number; end: number };
}

export interface LessonClock {
  /** 拉伸后的元素(时长和这条时钟同一份数) */
  skeletons: ChalkSkeleton[];
  segments: LessonSegment[];
  /** 课长(毫秒) */
  total: number;
  elements: Map<string, ElementWindow>;
  /** 换画板的动作什么时候换完(毫秒,按笔顺);第 k 个换完以后是第 k + 1 块画板。可缺(应用自己拼的时钟,如视频)= 没换过 */
  boardSwitches?: number[];
}

/**
 * 课包 → 时钟。steps 的 elementIds 应按顺序覆盖全部元素(drawtell 的约定,check 把关);
 * 这里不抛:没对上的元素照样排进 SVG 时间线,只是不属于任何一步。durations 同 stretchToAudio(播放器探测到的配音时长)。
 */
export function lessonClock(
  skeletons: readonly ChalkSkeleton[],
  steps: readonly ChalkStep[],
  opts: { durations?: ReadonlyArray<number | null | undefined>; maxStretch?: number } = {},
): LessonClock {
  const stretched = stretchToAudio(skeletons, steps, opts).skeletons;
  const stepOf = new Map<string, number>();
  steps.forEach((s, i) => s.elementIds.forEach((id) => stepOf.set(id, i)));
  const acts = resolveActions(stretched);
  const elements = new Map<string, ElementWindow>();
  const boardSwitches: number[] = [];
  let cur = START_MS;
  for (const e of stretched) {
    const start = cur;
    cur += durationOf(e);
    elements.set(e.id, { start, end: cur, step: stepOf.get(e.id) ?? -1, board: acts.boardOf.get(e.id) ?? 0 });
    if (e.type === 'board') boardSwitches.push(cur);
  }
  for (const [id, by] of acts.erasedBy) {
    const w = elements.get(id);
    const a = elements.get(by);
    if (w && a) w.erased = { start: a.start, end: a.end };
  }
  const segments: LessonSegment[] = [];
  let prevDraw = START_MS;
  let at = 0;
  steps.forEach((s, i) => {
    const last = s.elementIds[s.elementIds.length - 1];
    const drawEnd = last !== undefined ? (elements.get(last)?.end ?? prevDraw) : prevDraw;
    const audioMs = opts.durations?.[i] ?? s.audioDurationMs ?? null;
    const len = Math.max(drawEnd - prevDraw, audioMs ?? 0, 1);
    segments.push({ index: i, start: at, len, drawStart: prevDraw, drawEnd, audioMs, line: s.line, ...(s.audioSrc ? { audioSrc: s.audioSrc } : {}) });
    at += len;
    prevDraw = drawEnd;
  });
  return { skeletons: stretched, segments, total: at, elements, boardSwitches };
}

/** 课里的某一刻 → 第几段、段内多少、SVG 该停在哪(毫秒;画完了定格在窗终点前半毫秒)。越界夹到 0..total;没有步 index = -1 */
export function clockAt(clock: Pick<LessonClock, 'segments' | 'total'>, ms: number): { index: number; offset: number; svgMs: number } {
  const t = Math.max(0, Math.min(ms, clock.total));
  const segs = clock.segments;
  if (!segs.length) return { index: -1, offset: 0, svgMs: START_MS };
  let i = segs.findIndex((s) => t < s.start + s.len);
  if (i < 0) i = segs.length - 1;
  const s = segs[i];
  const offset = t - s.start;
  return { index: i, offset, svgMs: Math.min(s.drawStart + offset, s.drawEnd - FREEZE_EPS_MS) };
}

/** 某一刻的元素:画了多少(0–1,开始画了就算有);正在被擦的,fade = 还剩几成(1 → 0) */
export interface FrameElement {
  id: string;
  progress: number;
  fade?: number;
}

/**
 * 某一刻的画面(数据,不是图):在第几段、念哪句、SVG 停在哪、在第几块画板、画面上已经有的元素与每个画了多少。
 * 擦完了的元素不在里面;动作(擦掉、换画板)也在里面(progress 是动作做到哪,渲染端画橡皮、算淡出用)。
 */
export interface LessonFrame {
  index: number;
  line: string;
  svgMs: number;
  board: number;
  elements: FrameElement[];
}

export function frameAt(clock: LessonClock, ms: number): LessonFrame {
  const at = clockAt(clock, ms);
  return { index: at.index, line: clock.segments[at.index]?.line ?? '', svgMs: at.svgMs, board: boardAtSvgTime(clock, at.svgMs), elements: elementsAtSvgTime(clock, at.svgMs) };
}

/** SVG 时间线上的某一刻在第几块画板 */
export function boardAtSvgTime(clock: Pick<LessonClock, 'boardSwitches'>, svgMs: number): number {
  return (clock.boardSwitches ?? []).filter((t) => t <= svgMs).length;
}

/** SVG 时间线上的某一刻(毫秒,含 START_MS)画面上有哪些元素、各画了多少:存的是 SVG 时刻的(圈的卡的缩略图)直接用它 */
export function elementsAtSvgTime(clock: Pick<LessonClock, 'elements'>, svgMs: number): FrameElement[] {
  const out: FrameElement[] = [];
  for (const [id, w] of clock.elements) {
    if (w.start >= svgMs) continue;
    if (w.erased && w.erased.end <= svgMs) continue;
    const progress = w.end <= w.start ? 1 : Math.min(1, (svgMs - w.start) / (w.end - w.start));
    const e = w.erased;
    out.push(e && e.start < svgMs ? { id, progress, fade: 1 - (svgMs - e.start) / (e.end - e.start) } : { id, progress });
  }
  return out;
}

/**
 * 一堂课的时钟(纯函数,浏览器外可用):课包的每一步首尾相接成一条时间线,像视频一样能问「第 t 毫秒是什么样」。
 * ChalkPlayer 是接力式(一步画完停在气口);这里不停气口——停不停是播放器的事,时钟只管时间。
 *
 * 一段 = 一步,段长 = max(这步画多久, 这步配音多久):画完了定格、声音接着讲;声音先完,等画完。
 * 课的 0 毫秒对着 SVG 时间线的 START_MS(开头那一秒空白不算进课里)。笔画按配音拉伸(stretchToAudio,只拉不缩、封顶 5 倍),
 * 拉伸后的元素要原样交给 buildAnimatedSvg,SVG 的时间才和这条时钟对得上。
 */

import type { ChalkSkeleton, ChalkStep } from '../player/types.ts';
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

export interface LessonClock {
  /** 拉伸后的元素(给 buildAnimatedSvg;时长和这条时钟同一份数) */
  skeletons: ChalkSkeleton[];
  segments: LessonSegment[];
  /** 课长(毫秒) */
  total: number;
  /** 每个元素在 SVG 时间线上什么时候开始画、画完(毫秒),第几步画的(0 起;没进任何一步 = -1) */
  elements: Map<string, { start: number; end: number; step: number }>;
}

/**
 * 课包 → 时钟。steps 的 elementIds 应按顺序覆盖全部元素(drawtell 的约定,check 把关);
 * 这里不抛:没对上的元素照样排进 SVG 时间线,只是不属于任何一步。durations 同 stretchToAudio(播放器探测到的配音时长)。
 */
export function lessonClock(
  skeletons: readonly ChalkSkeleton[],
  steps: readonly ChalkStep[],
  opts: { durations?: ReadonlyArray<number | null | undefined> } = {},
): LessonClock {
  const stretched = stretchToAudio(skeletons, steps, opts).skeletons;
  const stepOf = new Map<string, number>();
  steps.forEach((s, i) => s.elementIds.forEach((id) => stepOf.set(id, i)));
  const elements = new Map<string, { start: number; end: number; step: number }>();
  let cur = START_MS;
  for (const e of stretched) {
    const start = cur;
    cur += durationOf(e);
    elements.set(e.id, { start, end: cur, step: stepOf.get(e.id) ?? -1 });
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
  return { skeletons: stretched, segments, total: at, elements };
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

/** 某一刻的画面(数据,不是图):在第几段、念哪句、SVG 停在哪、画面上已经有的元素与每个画了多少(0–1,开始画了就算有) */
export interface LessonFrame {
  index: number;
  line: string;
  svgMs: number;
  elements: { id: string; progress: number }[];
}

export function frameAt(clock: LessonClock, ms: number): LessonFrame {
  const at = clockAt(clock, ms);
  return { index: at.index, line: clock.segments[at.index]?.line ?? '', svgMs: at.svgMs, elements: elementsAtSvgTime(clock, at.svgMs) };
}

/** SVG 时间线上的某一刻(毫秒,含 START_MS)画面上有哪些元素、各画了多少:存的是 SVG 时刻的(圈的卡的缩略图)直接用它 */
export function elementsAtSvgTime(clock: Pick<LessonClock, 'elements'>, svgMs: number): { id: string; progress: number }[] {
  const out: { id: string; progress: number }[] = [];
  for (const [id, w] of clock.elements) {
    if (w.start >= svgMs) continue;
    out.push({ id, progress: w.end <= w.start ? 1 : Math.min(1, (svgMs - w.start) / (w.end - w.start)) });
  }
  return out;
}

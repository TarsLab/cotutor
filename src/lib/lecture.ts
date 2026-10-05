/**
 * 小课堂(《小课堂设计.md》)的时钟:课包的每一步首尾相接成一条时间线,像视频一样能拖到任意一刻。纯函数,服务端(课长、上下文包
 * lecture: 的每句起点)与舞台包(播放器)共用。
 *
 * 画的部分照 drawtell 的 timeline.ts(dist/player/timeline.js)一字不差地算:笔画串行、单笔 animateDuration 缺省 500、
 * 起点 START_MS;按配音拉伸(只拉不缩、封顶 5 倍)。drawtell 的包只导出整个播放器(带 React),服务端 import 不了,
 * 所以照抄一份;tests/lecture.test.ts 拿 drawtell 的原函数对。
 *
 * 时钟:一段 = 一步,段长 = max(这步画多久, 这步配音多久)——画完了定格,声音接着讲;声音先完,等画完。
 * 课的 0 毫秒对着 SVG 的 START_MS(开头那一秒空白不算进课里)。
 */

/** drawtell timeline.ts 的常量 */
export const DRAW_START_MS = 1000;
const DEFAULT_DUR = 500;
const MAX_STRETCH = 5;
/** 步尾定格退半毫秒(drawtell FREEZE_EPS_MS:停在整点会露出下一笔的起点) */
const FREEZE_EPS_MS = 0.5;

export interface LectureSkeleton {
  id: string;
  animateDuration?: number;
  [key: string]: unknown;
}
export interface LectureStep {
  step: number;
  elementIds: string[];
  line: string;
  audioSrc?: string;
  audioDurationMs?: number;
}

export interface LectureSegment {
  /** 第几步(0 起,与 steps 同序) */
  index: number;
  /** 这一段在课里的起点与长度(毫秒) */
  start: number;
  len: number;
  /** 这一步笔画在 SVG 时间线上的窗(毫秒,含 DRAW_START_MS) */
  drawStart: number;
  drawEnd: number;
  /** 配音时长;没有配音 = null */
  audioMs: number | null;
  line: string;
  audioSrc?: string;
}

export interface LectureClock {
  /** 拉伸后的元素(给 buildAnimatedSvg;时长和这条时钟同一份数) */
  skeletons: LectureSkeleton[];
  segments: LectureSegment[];
  /** 课长(毫秒) */
  total: number;
  /** 每个元素在 SVG 时间线上什么时候开始画、画完(毫秒) */
  elements: Map<string, { start: number; end: number; step: number }>;
}

export const durationOf = (e: { animateDuration?: number }): number => e.animateDuration ?? DEFAULT_DUR;

/** 课包 → 时钟。steps 的 elementIds 要按顺序覆盖全部元素(drawtell 的约定);没对上的元素不进任何一段 */
export function lectureClock(skeletons: readonly LectureSkeleton[], steps: readonly LectureStep[]): LectureClock {
  const byId = new Map(skeletons.map((e) => [e.id, e]));
  // 拉伸:有配音、配音比画长,这一步的笔画等比放大到 ≈ 配音时长(封顶 5 倍)
  const factor = new Map<string, number>();
  for (const s of steps) {
    const els = s.elementIds.map((id) => byId.get(id)).filter((e): e is LectureSkeleton => !!e);
    const drawMs = els.reduce((a, e) => a + durationOf(e), 0);
    const audioMs = s.audioDurationMs ?? null;
    const f = audioMs && drawMs > 0 && audioMs > drawMs ? Math.min(audioMs / drawMs, MAX_STRETCH) : 1;
    for (const e of els) factor.set(e.id, f);
  }
  const stretched = skeletons.map((e) => {
    const f = factor.get(e.id) ?? 1;
    return f === 1 ? e : { ...e, animateDuration: Math.round(durationOf(e) * f) };
  });
  const elements = new Map<string, { start: number; end: number; step: number }>();
  const stepOf = new Map<string, number>();
  steps.forEach((s, i) => s.elementIds.forEach((id) => stepOf.set(id, i)));
  let cur = DRAW_START_MS;
  for (const e of stretched) {
    const start = cur;
    cur += durationOf(e);
    elements.set(e.id, { start, end: cur, step: stepOf.get(e.id) ?? -1 });
  }
  const segments: LectureSegment[] = [];
  let prevDraw = DRAW_START_MS;
  let at = 0;
  steps.forEach((s, i) => {
    const last = s.elementIds[s.elementIds.length - 1];
    const drawEnd = last !== undefined ? (elements.get(last)?.end ?? prevDraw) : prevDraw;
    const drawStart = prevDraw;
    const audioMs = s.audioDurationMs ?? null;
    const len = Math.max(drawEnd - drawStart, audioMs ?? 0, 1);
    segments.push({ index: i, start: at, len, drawStart, drawEnd, audioMs, line: s.line, ...(s.audioSrc ? { audioSrc: s.audioSrc } : {}) });
    at += len;
    prevDraw = drawEnd;
  });
  return { skeletons: stretched, segments, total: at, elements };
}

/** 课里的某一刻 → 第几段、段内多少、SVG 该停在哪(毫秒)。越界夹到 0..total */
export function lectureAt(clock: Pick<LectureClock, 'segments' | 'total'>, ms: number): { index: number; offset: number; svgMs: number } {
  const t = Math.max(0, Math.min(ms, clock.total));
  const segs = clock.segments;
  if (!segs.length) return { index: -1, offset: 0, svgMs: DRAW_START_MS };
  let i = segs.findIndex((s) => t < s.start + s.len);
  if (i < 0) i = segs.length - 1;
  const s = segs[i];
  const offset = t - s.start;
  return { index: i, offset, svgMs: Math.min(s.drawStart + offset, s.drawEnd - FREEZE_EPS_MS) };
}

/** 那一刻画面上已经有的元素(开始画了就算;画到一半的也算) */
export function drawnAt(clock: Pick<LectureClock, 'segments' | 'total' | 'elements'>, ms: number): string[] {
  const { svgMs } = lectureAt(clock, ms);
  return [...clock.elements].filter(([, w]) => w.start <= svgMs).map(([id]) => id);
}

/** 毫秒 → 「分:秒」;一小时以上「时:分:秒」 */
export function clockLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 上下文包 lecture.lines:每段一句「0:18 讲稿」 */
export function lectureLines(clock: Pick<LectureClock, 'segments'>): string[] {
  return clock.segments.map((s) => `${clockLabel(s.start)} ${s.line.trim()}`);
}

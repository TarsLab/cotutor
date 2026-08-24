/**
 * 步进时间轴:镜像 excalidraw-animate 的调度规则自行计算,不读回 SVG。
 * (getBeginTimeList 会把 defs 里 text 辅助 path 计入,索引与元素错位,不可靠。)
 *
 * animateSvg 的规则(0.7.2 dist/animate.js):元素无 groupIds 时按数组顺序串行,
 * 单笔时长从 id 中 `animateDuration:N` 读,否则 500ms;起点 startMs(默认 1000)。
 * 创作层时长是 animateDuration 字段,由 excalidraw-io 注回 id——本模块与 animateSvg
 * 消费同一份数值,天然一致。前提:不用 groupIds、id 不带 animate 指令——validate 兜底。
 */

import type { ChalkSkeleton, ChalkStep } from './types.ts';

export const START_MS = 1000;
const DEFAULT_DUR = 500;

/**
 * 步尾定格不能停在 endMs 整点:SMIL 在 t == begin 时下一笔已经 active——
 * round 线帽会露出下一笔起点的一个点,笔尖也跳到下一笔起点(第一批真题检验方反复报"下一步痕迹")。
 * 退半毫秒:本步末笔 99.9% 以上已画完(肉眼不可辨),下一笔仍处于 opacity 0。
 */
export const FREEZE_EPS_MS = 0.5;

/** 步尾定格时刻(秒),给 setCurrentTime 用 */
export function freezeTimeSec(win: StepWindow): number {
  return (win.endMs - FREEZE_EPS_MS) / 1000;
}

export function durationOf(el: ChalkSkeleton): number {
  return el.animateDuration ?? DEFAULT_DUR;
}

export interface StepWindow {
  startMs: number;
  endMs: number;
}

/**
 * 校验并计算每步的时间窗。
 * 要求:steps 的 elementIds 恰好按顺序覆盖全部 skeleton(笔顺即步序)。
 */
export function computeStepWindows(
  skeletons: readonly ChalkSkeleton[],
  steps: readonly ChalkStep[],
): StepWindow[] {
  // 静态场景(steps 为空)没有时间窗;覆盖检查只对有步进的场景有意义
  if (!steps.length) return [];
  const flat = steps.flatMap((s) => s.elementIds);
  const ids = skeletons.map((e) => e.id);
  if (flat.length !== ids.length || flat.some((id, i) => id !== ids[i])) {
    throw new Error(
      `chalk-player: steps 未按顺序覆盖全部元素\n期望: ${ids.join(', ')}\n实际: ${flat.join(', ')}`,
    );
  }
  for (const e of skeletons) {
    if (e.groupIds && (e.groupIds as string[]).length) {
      throw new Error(`chalk-player: 元素 ${e.id} 带 groupIds,会破坏串行调度`);
    }
    if (/animate(Order|Duration):/.test(e.id)) {
      throw new Error(`chalk-player: 元素 ${e.id} 的 id 携带 animate 指令;时长请写 animateDuration 字段,顺序只由数组决定`);
    }
  }

  const end = new Map<string, number>();
  let cur = START_MS;
  for (const e of skeletons) {
    cur += durationOf(e);
    end.set(e.id, cur);
  }
  let prev = START_MS;
  return steps.map((s) => {
    const startMs = prev;
    const endMs = end.get(s.elementIds[s.elementIds.length - 1])!;
    prev = endMs;
    return { startMs, endMs };
  });
}

/** 拉伸后的每步账目:画多久、音多久、放大了几倍 */
export interface StretchInfo {
  step: number;
  drawMs: number;
  audioMs: number | null;
  factor: number;
}

/**
 * 按讲稿音频时长拉伸该步笔画(只拉不缩):有配音的步,若音频比画长,把该步全部笔画的
 * animateDuration 等比放大到 ≈ 音频时长——"一边画一边数:1、2……14"时,14 个圈跟着数的节奏出现,
 * 而不是 3 秒画完干等 8 秒。作者写的时长变成步内相对权重。音频短于画:照原速画完再等音。
 * maxStretch 封顶:超过说明这步讲稿太长或画得太少,该回讲法层修,不该把一笔拖成十几秒。
 * durations[i] 可覆盖 steps[i].audioDurationMs(播放器兜底探测到的时长)。
 */
export function stretchToAudio(
  skeletons: readonly ChalkSkeleton[],
  steps: readonly ChalkStep[],
  opts: { maxStretch?: number; durations?: ReadonlyArray<number | null | undefined> } = {},
): { skeletons: ChalkSkeleton[]; info: StretchInfo[] } {
  const maxStretch = opts.maxStretch ?? 5;
  const factorById = new Map<string, number>();
  const info: StretchInfo[] = steps.map((s, i) => {
    const byId = new Map(skeletons.map((e) => [e.id, e]));
    const els = s.elementIds.map((id) => byId.get(id)).filter((e): e is ChalkSkeleton => !!e);
    const drawMs = els.reduce((a, e) => a + durationOf(e), 0);
    const audioMs = opts.durations?.[i] ?? s.audioDurationMs ?? null;
    let factor = 1;
    if (audioMs && drawMs > 0 && audioMs > drawMs) factor = Math.min(audioMs / drawMs, maxStretch);
    for (const e of els) factorById.set(e.id, factor);
    return { step: s.step, drawMs, audioMs, factor };
  });
  const out = skeletons.map((e) => {
    const f = factorById.get(e.id) ?? 1;
    return f === 1 ? e : { ...e, animateDuration: Math.round(durationOf(e) * f) };
  });
  return { skeletons: out, info };
}

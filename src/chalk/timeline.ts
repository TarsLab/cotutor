/**
 * 步进时间轴:镜像 excalidraw-animate 的调度规则自行计算,不读回 SVG。
 * (getBeginTimeList 会把 defs 里 text 辅助 path 计入,索引与元素错位,不可靠。)
 *
 * animateSvg 的规则(0.7.2 dist/animate.js):元素无 groupIds 时按数组顺序串行,
 * 单笔时长从 id 中 `animateDuration:N` 读,否则 500ms;起点 startMs(默认 1000)。
 * 创作层时长是 animateDuration 字段,由 excalidraw-io 注回 id——本模块与 animateSvg
 * 消费同一份数值,天然一致。前提:不用 groupIds、id 不带 animate 指令——validate 兜底。
 */

import type { ChalkSkeleton, ChalkStep } from './types';

export const START_MS = 1000;
const DEFAULT_DUR = 500;

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

/**
 * 场景元素交给 excalidraw 之前的预处理(纯函数,不 import excalidraw):
 * 没给 seed 的按 id 派生(手绘抖动每次一样),橡皮笔画补纸色、不抖。
 * bake 用它;应用把课包放进 excalidraw 编辑器(画板的底图)也该先过它,否则橡皮成了一道黑线、抖动每次不一样。
 */

import { PAPER_COLOR } from '../player/pointer.ts';
import { seedFromId } from '../player/seed.ts';
import type { ChalkSkeleton } from '../player/types.ts';

export const isEraser = (el: { customData?: unknown }): boolean => (el.customData as { tool?: unknown } | undefined)?.tool === 'eraser';

/** 稳定 seed + 橡皮的缺省外观;作者显式给的值优先 */
export function prepareSkeletons<T extends ChalkSkeleton>(skeletons: readonly T[]): T[] {
  return skeletons.map((el) => {
    const withSeed = typeof el.seed === 'number' ? el : { ...el, seed: seedFromId(el.id) };
    return isEraser(el) ? { strokeColor: PAPER_COLOR, roughness: 0, ...withSeed } : withSeed;
  });
}

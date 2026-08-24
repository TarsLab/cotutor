/**
 * 块几何:命中区域 = 块所引元素包围盒的并——协议语义在这里钉死,消费方(圈词命中)不各自发明。
 * 固定场景由生成器量宽后落盘,元素自带 width/height,这里只做并集;
 * CLI 侧 check 的 bboxOf 是无浏览器的字体近似,是另一回事,别混用。
 */

import type { ChalkBlock, ChalkScene, ChalkSkeleton } from './types.ts';

export interface BlockBounds {
  blockId: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function elementBounds(el: ChalkSkeleton): { minX: number; minY: number; maxX: number; maxY: number } {
  if (Array.isArray(el.points)) {
    const pts = el.points as [number, number][];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { minX: el.x + Math.min(...xs), minY: el.y + Math.min(...ys), maxX: el.x + Math.max(...xs), maxY: el.y + Math.max(...ys) };
  }
  const w = typeof el.width === 'number' ? el.width : 0;
  const h = typeof el.height === 'number' ? el.height : 0;
  return { minX: el.x, minY: el.y, maxX: el.x + w, maxY: el.y + h };
}

/** 块的命中包围盒;所引元素一个都找不到时返回 null(check 会把这种场景拦在 build 前) */
export function blockBounds(scene: ChalkScene, block: ChalkBlock): BlockBounds | null {
  const byId = new Map(scene.skeletons.map((e) => [e.id, e]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of block.elementIds) {
    const el = byId.get(id);
    if (!el) continue;
    const b = elementBounds(el);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  if (!Number.isFinite(minX)) return null;
  return { blockId: block.id, minX, minY, maxX, maxY };
}

/** 全部块的命中盒(缺元素的块被剔除),给命中判定建索引用 */
export function allBlockBounds(scene: ChalkScene): BlockBounds[] {
  return (scene.blocks ?? []).map((b) => blockBounds(scene, b)).filter((b): b is BlockBounds => b !== null);
}

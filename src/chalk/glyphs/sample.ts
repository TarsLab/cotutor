/**
 * 段 → 点序列的采样器(纯几何,无浏览器依赖)。
 *
 * 点密度直接决定两件事:笔迹曲线的平滑度,以及 excalidraw-animate 的动画粒度
 * (patchSvgFreedraw 给每个点生成一个 SMIL animate,points 越多动画越细但 DOM 越重)。
 * 按弧长自适应:每 STEP 个单位(x 高的几分之一)落一个点,直段少、圆弧多。
 */

import type { Glyph, GlyphStroke, Seg } from './types.ts';

/**
 * 默认采样步长(归一化单位):x 高 100px 时约 10px 一个点。
 *
 * 这个值同时决定曲线平滑度和**动画的 DOM 体积**,而后者是超线性的:
 * excalidraw-animate 的 patchSvgFreedraw 给每个点生成一条完整路径的 animate,
 * 体积 ≈ O(点数²)。0.05 时单个 `g` 的动画 SVG 就有 586KB,一个词上兆——
 * iPad 上会卡。0.1 视觉几无差别,体积降到约四分之一。要更平滑就按需调小。
 */
export const SAMPLE_STEP = 0.1;
/** 一段至少给几个点(短到不足一步的段也要有形) */
const MIN_PER_SEG = 2;
/** 一段最多给几个点(防止长弧把 DOM 撑爆) */
const MAX_PER_SEG = 64;

export type Pt = [number, number];

const rad = (deg: number): number => (deg * Math.PI) / 180;

function arcAt(s: Extract<Seg, { k: 'A' }>, t: number): Pt {
  const a = rad(s.a0 + (s.a1 - s.a0) * t);
  return [s.cx + s.rx * Math.cos(a), s.cy + s.ry * Math.sin(a)];
}

function cubicAt(from: Pt, s: Extract<Seg, { k: 'C' }>, t: number): Pt {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return [
    b0 * from[0] + b1 * s.c1[0] + b2 * s.c2[0] + b3 * s.to[0],
    b0 * from[1] + b1 * s.c1[1] + b2 * s.c2[1] + b3 * s.to[1],
  ];
}

/** 段的近似弧长:直线精确,曲线用 16 段折线量 */
function segLength(from: Pt, s: Seg): number {
  if (s.k === 'L') return Math.hypot(s.to[0] - from[0], s.to[1] - from[1]);
  let len = 0;
  let prev = from;
  for (let i = 1; i <= 16; i++) {
    const p = s.k === 'A' ? arcAt(s, i / 16) : cubicAt(from, s, i / 16);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

/** 段的终点(弧的终点由参数式算出,不由作者另写,避免两处不一致) */
export function segEnd(s: Seg): Pt {
  if (s.k === 'L' || s.k === 'C') return [s.to[0], s.to[1]];
  return arcAt(s, 1);
}

/**
 * 一笔 → 点序列(含起点,相邻点不重复)。
 * 段与段在接缝处共用一个点:后一段跳过 i=0。
 */
export function sampleStroke(stroke: GlyphStroke, step: number = SAMPLE_STEP): Pt[] {
  const pts: Pt[] = [[stroke.start[0], stroke.start[1]]];
  let from: Pt = pts[0];
  for (const seg of stroke.segs) {
    const n = Math.min(MAX_PER_SEG, Math.max(MIN_PER_SEG, Math.ceil(segLength(from, seg) / step)));
    for (let i = 1; i <= n; i++) {
      pts.push(seg.k === 'A' ? arcAt(seg, i / n) : seg.k === 'C' ? cubicAt(from, seg, i / n) : [
        from[0] + (seg.to[0] - from[0]) * (i / n),
        from[1] + (seg.to[1] - from[1]) * (i / n),
      ]);
    }
    from = pts[pts.length - 1];
  }
  return pts;
}

/** 一笔的总弧长(归一化单位):用来按"手写速度"分配动画时长 */
export function strokeLength(stroke: GlyphStroke): number {
  let len = 0;
  let from: Pt = [stroke.start[0], stroke.start[1]];
  for (const seg of stroke.segs) {
    len += segLength(from, seg);
    from = segEnd(seg);
  }
  return len;
}

/** 字形的墨迹包围盒(归一化单位):校验与排版用 */
export function glyphBBox(glyph: Glyph, step: number = SAMPLE_STEP): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const st of glyph.strokes) {
    for (const [x, y] of sampleStroke(st, step)) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

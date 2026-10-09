/**
 * 元素的几何(纯函数,浏览器外可用):包围盒、取样点。
 * 文字宽按 text-metrics(用真播放器量的手写字体字宽);线按点;框、椭圆、菱形按宽高。
 * 手绘抖动、线宽不算进包围盒(差一两个像素,圈与布局都不在乎)。
 */

import type { ChalkSkeleton } from '../player/types.ts';
import { isAction } from './actions.ts';
import { CHAR_EM, CJK_EM, FALLBACK_EM, LINE_HEIGHT } from './text-metrics.ts';

/** 场景坐标的包围盒 */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 课包里存的样子(scene.json 的 bounds):[minX, minY, maxX, maxY] */
export type BoundsTuple = [number, number, number, number];

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 一个字有多宽(字号 1):表里有用表里的;CJK 表意文字、全角符号按 CJK_EM;其余按 FALLBACK_EM */
export function charEm(ch: string): number {
  const w = CHAR_EM[ch];
  if (w !== undefined) return w;
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x2e80 ? CJK_EM : FALLBACK_EM;
}

/** 一段字(可多行)在这个字号下的宽高 */
export function measureText(text: string, fontSize: number): { width: number; height: number } {
  const rows = text.split('\n');
  const width = Math.max(0, ...rows.map((r) => [...r].reduce((a, ch) => a + charEm(ch), 0))) * fontSize;
  return { width, height: rows.length * fontSize * LINE_HEIGHT };
}

/** 线、箭头、自由笔画的点(场景坐标);不是这几种 = null */
export function pointsOf(el: ChalkSkeleton): [number, number][] | null {
  if (!Array.isArray(el.points)) return null;
  return (el.points as unknown[])
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
    .map((p) => [num(el.x) + p[0], num(el.y) + p[1]]);
}

function boxOfPoints(pts: readonly [number, number][]): Bounds {
  return { minX: Math.min(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxX: Math.max(...pts.map((p) => p[0])), maxY: Math.max(...pts.map((p) => p[1])) };
}

/**
 * 元素的包围盒。文字:元素自带比估的宽的 width(生成器、编辑器量过)以它为准,否则按字宽表算;
 * 有点的按点;其余按 x/y/width/height。
 */
export function elementBounds(el: ChalkSkeleton): Bounds {
  const x = num(el.x);
  const y = num(el.y);
  if (el.type === 'text') {
    const m = measureText(String(el.text ?? ''), num(el.fontSize, 20));
    const w = typeof el.width === 'number' && el.width > m.width ? el.width : m.width;
    const h = typeof el.height === 'number' && el.height > m.height ? el.height : m.height;
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }
  const pts = pointsOf(el);
  if (pts && pts.length) return boxOfPoints(pts);
  return { minX: x, minY: y, maxX: x + num(el.width), maxY: y + num(el.height) };
}

/** build 落进 scene.json 的 bounds:每个元素一个,保留一位小数 */
export function sceneBounds(skeletons: readonly ChalkSkeleton[]): Record<string, BoundsTuple> {
  const r = (n: number): number => Math.round(n * 10) / 10;
  const out: Record<string, BoundsTuple> = {};
  for (const el of skeletons) {
    if (isAction(el)) continue; // 动作不画东西,没有包围盒
    const b = elementBounds(el);
    out[el.id] = [r(b.minX), r(b.minY), r(b.maxX), r(b.maxY)];
  }
  return out;
}

/** 一组包围盒的并;空 = null */
export function unionBounds(bs: readonly Bounds[]): Bounds | null {
  if (!bs.length) return null;
  return { minX: Math.min(...bs.map((b) => b.minX)), minY: Math.min(...bs.map((b) => b.minY)), maxX: Math.max(...bs.map((b) => b.maxX)), maxY: Math.max(...bs.map((b) => b.maxY)) };
}

/** 两个盒子之间的距离(重叠 = 0) */
export function boundsGap(a: Bounds, b: Bounds): number {
  return Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY));
}

/**
 * 元素上的取样点(圈住了没有,看有多少样点落在圈里):文字取包围盒里的九宫格;线取沿线的点;
 * 框、椭圆、菱形只取边上的点——圈在框里面的东西,不算圈住了框。
 */
export function samplePoints(el: ChalkSkeleton, bounds: Bounds = elementBounds(el)): [number, number][] {
  if (el.type === 'text') {
    const out: [number, number][] = [];
    for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.25, 0.5, 0.75]) out.push([bounds.minX + (bounds.maxX - bounds.minX) * fx, bounds.minY + (bounds.maxY - bounds.minY) * fy]);
    return out;
  }
  const pts = pointsOf(el);
  if (pts && pts.length) {
    if (pts.length === 1) return pts;
    const out: [number, number][] = [];
    const per = Math.max(2, Math.ceil(12 / (pts.length - 1)));
    for (let i = 1; i < pts.length; i++) {
      for (let k = 0; k <= per; k++) {
        if (i > 1 && k === 0) continue;
        const t = k / per;
        out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      }
    }
    return out;
  }
  const { minX: x, minY: y } = bounds;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const out: [number, number][] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (el.type === 'ellipse') out.push([x + w / 2 + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)]);
    else if (el.type === 'diamond') {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const k1 = 1 / (Math.abs(c) + Math.abs(s));
      out.push([x + w / 2 + (w / 2) * c * k1, y + h / 2 + (h / 2) * s * k1]);
    } else {
      const t = (k / 16) * 4;
      const side = Math.floor(t);
      const f = t - side;
      out.push(side === 0 ? [x + w * f, y] : side === 1 ? [x + w, y + h * f] : side === 2 ? [x + w * (1 - f), y + h] : [x, y + h * (1 - f)]);
    }
  }
  return out;
}

/** 点在不在多边形里(首尾连上;射线法) */
export function insidePolygon(poly: readonly [number, number][], [x, y]: readonly [number, number]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 一串点的包围盒(圈的大小、位置) */
export function boundsOfPoints(pts: readonly [number, number][]): Bounds {
  return boxOfPoints(pts);
}

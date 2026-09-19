/**
 * 作业照片的编辑(《作业照片设计.md》§六):转 90°、裁剪框、红笔笔画的坐标,纯函数,离屏可测。
 * 页面(kid-page.ts)内联本文件(剥类型、去 export),只管画和点。
 *
 * 坐标系只有一个:「转过之后的原图」(原分辨率,已按 EXIF 摆正)。裁剪框与笔画都存在这里,
 * 再转 90° 时一起变过去;导出 = 转 → 裁 → 画笔画 → 缩到长边 ≤ maxSide。
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stroke {
  /** 线宽(图坐标) */
  width: number;
  pts: Pt[];
}

export type Rot = 0 | 1 | 2 | 3;
export type Grip = 'nw' | 'ne' | 'sw' | 'se' | 'move';

export interface PhotoEdit {
  /** 原图宽高(没转过) */
  w: number;
  h: number;
  /** 顺时针转了几个 90° */
  rot: Rot;
  /** 转过之后的图坐标;null = 整张 */
  crop: Rect | null;
  strokes: Stroke[];
}

/**
 * 上传前长边缩到这么长。2000 是 claude CLI 的 Read 工具给模型的上限(2.1.275 实测:2200 / 2560 的图到模型手里都是 2000×1500),再大白传;
 * 原来的 1600 下一页六道题、每个手写数字只有二三十像素高,老师认不准就自己裁图放大再读(一轮 16 次模型来回)。2000×1500 约 3,900 视觉 token
 */
export const PHOTO_MAX_SIDE = 2000;
/** 相册一次最多选几张(服务端上限 9 不变) */
export const PHOTO_ALBUM_MAX = 4;
/** 红笔:半透明,孩子圈的圈不把字盖死 */
export const PEN_COLOR = 'rgba(230,40,40,.65)';
/** 线宽 = 当前看到那块的长边 × 这个 */
export const PEN_RATIO = 0.015;
/** 裁剪框最小边(显示 px):再小就不是裁剪是误触 */
export const CROP_MIN_PX = 64;

export function newEdit(w: number, h: number): PhotoEdit {
  return { w, h, rot: 0, crop: null, strokes: [] };
}

/** 转过之后的宽高 */
export function rotatedSize(e: PhotoEdit): { w: number; h: number } {
  return e.rot % 2 ? { w: e.h, h: e.w } : { w: e.w, h: e.h };
}

/** 看到 / 导出的那块:有框就是框,没框就是整张 */
export function region(e: PhotoEdit): Rect {
  const s = rotatedSize(e);
  return e.crop ?? { x: 0, y: 0, w: s.w, h: s.h };
}

/** 在高为 H 的图里顺时针转 90°:(x, y) → (H − y, x) */
function turnPt(p: Pt, H: number): Pt {
  return { x: H - p.y, y: p.x };
}

/** 顺时针转 90°:框与笔画一起变过去,不重置 */
export function rotateEdit(e: PhotoEdit): PhotoEdit {
  const H = rotatedSize(e).h;
  const crop = e.crop ? { x: H - e.crop.y - e.crop.h, y: e.crop.x, w: e.crop.h, h: e.crop.w } : null;
  return { ...e, rot: ((e.rot + 1) % 4) as Rot, crop, strokes: e.strokes.map((s) => ({ ...s, pts: s.pts.map((p) => turnPt(p, H)) })) };
}

/**
 * 原图 → 转过之后的图 的 canvas 变换 [a, b, c, d, e, f](ctx.transform 的参数顺序):
 * X = a·x + c·y + e,Y = b·x + d·y + f
 */
export function rotMatrix(e: PhotoEdit): [number, number, number, number, number, number] {
  switch (e.rot) {
    case 1:
      return [0, 1, -1, 0, e.h, 0];
    case 2:
      return [-1, 0, 0, -1, e.w, e.h];
    case 3:
      return [0, -1, 1, 0, 0, e.w];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** 拖裁剪框:四角改大小、框内平移;夹在 W×H 里,边不小于 min(都是图坐标) */
export function dragCrop(from: Rect, grip: Grip, dx: number, dy: number, W: number, H: number, min: number): Rect {
  min = Math.min(min, W, H);
  if (grip === 'move') return { ...from, x: clamp(from.x + dx, 0, W - from.w), y: clamp(from.y + dy, 0, H - from.h) };
  let { x, y, w, h } = from;
  if (grip === 'nw' || grip === 'sw') {
    const nx = clamp(from.x + dx, 0, from.x + from.w - min);
    w = from.w + (from.x - nx);
    x = nx;
  } else w = clamp(from.w + dx, min, W - from.x);
  if (grip === 'nw' || grip === 'ne') {
    const ny = clamp(from.y + dy, 0, from.y + from.h - min);
    h = from.h + (from.y - ny);
    y = ny;
  } else h = clamp(from.h + dy, min, H - from.y);
  return { x, y, w, h };
}

/** 框铺满整张(或几乎整张)就当没裁 */
export function setCrop(e: PhotoEdit, r: Rect): PhotoEdit {
  const s = rotatedSize(e);
  const full = r.x <= 0.5 && r.y <= 0.5 && r.w >= s.w - 1 && r.h >= s.h - 1;
  return { ...e, crop: full ? null : r };
}

/** 把一块 w×h 放进 boxW×boxH:缩放与显示大小(只缩不放大由调用方决定,这里铺满) */
export function fitScale(w: number, h: number, boxW: number, boxH: number): number {
  return Math.max(Math.min(boxW / w, boxH / h), 1e-6);
}

/** 新起一笔:线宽跟着当前看到的那块走 */
export function newStroke(e: PhotoEdit, p: Pt): Stroke {
  const r = region(e);
  return { width: Math.max(r.w, r.h) * PEN_RATIO, pts: [p] };
}

export interface ExportPlan {
  /** 输出宽高 */
  w: number;
  h: number;
  /** 转过之后的图里取哪块 */
  src: Rect;
  /** 图坐标 → 输出 px */
  scale: number;
}

/** 导出:取 region,长边缩到 ≤ maxSide(不放大) */
export function exportPlan(e: PhotoEdit, maxSide = PHOTO_MAX_SIDE): ExportPlan {
  const src = region(e);
  const scale = Math.min(1, maxSide / Math.max(src.w, src.h, 1));
  return { w: Math.max(1, Math.round(src.w * scale)), h: Math.max(1, Math.round(src.h * scale)), src, scale };
}

/** 改过没有(没改过的照片导出只是缩小) */
export function edited(e: PhotoEdit): boolean {
  return e.rot !== 0 || e.crop !== null || e.strokes.length > 0;
}

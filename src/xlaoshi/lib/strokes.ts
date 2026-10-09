/**
 * 小老师的笔迹(《wip/小老师设想.md》§四):一笔 = 颜色 + 粗细 + 点列,每个点带离开始讲多少毫秒;撤销、清空不删笔,记下它没了的那一刻(gone)。
 * 回放、出帧、数「这一句画了几笔」都按时刻 t 现算,纯函数,离屏可测。
 */

/** 一个点:[x, y, t](画板逻辑坐标,t = 离开始讲的毫秒) */
export type Point = [number, number, number];

export interface Stroke {
  /** 颜色;'erase' 是橡皮 */
  c: string;
  /** 粗细(逻辑坐标) */
  w: number;
  pts: Point[];
  /** 撤销 / 清空的那一刻;没有 = 一直在 */
  gone?: number;
}

export interface Strokes {
  /** 画板的逻辑尺寸;点都在这个框里 */
  size: { w: number; h: number };
  strokes: Stroke[];
}

export const MAX_STROKES = 4000;
export const MAX_POINTS = 120_000;
const MAX_MS = 60 * 60_000;
const COLOR_RE = /^(#[0-9a-f]{6}|erase)$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** 页面交来的笔迹:形状不对 → null(不修,整份拒) */
export function parseStrokes(v: unknown): Strokes | null {
  if (!isObj(v) || !isObj(v.size) || !Array.isArray(v.strokes)) return null;
  const { w, h } = v.size;
  if (!num(w, 50, 10_000) || !num(h, 50, 10_000) || v.strokes.length > MAX_STROKES) return null;
  const strokes: Stroke[] = [];
  let total = 0;
  for (const s of v.strokes as unknown[]) {
    if (!isObj(s) || typeof s.c !== 'string' || !COLOR_RE.test(s.c) || !num(s.w, 0.5, 200) || !Array.isArray(s.pts) || s.pts.length === 0) return null;
    total += s.pts.length;
    if (total > MAX_POINTS) return null;
    const pts: Point[] = [];
    for (const p of s.pts as unknown[]) {
      if (!Array.isArray(p) || p.length !== 3 || !num(p[0], -w, 2 * w) || !num(p[1], -h, 2 * h) || !num(p[2], 0, MAX_MS)) return null;
      pts.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2])]);
    }
    const gone = s.gone === undefined ? undefined : num(s.gone, 0, MAX_MS) ? Math.round(s.gone) : null;
    if (gone === null) return null;
    strokes.push({ c: s.c, w: s.w, pts, ...(gone !== undefined ? { gone } : {}) });
  }
  return { size: { w: Math.round(w), h: Math.round(h) }, strokes };
}

/** t 那一刻画面上的笔:已经落下、还没被撤销;正在画的那一笔只到 t 为止的点 */
export function visibleAt(s: Strokes, t: number): Stroke[] {
  const out: Stroke[] = [];
  for (const k of s.strokes) {
    if (k.pts[0][2] > t) continue;
    if (k.gone !== undefined && k.gone <= t) continue;
    const last = k.pts[k.pts.length - 1][2];
    out.push(last <= t ? k : { ...k, pts: k.pts.filter((p) => p[2] <= t) });
  }
  return out;
}

/** [from, to) 里落笔的笔数(橡皮另算) */
export function strokesIn(s: Strokes, from: number, to: number): { ink: number; erase: number } {
  let ink = 0;
  let erase = 0;
  for (const k of s.strokes) {
    const t0 = k.pts[0][2];
    if (t0 < from || t0 >= to) continue;
    if (k.c === 'erase') erase++;
    else ink++;
  }
  return { ink, erase };
}

/** 最后一个点的时刻(没有笔 = 0) */
export function lastInkMs(s: Strokes): number {
  let m = 0;
  for (const k of s.strokes) m = Math.max(m, k.pts[k.pts.length - 1][2], k.gone ?? 0);
  return m;
}

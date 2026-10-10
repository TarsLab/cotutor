/**
 * 听写的比对(《wip/听写设想.md》):孩子在田字格里写的每一笔,对 hanzi-writer-data 的中线(medians),判这个字写没写全、先后对不对、占格偏不偏。
 * 一笔像不像一笔照搬 hanzi-writer 3.7.2 的 strokeMatches(MIT,Copyright (c) 2014 David Chanin):均距、起止点、方向、Fréchet 形状、长度五项;
 * 它是描红时一笔一笔现判(知道该写第几笔),听写是写完了一起判,所以这里另做一步配对:每一笔对每一笔都试,按均距从近到远一对一配上。
 * 坐标同 hanzi-writer:1024 见方、y 向上(页面上 y = 900 − 屏幕 y)。纯函数,离屏可测。
 */

export interface Pt {
  x: number;
  y: number;
}

/** 孩子写的一笔:[x, y, t](t 毫秒,只用来回放,比对不看) */
export type InkPoint = [number, number, number];

// ---- 照搬 hanzi-writer 的几何 ----

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mag = (p: Pt): number => Math.sqrt(p.x * p.x + p.y * p.y);
const dist = (a: Pt, b: Pt): number => mag(sub(a, b));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const last = <T>(xs: T[]): T => xs[xs.length - 1];

function polyLength(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i], pts[i - 1]);
  return n;
}

const cosine = (a: Pt, b: Pt): number => (a.x * b.x + a.y * b.y) / mag(a) / mag(b);

/** p1、p2 连线上、过 p2 再走 d 的点 */
function extend(p1: Pt, p2: Pt, d: number): Pt {
  const v = sub(p2, p1);
  const k = d / mag(v);
  return { x: p2.x + k * v.x, y: p2.y + k * v.y };
}

function frechet(c1: Pt[], c2: Pt[]): number {
  const long = c1.length >= c2.length ? c1 : c2;
  const short = c1.length >= c2.length ? c2 : c1;
  let prev: number[] = [];
  for (let i = 0; i < long.length; i++) {
    const cur: number[] = [];
    for (let j = 0; j < short.length; j++) {
      const d = dist(long[i], short[j]);
      if (i === 0 && j === 0) cur.push(d);
      else if (i > 0 && j === 0) cur.push(Math.max(prev[0], d));
      else if (i === 0) cur.push(Math.max(cur[j - 1], d));
      else cur.push(Math.max(Math.min(prev[j], prev[j - 1], cur[j - 1]), d));
    }
    prev = cur;
  }
  return prev[short.length - 1];
}

function subdivide(curve: Pt[], maxLen = 0.05): Pt[] {
  const out = curve.slice(0, 1);
  for (const p of curve.slice(1)) {
    const q = last(out);
    const len = dist(p, q);
    if (len > maxLen) {
      const n = Math.ceil(len / maxLen);
      const step = len / n;
      for (let i = 0; i < n; i++) out.push(extend(p, q, -1 * step * (i + 1)));
    } else out.push(p);
  }
  return out;
}

/** 沿曲线等距取 n 个点 */
function outline(curve: Pt[], n = 30): Pt[] {
  const seg = polyLength(curve) / (n - 1);
  const out = [curve[0]];
  const end = last(curve);
  const rest = curve.slice(1);
  for (let i = 0; i < n - 2; i++) {
    let p = last(out);
    let remain = seg;
    for (;;) {
      if (!rest.length) break;
      const d = dist(p, rest[0]);
      if (d < remain) {
        remain -= d;
        p = rest.shift()!;
      } else {
        out.push(extend(p, rest[0], remain - d));
        break;
      }
    }
    if (!rest.length) break;
  }
  out.push(end);
  return out;
}

function normalize(curve: Pt[]): Pt[] {
  const o = outline(curve);
  const m = { x: mean(o.map((p) => p.x)), y: mean(o.map((p) => p.y)) };
  const t = o.map((p) => sub(p, m));
  const scale = Math.sqrt(mean([t[0].x ** 2 + t[0].y ** 2, last(t).x ** 2 + last(t).y ** 2])) || 1;
  return subdivide(t.map((p) => ({ x: p.x / scale, y: p.y / scale })));
}

const rotate = (curve: Pt[], th: number): Pt[] => curve.map((p) => ({ x: Math.cos(th) * p.x - Math.sin(th) * p.y, y: Math.sin(th) * p.x + Math.cos(th) * p.y }));

const COSINE_SIMILARITY_THRESHOLD = 0;
const START_AND_END_DIST_THRESHOLD = 250;
const FRECHET_THRESHOLD = 0.4;
const MIN_LEN_THRESHOLD = 0.35;
const SHAPE_FIT_ROTATIONS = [Math.PI / 16, Math.PI / 32, 0, (-1 * Math.PI) / 32, (-1 * Math.PI) / 16];
/**
 * 均距的门槛:hanzi-writer 缺省 350,第二笔起(描红时字的位置已经有了)× 0.5。
 * 听写没有描的字,但比对前字已经对齐过(fitTo),所以每一笔都用 × 0.5 那一档。
 */
const AVG_DIST_THRESHOLD = 350 * 0.5;

function shapeFit(a: Pt[], b: Pt[], leniency: number): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  let min = Infinity;
  for (const th of SHAPE_FIT_ROTATIONS) min = Math.min(min, frechet(na, rotate(nb, th)));
  return min <= FRECHET_THRESHOLD * leniency;
}

function directionMatches(points: Pt[], median: Pt[]): boolean {
  const edges: Pt[] = [];
  for (let i = 1; i < points.length; i++) edges.push(sub(points[i], points[i - 1]));
  const vecs: Pt[] = [];
  for (let i = 1; i < median.length; i++) vecs.push(sub(median[i], median[i - 1]));
  const sims = edges.map((e) => Math.max(...vecs.map((v) => cosine(v, e))));
  return mean(sims) > COSINE_SIMILARITY_THRESHOLD;
}

const avgDistance = (points: Pt[], median: Pt[]): number => mean(points.map((p) => Math.min(...median.map((m) => dist(m, p)))));

function dedupe(points: Pt[]): Pt[] {
  const out = points.slice(0, 1);
  for (const p of points.slice(1)) if (p.x !== last(out).x || p.y !== last(out).y) out.push(p);
  return out;
}

export interface StrokeFit {
  isMatch: boolean;
  avgDist: number;
  /** 正着不像、倒着像:这一笔写反了方向 */
  backwards: boolean;
}

/** 孩子的一笔像不像标准的这一笔(hanzi-writer 的 getMatchData,门槛见 AVG_DIST_THRESHOLD) */
export function strokeFit(raw: Pt[], median: Pt[], leniency = 1, checkBackwards = true): StrokeFit {
  const points = dedupe(raw);
  if (points.length < 2 || median.length < 2) return { isMatch: false, avgDist: Infinity, backwards: false };
  const avgDist = avgDistance(points, median);
  if (avgDist > AVG_DIST_THRESHOLD * leniency) return { isMatch: false, avgDist, backwards: false };
  const isMatch =
    dist(median[0], points[0]) <= START_AND_END_DIST_THRESHOLD * leniency &&
    dist(last(median), last(points)) <= START_AND_END_DIST_THRESHOLD * leniency &&
    directionMatches(points, median) &&
    shapeFit(points, median, leniency) &&
    (leniency * (polyLength(points) + 25)) / (polyLength(median) + 25) >= MIN_LEN_THRESHOLD;
  if (!isMatch && checkBackwards && strokeFit([...points].reverse(), median, leniency, false).isMatch) return { isMatch: false, avgDist, backwards: true };
  return { isMatch, avgDist, backwards: false };
}

// ---- 听写:一个字写完了一起判 ----

interface Box {
  cx: number;
  cy: number;
  size: number;
}

function boxOf(strokes: Pt[][]): Box | null {
  const all = strokes.flat();
  if (!all.length) return null;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0, 1) };
}

/** 把孩子的字等比挪到标准字的框里(写偏了、写小了也照样能比笔画) */
function fitTo(strokes: Pt[][], from: Box, to: Box): Pt[][] {
  const k = to.size / from.size;
  return strokes.map((s) => s.map((p) => ({ x: (p.x - from.cx) * k + to.cx, y: (p.y - from.cy) * k + to.cy })));
}

interface Pairing {
  /** 孩子的第 k 笔配上了标准的第几笔;没配上 null */
  matched: (number | null)[];
  backwards: number[];
  dist: number;
}

/** 第二遍放宽多少:点、短撇这种短笔手一抖形状就差得远,第一遍剩下的笔两两再试一次 */
export const SECOND_PASS_LENIENCY = 1.5;

/**
 * 每一笔对每一笔都试,像的按均距从近到远一对一配上;倒着写像的也算配上,记在 backwards。
 * 第一遍剩下的(孩子的、标准的都没配上的)再放宽到 SECOND_PASS_LENIENCY 配一遍。
 */
function pair(kid: Pt[][], medians: Pt[][], leniency: number): Pairing {
  const matched: (number | null)[] = kid.map(() => null);
  const used = new Set<number>();
  const backwards: number[] = [];
  let total = 0;
  for (const len of [leniency, leniency * SECOND_PASS_LENIENCY]) {
    const cand: { k: number; s: number; d: number; back: boolean }[] = [];
    kid.forEach((pts, k) => {
      if (matched[k] !== null) return;
      medians.forEach((m, s) => {
        if (used.has(s)) return;
        const f = strokeFit(pts, m, len);
        if (f.isMatch || f.backwards) cand.push({ k, s, d: f.avgDist, back: f.backwards });
      });
    });
    cand.sort((a, b) => a.d - b.d);
    for (const c of cand) {
      if (matched[c.k] !== null || used.has(c.s)) continue;
      matched[c.k] = c.s;
      used.add(c.s);
      total += c.d;
      if (c.back) backwards.push(c.s);
    }
  }
  return { matched, backwards: backwards.sort((a, b) => a - b), dist: total };
}

export interface CharJudge {
  /** 数据里有这个字、判过了;没有(生僻字)= false,别的字段都是空的 */
  judged: boolean;
  /** 一笔没写 */
  empty: boolean;
  /** 标准几笔、孩子写了几笔 */
  std: number;
  wrote: number;
  /** 孩子的第 k 笔是标准的第几笔(0 起);对不上 null */
  matched: (number | null)[];
  /** 标准里没配上的笔(0 起):少写的,或写得认不出的 */
  missing: number[];
  /** 孩子写的、哪一笔都对不上的(0 起) */
  extra: number[];
  /** 配上的笔,先后和书上一样 */
  order: boolean;
  /** 写反了方向的笔(标准的,0 起) */
  backwards: number[];
  /** 占格:孩子的字相对书上的,size = 大小之比,dx / dy = 中心偏多少(1024 见方,y 向上) */
  place: { size: number; dx: number; dy: number } | null;
  /** 孩子端问不问「这个再写一遍?」:空着、少笔、多笔、有一笔对不上(2026-10-10 拍板) */
  ask: boolean;
}

export const EMPTY_JUDGE: Omit<CharJudge, 'judged' | 'ask' | 'std'> = { empty: true, wrote: 0, matched: [], missing: [], extra: [], order: true, backwards: [], place: null };

/**
 * 判一个字:先原样比,再把孩子的字挪进标准字的框里比,取配上更多的那次。
 * medians 是 hanzi-writer-data 的(null = 数据里没有,不判)。
 */
export function judgeChar(ink: InkPoint[][], medians: number[][][] | null, leniency = 1): CharJudge {
  const kid = ink.map((s) => s.map(([x, y]) => ({ x, y }))).filter((s) => s.length > 0);
  if (!medians) return { judged: false, ask: false, std: 0, ...EMPTY_JUDGE, empty: kid.length === 0, wrote: kid.length };
  const std = medians.map((m) => m.map(([x, y]) => ({ x, y })));
  if (!kid.length) return { judged: true, ask: true, std: std.length, ...EMPTY_JUDGE, missing: std.map((_, i) => i) };
  const kb = boxOf(kid)!;
  const sb = boxOf(std)!;
  const raw = pair(kid, std, leniency);
  const fitted = pair(fitTo(kid, kb, sb), std, leniency);
  const count = (p: Pairing): number => p.matched.filter((x) => x !== null).length;
  const best = count(fitted) > count(raw) || (count(fitted) === count(raw) && fitted.dist < raw.dist) ? fitted : raw;
  const hit = new Set(best.matched.filter((x): x is number => x !== null));
  const missing = std.map((_, i) => i).filter((i) => !hit.has(i));
  const extra = best.matched.map((m, k) => (m === null ? k : -1)).filter((k) => k >= 0);
  const seq = best.matched.filter((x): x is number => x !== null);
  const order = seq.every((s, i) => i === 0 || s > seq[i - 1]);
  return {
    judged: true,
    empty: false,
    std: std.length,
    wrote: kid.length,
    matched: best.matched,
    missing,
    extra,
    order,
    backwards: best.backwards,
    place: { size: round2(kb.size / sb.size), dx: Math.round(kb.cx - sb.cx), dy: Math.round(kb.cy - sb.cy) },
    ask: missing.length > 0 || extra.length > 0,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 占格:偏小 / 偏大 / 偏左上……;正常 → null(给家长的一句) */
export function placeNote(place: CharJudge['place']): string | null {
  if (!place) return null;
  const bits: string[] = [];
  if (place.size < 0.7) bits.push('偏小');
  else if (place.size > 1.3) bits.push('偏大');
  const v = place.dy > 140 ? '上' : place.dy < -140 ? '下' : '';
  const h = place.dx < -140 ? '左' : place.dx > 140 ? '右' : '';
  if (v || h) bits.push(`偏${h}${v}`);
  return bits.length ? bits.join('、') : null;
}

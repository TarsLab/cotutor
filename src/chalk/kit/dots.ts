/**
 * 点阵:几行圈圈,每行一样多。分一分(平均分)、几个几(乘法)都在它上面讲:东西画成圈圈,用线切开,数一份里有几个。
 * 老师写几行、每行几个、板上已经有哪几道线;孩子的操作是切(画一道线)、圈(绕几个圈圈画一圈)、涂(在一份里来回涂)。
 * 孩子画成什么样就是什么样,不归整。read 只按几何算个大概(几道线、大致分成几份、圈里大约几个),老师同时看图,以图为准。
 */

import { insidePolygon } from '../geometry.ts';
import type { ChalkSkeleton } from '../types.ts';
import type { Kit, KitScene } from './types.ts';

const STEP = 56;
const R = 17;
const X0 = 70;
const Y0 = 70;
/** 线比点阵两头各长出多少 */
const OVER = 34;
const INK = '#1e1e1e';
/** 老师的线:强调红(做课包定的用色,skills/chalk-teaching) */
const LINE = '#e03131';
const ROWS_MAX = 5;
const COLS_MAX = 12;

const int = (name: string, max: number) => (v: string): string => {
  const n = Number(v.replace(/[行个列]/g, '').trim());
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`点阵的「${name}」写 1 到 ${max} 的整数`);
  return String(n);
};

/** 「横 1、竖 3、竖 6」→「横1 竖3 竖6」:横 k = 第 k 行下面的一道,竖 k = 第 k 列右边的一道 */
function readLines(v: string): string {
  const out: string[] = [];
  for (const part of v.replace(/([横竖])\s+(\d)/g, '$1$2').split(/[、,,;;\s]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(横|竖)(\d+)$/.exec(part);
    if (!m) throw new Error('点阵的「线」这样写:横 1、竖 3(横 1 是第 1 行下面那道,竖 3 是第 3 列右边那道)');
    const s = `${m[1]}${Number(m[2])}`;
    if (!out.includes(s)) out.push(s);
  }
  return out.join(' ');
}

interface Grid { rows: number; cols: number; h: number[]; v: number[] }

function gridOf(p: Readonly<Record<string, string>>): Grid {
  const rows = Number(p['行']) || 2;
  const cols = Number(p['每行']) || 9;
  const lines = (p['线'] ?? '').split(' ').filter(Boolean);
  const pick = (kind: string, max: number): number[] => lines.filter((l) => l.startsWith(kind)).map((l) => Number(l.slice(1))).filter((k) => k >= 1 && k < max).sort((a, b) => a - b);
  return { rows, cols, h: pick('横', rows), v: pick('竖', cols) };
}

/** 第 k 行(列)后面那道缝的位置 */
const gapY = (k: number): number => Y0 + (k - 0.5) * STEP;
const gapX = (k: number): number => X0 + (k - 0.5) * STEP;

/** 一笔是什么:切(横 / 竖,在哪)、圈、涂、点、看不出 */
type Stroke = { kind: 'cut'; dir: '横' | '竖'; at: number } | { kind: 'circle'; n: number } | { kind: 'fill'; n: number } | { kind: 'tap'; row: number; col: number } | { kind: 'unknown' };

function classify(pts: readonly [number, number][], g: Grid): Stroke {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const centers: [number, number, number, number][] = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) centers.push([X0 + c * STEP, Y0 + r * STEP, r + 1, c + 1]);
  if (Math.max(w, h) < 14) {
    const hit = centers.map((c) => ({ c, d: Math.hypot(c[0] - xs[0], c[1] - ys[0]) })).sort((a, b) => a.d - b.d)[0];
    return hit && hit.d <= R + 12 ? { kind: 'tap', row: hit.c[2], col: hit.c[3] } : { kind: 'unknown' };
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const diag = Math.hypot(w, h);
  const spanW = (g.cols - 1) * STEP + 2 * R, spanH = (g.rows - 1) * STEP + 2 * R;
  // 大致是一道直线,又够长(过了点阵那个方向的一半):切
  if (len <= diag * 1.25) {
    if (w >= h * 2.2 && w >= spanW * 0.5) return { kind: 'cut', dir: '横', at: ys.reduce((a, b) => a + b, 0) / ys.length };
    if (h >= w * 2.2 && h >= spanH * 0.6) return { kind: 'cut', dir: '竖', at: xs.reduce((a, b) => a + b, 0) / xs.length };
  }
  // 来回涂:笔走的路比外框的对角线长得多
  if (len >= diag * 2.6) return { kind: 'fill', n: centers.filter((c) => c[0] >= minX - 4 && c[0] <= maxX + 4 && c[1] >= minY - 4 && c[1] <= maxY + 4).length };
  // 头尾接上了:圈
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= len * 0.3 && Math.min(w, h) >= Math.max(w, h) * 0.2) return { kind: 'circle', n: centers.filter((c) => insidePolygon(pts as [number, number][], [c[0], c[1]])).length };
  return { kind: 'unknown' };
}

/** 一组切口(位置)把 n 个等距的东西分成几段、各几个;压着圈的那道另记 */
function split(cuts: readonly number[], n: number, origin: number): { sizes: number[]; onDot: boolean } {
  const inside = cuts.filter((x) => x > origin - STEP / 2 && x < origin + (n - 0.5) * STEP).sort((a, b) => a - b);
  let onDot = false;
  const sizes: number[] = [];
  let prev = 0;
  for (const x of inside) {
    const before = Math.max(0, Math.min(n, Math.round((x - origin) / STEP + 0.5)));
    if (Math.abs((x - origin) / STEP - Math.round((x - origin) / STEP)) * STEP < R * 0.6) onDot = true;
    if (before > prev && before < n) { sizes.push(before - prev); prev = before; }
  }
  sizes.push(n - prev);
  return { sizes, onDot };
}

export const dots: Kit = {
  name: '点阵',
  about: '几行圈圈,每行一样多。把东西画成圈圈,孩子画线切开、圈一圈、涂一份,数一份里有几个。讲平均分、几个几。',
  ops: ['切', '圈', '涂'],
  params: [
    { key: '行', note: '几行。1 到 5,缺省 2。', read: int('行', ROWS_MAX), fallback: '2' },
    { key: '每行', note: '每行几个。1 到 12,缺省 9。', read: int('每行', COLS_MAX), fallback: '9' },
    { key: '线', note: '板上已经有的线,是你画的。写「横 1、竖 3」:横 1 是第 1 行下面那道,竖 3 是第 3 列右边那道。不写就没有线。', read: readLines, fallback: '' },
  ],
  shorthand(line) {
    const m = /^(\d+)\s*行\s*[,,、]?\s*(?:每行)?\s*(\d+)\s*个?$/.exec(line.trim());
    return m ? { 行: m[1], 每行: m[2] } : null;
  },
  build(p): KitScene {
    const g = gridOf(p);
    const sk: ChalkSkeleton[] = [];
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) sk.push({ type: 'ellipse', id: `dot-${r + 1}-${c + 1}`, x: X0 + c * STEP - R, y: Y0 + r * STEP - R, width: R * 2, height: R * 2, strokeColor: INK, strokeWidth: 2, animateDuration: Math.max(60, Math.round(1600 / (g.rows * g.cols))) });
    }
    const x1 = X0 - OVER, x2 = X0 + (g.cols - 1) * STEP + OVER, y1 = Y0 - OVER, y2 = Y0 + (g.rows - 1) * STEP + OVER;
    for (const k of g.h) sk.push({ type: 'line', id: `cut-h-${k}`, label: '横着的线', x: x1, y: gapY(k), points: [[0, 0], [x2 - x1, 0]], strokeColor: LINE, strokeWidth: 2, animateDuration: 500 });
    for (const k of g.v) sk.push({ type: 'line', id: `cut-v-${k}`, label: '竖着的线', x: gapX(k), y: y1, points: [[0, 0], [0, y2 - y1]], strokeColor: LINE, strokeWidth: 2, animateDuration: 400 });
    // 画框固定留出线的位置:这一张没有线、下一张添了线,圈圈不挪地方
    return { skeletons: sk, groups: [], turns: [], frame: [x1 - 16, y1 - 16, x2 - x1 + 32, y2 - y1 + 32] };
  },
  read(p, state) {
    const g = gridOf(p);
    const strokes = (state.marks ?? []).filter((s) => s.length).map((s) => classify(s, g));
    if (!strokes.length) return '还没画';
    const parts: string[] = [];
    const cuts = strokes.filter((s): s is Extract<Stroke, { kind: 'cut' }> => s.kind === 'cut');
    const kh = cuts.filter((c) => c.dir === '横').map((c) => c.at), kv = cuts.filter((c) => c.dir === '竖').map((c) => c.at);
    if (cuts.length) {
      parts.push(`画了${[kh.length ? ` ${kh.length} 道横线` : '', kv.length ? ` ${kv.length} 道竖线` : ''].filter(Boolean).join('、')}`);
      // 连同老师已经画的线一起算:行分几段、列分几段,每一份 = 行段 × 列段
      const rowCut = split([...g.h.map(gapY), ...kh], g.rows, Y0);
      const colCut = split([...g.v.map(gapX), ...kv], g.cols, X0);
      const sizes = rowCut.sizes.flatMap((a) => colCut.sizes.map((b) => a * b));
      const same = sizes.every((n) => n === sizes[0]);
      parts.push(`${g.h.length + g.v.length ? '连同板上原来的线,' : ''}大致分成 ${sizes.length} 份:${same ? `每份 ${sizes[0]} 个` : sizes.join('、')}`);
      if (rowCut.onDot || colCut.onDot) parts.push('有一道线压着圈圈,哪边的看图');
    }
    for (const s of strokes) {
      if (s.kind === 'circle') parts.push(`圈了一圈,里面大约 ${s.n} 个`);
      else if (s.kind === 'fill') parts.push(`涂了一块,盖住大约 ${s.n} 个`);
      else if (s.kind === 'tap') parts.push(`点了第 ${s.row} 行第 ${s.col} 个`);
    }
    const unknown = strokes.filter((s) => s.kind === 'unknown').length;
    if (unknown) parts.push(`有 ${unknown} 笔看不出是什么,看图`);
    return parts.join(';');
  },
};

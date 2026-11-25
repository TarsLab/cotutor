/**
 * 课本页上画的田字格:建索引时(src/memory/textbook-pdf.ts 的 readPdfPages)读每页画图的指令(pdf.js 的 getOperatorList),认出田字格和格里印的字。
 * 文字层(getTextContent)不带颜色,范字(黑)和描红(红)只能从画字的指令里分,所以这里自己跟着坐标变换、填充色、虚线走一遍。
 *
 * 认法(2026-11-22 拿人教统编语文二上全书核实:37 页 1056 格,一格不差;核实的脚本见 docs/dev/课本.md):
 *  田字格 = 一条描边的闭合四点路径、近似正方形(边长 18–75pt),里面横竖各有一条虚线穿过中心(中线)。
 *  格里的字 = 一个字的字形起点落在格里(字的中心在格里);填充色红的(r 比 g 高 60 以上)是描红。
 *  标点用的小方框没有中线,不算(第 41 页)。
 * 表格(2026-11-25 照 scripts/probe-book-zones.mjs 核过的搬来):实线的横线、竖线段(描边的,和细长的填充矩形)互相交着的一团,三条横线以上、三条竖线以上
 *  (或两条横线、四条竖线以上的一排)是表格;四边都有线的才算一格,合并的格不认,和田字格重了的不算。格里有没有字由建索引那层看文字层(textbook-index.ts)。
 * 小方框(打勾的 □):描边的闭合四点框、6–30pt、近似方的,填了颜色的(七巧板这种图)不算;里面没字、旁边贴着字的才是,也由建索引那层挑。
 * pdf.js 6 的 constructPath 参数是 [画法, [路径数据], 外框];路径数据里 0 起点、1 直线、2 三次曲线、3 二次曲线、4 闭合。
 */
import type { PdfCell, PdfTableCell } from '../schema/index.ts';

type Box = [number, number, number, number];
type Mat = [number, number, number, number, number, number];

/** 一条描边的路径:页面坐标(左上角起)的外框、是不是闭合的四点框、是不是虚线 */
export interface CellPath { box: Box; quad: boolean; dashed: boolean }
/** 画出来的一段字:字形起点(基线左端)、字号、填充色(#rrggbb) */
export interface CellGlyph { s: string; x: number; y: number; size: number; fill: string }

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** 红的(描红):r 比 g、b 都高 60 以上 */
function reddish(fill: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return r - g >= 60 && r - b >= 60;
}

/** 田字格以外描边的小方框(数学算式里的空从这里挑):10–60pt 宽、10–30pt 高,同一个描两遍的只留一个 */
export function findBoxes(paths: readonly CellPath[], cells: readonly PdfCell[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const p of paths) {
    if (!p.quad || p.dashed) continue;
    const [x1, y1, x2, y2] = p.box, w = x2 - x1, h = y2 - y1;
    if (w < 10 || w > 60 || h < 10 || h > 30) continue;
    if (cells.some((c) => Math.abs(c.x1 - x1) < 1.5 && Math.abs(c.y1 - y1) < 1.5)) continue;
    if (out.some((b) => b.every((v, i) => Math.abs(v - p.box[i]) < 1.5))) continue;
    out.push([r2(x1), r2(y1), r2(x2), r2(y2)]);
  }
  return out;
}

/** 从路径和字里认田字格(纯函数):从上到下、从左到右 */
export function findCells(paths: readonly CellPath[], glyphs: readonly CellGlyph[]): PdfCell[] {
  const dashes = paths.filter((p) => p.dashed && !p.quad);
  const squares = paths.filter((p) => {
    if (!p.quad || p.dashed) return false;
    const w = p.box[2] - p.box[0], h = p.box[3] - p.box[1];
    return w >= 18 && w <= 75 && Math.abs(w - h) < 1.5;
  });
  const cells: PdfCell[] = [];
  for (const sq of squares) {
    const [x1, y1, x2, y2] = sq.box, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const v = dashes.some((d) => d.box[2] - d.box[0] < 0.5 && Math.abs(d.box[0] - cx) < 1.5 && d.box[1] < y1 + 3 && d.box[3] > y2 - 3);
    const hz = dashes.some((d) => d.box[3] - d.box[1] < 0.5 && Math.abs(d.box[1] - cy) < 1.5 && d.box[0] < x1 + 3 && d.box[2] > x2 - 3);
    if (!v || !hz) continue;
    // 同一格描了两遍的只留一个
    if (cells.some((c) => Math.abs(c.x1 - x1) < 1 && Math.abs(c.y1 - y1) < 1)) continue;
    const g = glyphs.find((t) => {
      if (Array.from(t.s.trim()).length !== 1) return false;
      const gx = t.x + t.size / 2, gy = t.y - t.size * 0.4;
      return gx > x1 && gx < x2 && gy > y1 && gy < y2;
    });
    cells.push({ x1: r2(x1), y1: r2(y1), x2: r2(x2), y2: r2(y2), ...(g ? { ch: g.s.trim(), ...(reddish(g.fill) ? { red: true } : {}) } : {}) });
  }
  return cells.sort((a, b) => (Math.abs(a.y1 - b.y1) > 3 ? a.y1 - b.y1 : a.x1 - b.x1));
}

/** 一条实线:横线(y,从 a 到 b)或竖线(x,从 a 到 b) */
export interface Rule { at: number; a: number; b: number }

/** 同一条线上挨着、叠着的段并成一条 */
function mergeRules(rs: readonly Rule[]): Rule[] {
  const out: Rule[] = [];
  for (const r of [...rs].sort((p, q) => p.at - q.at || p.a - q.a)) {
    const m = out.find((o) => Math.abs(o.at - r.at) < 0.8 && r.a <= o.b + 2 && r.b >= o.a - 2);
    if (m) { m.a = Math.min(m.a, r.a); m.b = Math.max(m.b, r.b); } else out.push({ ...r });
  }
  return out;
}

const iou = (a: Box, b: Box): number => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
};
const clusterVals = (vs: readonly number[]): number[] => { const out: number[] = []; for (const v of [...vs].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > 1.5) out.push(v); return out; };

/** 横线 H、竖线 V 拼成的表格(纯函数):一张表一组格(r、c 从 0 起,照线排的第几行第几列);avoid 是田字格,重了的格不算 */
export function findTables(H: readonly Rule[], V: readonly Rule[], avoid: readonly Box[]): PdfTableCell[][] {
  const cross = (h: Rule, v: Rule): boolean => v.at >= h.a - 2 && v.at <= h.b + 2 && h.at >= v.a - 2 && h.at <= v.b + 2;
  const seenH = new Set<number>(), seenV = new Set<number>();
  const tables: PdfTableCell[][] = [];
  for (let i = 0; i < H.length; i++) {
    if (seenH.has(i)) continue;
    const hs = new Set<number>(), vs = new Set<number>(), todo: ['h' | 'v', number][] = [['h', i]];
    seenH.add(i);
    while (todo.length) {
      const [t, k] = todo.pop()!;
      if (t === 'h') { hs.add(k); V.forEach((v, j) => { if (!seenV.has(j) && cross(H[k], v)) { seenV.add(j); todo.push(['v', j]); } }); }
      else { vs.add(k); H.forEach((h, j) => { if (!seenH.has(j) && cross(h, V[k])) { seenH.add(j); todo.push(['h', j]); } }); }
    }
    const hh = [...hs].map((k) => H[k]), vv = [...vs].map((k) => V[k]);
    if (!((hh.length >= 3 && vv.length >= 3) || (hh.length >= 2 && vv.length >= 4))) continue;
    const ys = clusterVals(hh.map((h) => h.at)), xs = clusterVals(vv.map((v) => v.at));
    const cells: PdfTableCell[] = [];
    for (let r = 0; r + 1 < ys.length; r++) for (let c = 0; c + 1 < xs.length; c++) {
      const [x1, x2, y1, y2] = [xs[c], xs[c + 1], ys[r], ys[r + 1]];
      if (x2 - x1 < 8 || y2 - y1 < 8) continue;
      const hEdge = (y: number): boolean => hh.some((h) => Math.abs(h.at - y) < 1.5 && h.a <= x1 + 2 && h.b >= x2 - 2);
      const vEdge = (x: number): boolean => vv.some((v) => Math.abs(v.at - x) < 1.5 && v.a <= y1 + 2 && v.b >= y2 - 2);
      if (!(hEdge(y1) && hEdge(y2) && vEdge(x1) && vEdge(x2))) continue;
      const box: Box = [r2(x1), r2(y1), r2(x2), r2(y2)];
      if (avoid.some((b) => iou(box, b) > 0.4)) continue;
      cells.push({ r, c, box });
    }
    if (cells.length >= 2) tables.push(cells);
  }
  return tables;
}

const mul = (a: Mat, b: readonly number[]): Mat => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const at = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hexOf = (a: readonly unknown[]): string => (typeof a[0] === 'string' ? a[0] : `#${a.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`);

/**
 * pdf.js 一页的操作表(getOperatorList 的 fnArray、argsArray)走一遍,收描边的路径、实线、填色的块和画出来的字;view = 视口的变换(左上角起)。
 * 回田字格、别的小方框(填空从这里挑)、表格的格、没填颜色的方框(打勾的从这里挑)
 */
export function opsCells(ops: { fnArray: ArrayLike<number>; argsArray: readonly unknown[] }, OPS: Readonly<Record<string, number>>, view: readonly number[]): { cells: PdfCell[]; boxes: [number, number, number, number][]; tables: PdfTableCell[][]; squares: Box[] } {
  interface G { ctm: Mat; fill: string; dash: boolean }
  let g: G = { ctm: [...view] as Mat, fill: '#000000', dash: false };
  const stack: G[] = [];
  let tlm: Mat = [1, 0, 0, 1, 0, 0], tm: Mat = tlm, fs = 0;
  const paths: CellPath[] = [], glyphs: CellGlyph[] = [];
  const stroke = new Set([OPS.stroke, OPS.closeStroke]);
  // 表格的线:描了边的(连带填色又描边的)每一段直线;填出来的细长矩形也是线
  const lineOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fills = new Set([OPS.fill, OPS.eoFill]);
  const H: Rule[] = [], V: Rule[] = [], quads: Box[] = [], painted: Box[] = [];
  const seg = (p: [number, number], q: [number, number]): void => {
    if (Math.abs(p[1] - q[1]) < 0.6 && Math.abs(p[0] - q[0]) > 6) H.push({ at: (p[1] + q[1]) / 2, a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) });
    else if (Math.abs(p[0] - q[0]) < 0.6 && Math.abs(p[1] - q[1]) > 6) V.push({ at: (p[0] + q[0]) / 2, a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]) });
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = (ops.argsArray[i] ?? []) as unknown[];
    if (f === OPS.save) stack.push({ ...g });
    else if (f === OPS.restore) g = stack.pop() ?? g;
    else if (f === OPS.transform) g = { ...g, ctm: mul(g.ctm, a as number[]) };
    else if (f === OPS.paintFormXObjectBegin) { stack.push({ ...g }); const m = a[0] as ArrayLike<number> | null; if (m && m.length === 6) g = { ...g, ctm: mul(g.ctm, Array.from(m)) }; }
    else if (f === OPS.paintFormXObjectEnd) g = stack.pop() ?? g;
    else if (f === OPS.setFillRGBColor) g = { ...g, fill: hexOf(a) };
    else if (f === OPS.setDash) g = { ...g, dash: Array.isArray(a[0]) && (a[0] as unknown[]).length > 0 };
    else if (f === OPS.setFont) fs = Number(a[1]) || 0;
    else if (f === OPS.beginText) { tlm = [1, 0, 0, 1, 0, 0]; tm = tlm; }
    else if (f === OPS.setTextMatrix) { const m = (Array.isArray(a[0]) || ArrayBuffer.isView(a[0]) ? a[0] : a) as ArrayLike<number>; if (m.length === 6) { tlm = Array.from(m) as Mat; tm = tlm; } }
    else if (f === OPS.moveText || f === OPS.setLeadingMoveText) { tlm = mul(tlm, [1, 0, 0, 1, Number(a[0]) || 0, Number(a[1]) || 0]); tm = tlm; }
    else if (f === OPS.showText && Array.isArray(a[0])) {
      const s = (a[0] as ({ unicode?: string } | null | number)[]).map((c) => (c && typeof c === 'object' && c.unicode) || '').join('');
      if (!s.trim()) continue;
      const m = mul(g.ctm, tm), [x, y] = at(m, 0, 0);
      glyphs.push({ s, x, y, size: fs * Math.hypot(m[2], m[3]), fill: g.fill });
    } else if (f === OPS.constructPath) {
      const [op, data] = a as [number, unknown];
      const d = Array.isArray(data) ? (data[0] as ArrayLike<number> | undefined) : undefined;
      const isLine = lineOps.has(op), isFill = fills.has(op) || op === OPS.fillStroke || op === OPS.closeFillStroke;
      if (!d || (!isLine && !fills.has(op))) continue;
      const pts: [number, number][] = [], straight: [number, number][] = [];
      let code = '';
      let start: [number, number] | null = null, prev: [number, number] | null = null;
      for (let j = 0; j < d.length;) {
        const c = d[j++];
        code += c;
        if (c === 0) { prev = start = at(g.ctm, d[j], d[j + 1]); j += 2; pts.push(prev); straight.push(prev); }
        else if (c === 1) { const q = at(g.ctm, d[j], d[j + 1]); j += 2; if (isLine && !g.dash && prev) seg(prev, q); prev = q; pts.push(q); straight.push(q); }
        else if (c === 2) { prev = at(g.ctm, d[j + 4], d[j + 5]); j += 6; pts.push(prev); }
        else if (c === 3) { prev = at(g.ctm, d[j + 2], d[j + 3]); j += 4; pts.push(prev); }
        else if (c === 4) { if (isLine && !g.dash && prev && start) seg(prev, start); prev = start; }
      }
      if (!pts.length) continue;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const quad = /^0111(1|4|14)?$/.test(code);
      // 田字格、填空的小方框只看单纯描边的、只算直线的点(同 2026-11-22 核实的那样)
      if (stroke.has(op) && straight.length) {
        const sx = straight.map((p) => p[0]), sy = straight.map((p) => p[1]);
        paths.push({ box: [Math.min(...sx), Math.min(...sy), Math.max(...sx), Math.max(...sy)], quad, dashed: g.dash });
      }
      if (isLine && !g.dash && quad) quads.push(box);
      if (isFill && pts.length >= 3 && !/^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/i.test(g.fill)) painted.push(box);
      if (fills.has(op) && pts.length >= 4) {
        if (box[3] - box[1] < 1.6 && box[2] - box[0] > 6) H.push({ at: (box[1] + box[3]) / 2, a: box[0], b: box[2] });
        else if (box[2] - box[0] < 1.6 && box[3] - box[1] > 6) V.push({ at: (box[0] + box[2]) / 2, a: box[1], b: box[3] });
      }
    }
  }
  const cells = findCells(paths, glyphs);
  const tian: Box[] = cells.map((c) => [c.x1, c.y1, c.x2, c.y2]);
  // 填了颜色的方块(七巧板)是图,不是让孩子打勾的框;6–30pt、近似方的才留
  const squares: Box[] = [];
  for (const q of quads) {
    const w = q[2] - q[0], h = q[3] - q[1];
    if (w < 6 || w > 30 || h < 6 || h > 30 || Math.abs(w - h) > 0.35 * Math.max(w, h)) continue;
    if (painted.some((b) => iou(q, b) > 0.8) || squares.some((b) => iou(q, b) > 0.8)) continue;
    squares.push([r2(q[0]), r2(q[1]), r2(q[2]), r2(q[3])]);
  }
  return { cells, boxes: findBoxes(paths, cells), tables: findTables(mergeRules(H), mergeRules(V), tian), squares };
}

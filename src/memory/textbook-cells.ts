/**
 * 课本页上画的田字格:建索引时(src/memory/textbook-pdf.ts 的 readPdfPages)读每页画图的指令(pdf.js 的 getOperatorList),认出田字格和格里印的字。
 * 文字层(getTextContent)不带颜色,范字(黑)和描红(红)只能从画字的指令里分,所以这里自己跟着坐标变换、填充色、虚线走一遍。
 *
 * 认法(docs/artifact/页上记号/规范.html 的 V1,2026-11-22 拿人教统编语文二上全书核实:37 页 1056 格,一格不差):
 *  田字格 = 一条描边的闭合四点路径、近似正方形(边长 18–75pt),里面横竖各有一条虚线穿过中心(中线)。
 *  格里的字 = 一个字的字形起点落在格里(字的中心在格里);填充色红的(r 比 g 高 60 以上)是描红。
 *  标点用的小方框没有中线,不算(第 41 页)。
 * pdf.js 6 的 constructPath 参数是 [画法, [路径数据], 外框];路径数据里 0 起点、1 直线、2 三次曲线、3 二次曲线、4 闭合。
 */
import type { PdfCell } from '../schema/index.ts';

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

const mul = (a: Mat, b: readonly number[]): Mat => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const at = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hexOf = (a: readonly unknown[]): string => (typeof a[0] === 'string' ? a[0] : `#${a.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`);

/** pdf.js 一页的操作表(getOperatorList 的 fnArray、argsArray)走一遍,收描边的路径和画出来的字;view = 视口的变换(左上角起)。回田字格和别的小方框 */
export function opsCells(ops: { fnArray: ArrayLike<number>; argsArray: readonly unknown[] }, OPS: Readonly<Record<string, number>>, view: readonly number[]): { cells: PdfCell[]; boxes: [number, number, number, number][] } {
  interface G { ctm: Mat; fill: string; dash: boolean }
  let g: G = { ctm: [...view] as Mat, fill: '#000000', dash: false };
  const stack: G[] = [];
  let tlm: Mat = [1, 0, 0, 1, 0, 0], tm: Mat = tlm, fs = 0;
  const paths: CellPath[] = [], glyphs: CellGlyph[] = [];
  const stroke = new Set([OPS.stroke, OPS.closeStroke]);
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
      if (!stroke.has(op) || !d) continue;
      const pts: [number, number][] = [];
      let code = '';
      for (let j = 0; j < d.length;) {
        const c = d[j++];
        code += c;
        if (c === 0 || c === 1) { pts.push(at(g.ctm, d[j], d[j + 1])); j += 2; } else if (c === 2) j += 6; else if (c === 3) j += 4;
      }
      if (!pts.length) continue;
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      paths.push({ box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], quad: /^0111(1|4|14)?$/.test(code), dashed: g.dash });
    }
  }
  const cells = findCells(paths, glyphs);
  return { cells, boxes: findBoxes(paths, cells) };
}

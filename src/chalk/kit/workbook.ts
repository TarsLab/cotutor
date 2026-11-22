/**
 * 练习册的一页(src/schema/workbook.ts)换成课本的样子:行与字、题(problem 块)、能写的格子(BookCell),
 * 这样练习册页和课本页、照片页用同一份找框(看、圈)、点字、说窗里是哪、写字格。
 * 一页当一张照片排:宽 1000(BOOK_W)、高 1000 × 页图的高宽比,几页从上往下连着;workbook.json 的千分比框横的照用、竖的乘高宽比。
 * 文字层和题框是排版时记下的,不用认;「写」的作答区就是能点开写的格子:田字格是空格(empty,照着 model 写),别的是填空(blank)。
 * 给老师的那份(workbookText)带题面、印着的字、练什么、卡住怎么引、答案;只进上下文包的 <page>,孩子端拿不到。
 * 孩子直接用笔在页上圈、画、写的(workbookInk):照作答区说成几句给老师——圈的一圈围住了哪几个(压着圈线的另说),画的框里有几个合拢的形状,
 * 写的那一格几笔;合没合拢、算不算围住只是大概(2026-11-20 样题上核过:每排圈一圈各围住 4 个,圈到边上的、没合拢的说拿不准),写成什么样还是看图。
 */
import type { BookCell, BookPage, PageSource, Workbook, WorkbookPage, WorkbookQuestion, WorkbookRegion } from '../../schema/index.ts';
import { insidePolygon } from '../geometry.ts';
import { bookSheets, type BookBlock } from './book.ts';
import { photoBookPage } from './photo.ts';

type Box = [number, number, number, number];
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** 一节课里练习册那一页的 id */
export const workbookPageId = (name: string): string => `练习册#${name}`;

/** 一册铺成一节课的一页(几页从上往下连着);pick = 能不能点字看笔顺(数学的不弹,同课本) */
export function workbookPage(name: string, wb: Pick<Workbook, 'title' | 'pages'>, pick: boolean): Extract<PageSource, { kind: 'workbook' }> {
  return { id: workbookPageId(name), kind: 'workbook', src: name, title: wb.title, sheets: wb.pages.map((p) => ({ w: 1000, h: r1((1000 * p.image.h) / p.image.w) })), pick };
}

/** 一页上能写的作答区(格子的先后 = BookPage.cells 的先后,一节课状态里 kid.cells 的键 <页>.<第几格> 照它) */
export const workbookWriteRegions = (page: WorkbookPage): { q: WorkbookQuestion; id: string }[] =>
  page.questions.flatMap((q) => q.regions.filter((r) => r.kind === 'write').map((r) => ({ q, id: r.id })));

/** 第 n 页(从 1 起)的文字层、题与能写的格子 */
export function workbookBookPage(n: number, page: WorkbookPage): { page: BookPage; blocks: BookBlock[] } {
  const k = page.image.h / page.image.w;
  const { page: bp, blocks } = photoBookPage(n, page.image, {
    items: page.terms.map((t) => ({ text: t.text, box: t.box })),
    lines: page.lines,
    questions: page.questions.map((q) => ({ no: q.no, box: q.box })),
  });
  const cells: BookCell[] = page.questions.flatMap((q) => q.regions.filter((r) => r.kind === 'write').map((r): BookCell => ({
    x1: r.box[0], y1: r1(r.box[1] * k), x2: r.box[2], y2: r1(r.box[3] * k),
    kind: r.tian ? 'empty' : 'blank',
    ...(r.model ? { m: r.model.glyph } : {}),
  })));
  return { page: cells.length ? { ...bp, cells } : bp, blocks };
}

const inBox = (b: Box, q: Box): boolean => {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  return cx >= q[0] && cx <= q[2] && cy >= q[1] && cy <= q[3];
};

/**
 * 给老师的一页(进 <page>):每道题一段——题号和题面、印着的别的字、练什么、卡住怎么引、答案(哪几格:几种都算对的写法 / 连线 / 怎么看)。
 * 答案只给老师参考:孩子端不判对错,老师也不念出来
 */
export function workbookText(page: WorkbookPage): string[] {
  const out: string[] = [];
  for (const q of page.questions) {
    out.push(`第${q.no}题 ${q.prompt}`);
    const printed = page.lines.filter((l) => inBox(l.box, q.box) && !q.prompt.includes(l.text)).map((l) => l.text);
    if (printed.length) out.push(`  印着:${printed.join(' / ')}`);
    out.push(`  练什么:${q.teacher.goal}`);
    if (q.teacher.hint) out.push(`  卡住了:${q.teacher.hint}`);
    const label = (ids: readonly string[]): string => ids.map((id) => q.regions.find((r) => r.id === id)?.label ?? id).join('、');
    const thing = (id: string): string => q.objects.find((o) => o.id === id)?.label ?? id;
    for (const a of q.teacher.answers) {
      const what = [
        ...(a.ok ? [a.ok.join(' 或 ')] : []),
        ...(a.links ? [a.links.map(([l, r]) => `${thing(l)}—${thing(r)}`).join('、')] : []),
        ...(a.note ? [a.note] : []),
      ].join(';');
      out.push(`  答案 ${label(a.at)}:${what}`);
    }
  }
  return out;
}

type Pt = [number, number];

/** 一笔合拢了没有(圈、画的圆):够大,起笔收笔挨得近 */
function closed(pts: readonly Pt[]): boolean {
  if (pts.length < 5) return false;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const [x1, y1] = pts[0]!, [x2, y2] = pts[pts.length - 1]!;
  return Math.min(w, h) >= 12 && Math.hypot(x2 - x1, y2 - y1) <= Math.min(Math.max(w, h) * 0.15, 40);
}

const within = (p: Pt, b: Box): boolean => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

/**
 * 孩子在练习册这一页(sheets = 一节课里那一页的宽高)上的笔(场景坐标)照作答区说成几句;没落在哪个作答区的数一句。
 * 写在格子里的(写字格,放好的)不在这里,「孩子做的」另说
 */
export function workbookInk(wb: Pick<Workbook, 'pages'>, sheets: readonly { w: number; h: number }[], ink: readonly (readonly Pt[])[]): string[] {
  const placed = bookSheets(sheets.map((s, i) => ({ n: i + 1, w: s.w, h: s.h })));
  /** 页上的千分比框 → 场景 */
  const scene = (n: number, b: readonly number[], k: number): Box => { const top = placed[n - 1]?.top ?? 0; return [b[0]!, top + b[1]! * k, b[2]!, top + b[3]! * k]; };
  const regions = wb.pages.flatMap((pg, i) => {
    const k = pg.image.h / pg.image.w;
    return pg.questions.flatMap((q) => q.regions.map((r) => ({ q, r, box: scene(i + 1, r.box, k), objects: q.objects.filter((o) => o.region === r.id).map((o) => ({ label: o.label, box: scene(i + 1, o.box, k), c: [o.center[0], (placed[i]?.top ?? 0) + o.center[1] * k] as Pt })) })));
  });
  type Got = { q: WorkbookQuestion; r: WorkbookRegion; rings: { in: number; edge: number; what: string }[]; shapes: number; open: number; strokes: number };
  const got = new Map<string, Got>();
  let loose = 0;
  for (const st of ink) {
    if (!st.length) continue;
    const hit = regions.find((x) => st.filter((p) => within(p, x.box)).length / st.length >= 0.75);
    if (!hit) { loose++; continue; }
    const g = got.get(hit.r.id) ?? { q: hit.q, r: hit.r, rings: [], shapes: 0, open: 0, strokes: 0 };
    got.set(hit.r.id, g);
    g.strokes++;
    if (hit.r.kind === 'circle' && closed(st)) {
      let n = 0, edge = 0;
      for (const o of hit.objects) {
        const dx = (o.box[2] - o.box[0]) * 0.3, dy = (o.box[3] - o.box[1]) * 0.3;
        const hits = [o.c, [o.c[0] - dx, o.c[1]], [o.c[0] + dx, o.c[1]], [o.c[0], o.c[1] - dy], [o.c[0], o.c[1] + dy]].map((p) => insidePolygon(st as Pt[], p as Pt));
        if (hits.every(Boolean)) n++; else if (hits.some(Boolean)) edge++;
      }
      g.rings.push({ in: n, edge, what: hit.objects[0]?.label ?? '' });
    } else if (hit.r.kind === 'circle' || hit.r.kind === 'draw') {
      if (closed(st)) g.shapes++; else g.open++;
    }
  }
  const out: string[] = [];
  for (const g of got.values()) {
    const at = `第${g.q.no}题「${g.r.label}」`;
    if (g.rings.length) {
      const objs = g.rings.some((x) => x.what);
      const edge = g.rings.reduce((n, x) => n + x.edge, 0);
      out.push(`${at}圈了 ${g.rings.length} 圈${objs ? `,各围住 ${g.rings.map((x) => x.in).join('、')} 个${g.rings[0]!.what}` : ''}${edge ? `(另有 ${edge} 个压着圈线)` : ''}${g.open ? `;还有 ${g.open} 笔没合拢` : ''}`);
    } else if (g.r.kind === 'draw') out.push(`${at}画了 ${g.shapes} 个合拢的形状${g.open ? `,还有 ${g.open} 笔没合拢` : ''}(画的什么看图)`);
    else out.push(`${at}写画了 ${g.strokes} 笔(写的什么看图)`);
  }
  if (loose) out.push(`还有 ${loose} 笔不在哪道题的作答区里(看图)`);
  return out.slice(0, 8);
}

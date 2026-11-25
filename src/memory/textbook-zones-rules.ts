/**
 * 规则出分块(docs/dev/课本.md 的「分块」):不用大模型,照课本 PDF 的文字层与画的格把每页分成块,写成分块文件(src/schema/zones.ts 的形状)。
 * 建索引后接着出(src/memory/textbook-zones.ts 的 ruleZones),存 `.cotutor/textbooks/zones/<指纹>/`,规则改了加 ZONES_RULES_VERSION 重出。
 * 运行时不调这里:读分块文件(src/chalk/kit/book.ts 的 zoneBlocks)。
 *
 * 按课出(ruleZones 怎么分组):数学一个单元一组,语文、科学目录上最里一层的一课一组;段号、例题号一组里连着数,跨页的同一块两页上用同一个 id。
 * 一课里的块(RuleBlock)照下面三种分法(语文 prose、数学 math、科学 science),再换成一页一份的树:栏目下面记着它的题、段(head)的成它的小块;
 * 每块记下它那几行字的框(rows,照读的先后),读回来照框对上索引里的行,和这里分的一行不差。
 * 页上画的格(索引的 BookPage.cells)成作答区,id 是它在这一页的第几格(一节课状态里 kid.cells 的键 `<页>.<第几格>` 照旧),挂在框住它中心的最里面那块上,没有就挂在页上。
 */
import { MATH_COLUMNS, bodySize, bookChrome, mathHeading, scienceColumn, withPinyin, type BookIndex, type BookLayout, type BookLine, type BookPage, type PermilleBox, type Zone, type ZonePage, type ZoneRegion } from '../schema/index.ts';

/**
 * 一课里的一块:标题、一段(no 从 1 起)、一个栏目(head)、别的(认字栏、写字栏、课后题、注释)。
 * 数学(layout: math):标题(单元、小节、课题)、例题(example,no 是例几)、栏目(做一做、练一练,section)、栏目下面的一道题(problem,no 是题号,head 是哪个栏目)
 * 科学(layout: science):标题、栏目(探索与实践 1,section)、栏目下面的段(para,段号整课连着数)和别的字(other);段和别的字的 head 是它在哪个栏目下
 * text 只在这里分块时用;分块文件不存字,读回来照行重拼(src/chalk/kit/book.ts 的 zoneBlocks)
 */
export interface RuleBlock {
  kind: 'title' | 'para' | 'section' | 'other' | 'example' | 'problem';
  no?: number;
  head?: string;
  text: string;
  /** 哪几行:页号 + 那一页的第几行(照读的先后) */
  refs: { n: number; i: number }[];
}


// ——— 换成分块文件 ———

/** 一行在这一页上的框(千分比,一位小数) */
const r1 = (n: number): number => Math.round(n * 10) / 10;
export const linePermille = (p: BookPage, l: { x1: number; y1: number; x2: number; y2: number }): PermilleBox =>
  [r1(Math.max(0, (l.x1 / p.w) * 1000)), r1(Math.max(0, (l.y1 / p.h) * 1000)), r1(Math.min(1000, (l.x2 / p.w) * 1000)), r1(Math.min(1000, (l.y2 / p.h) * 1000))];
const union = (bs: readonly PermilleBox[]): PermilleBox | null => (bs.length ? [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] : null);
const clip = (t: string, n: number): string => { const cs = Array.from(t.replace(/\s+/g, ' ').trim()); return cs.length > n ? `${cs.slice(0, n).join('')}…` : cs.join(''); };

/** 老师怎么叫它(docs/dev/课本.md 的叫法):第 3 段、例 2、练一练第 3 题、栏目名;标题、别的字是开头那几个字 */
function ruleLabel(b: RuleBlock): string {
  if (b.kind === 'para') return `第 ${b.no} 段`;
  if (b.kind === 'example') return `例 ${b.no}`;
  if (b.kind === 'problem') return `${b.head ?? ''}第 ${b.no} 题`;
  if (b.kind === 'section') return b.head!;
  return clip(b.text, 16) || (b.kind === 'title' ? '标题' : '别的字');
}

const KIND = { title: 'title', para: 'para', section: 'column', other: 'other', example: 'example', problem: 'problem' } as const;

/** 一组页(一课)的块换成一页一份的树:栏目后面紧跟着、记着它(head)的题、段、别的字成它的小块 */
function groupZones(pages: readonly BookPage[], blocks: readonly RuleBlock[], group: number): Map<number, Zone[]> {
  interface Node { b: RuleBlock; id: string; kids: Node[] }
  const top: Node[] = [];
  let col: Node | null = null;
  blocks.forEach((b, k) => {
    const node: Node = { b, id: `${group}-${k + 1}`, kids: [] };
    if (b.kind === 'section') { col = node; top.push(node); return; }
    if (col && b.head !== undefined && b.head === col.b.head) { col.kids.push(node); return; }
    col = null;
    top.push(node);
  });
  const byN = new Map(pages.map((p) => [p.n, p]));
  // 一块在第 n 页上的那一截:它在这页的行、这页上有它的小块;都没有 = null
  const onPage = (node: Node, n: number): Zone | null => {
    const p = byN.get(n)!;
    const rows = node.b.refs.filter((r) => r.n === n).map((r) => linePermille(p, p.lines[r.i]));
    const kids = node.kids.map((x) => onPage(x, n)).filter((z): z is Zone => z !== null);
    const box = union([...rows, ...kids.map((z) => z.box)]);
    if (!box) return null;
    return { id: node.id, kind: KIND[node.b.kind], label: ruleLabel(node.b), box, rows, ...(kids.length ? { children: kids } : {}) };
  };
  const out = new Map<number, Zone[]>();
  for (const p of pages) out.set(p.n, top.map((x) => onPage(x, p.n)).filter((z): z is Zone => z !== null));
  return out;
}

/** 页上画的格 → 作答区,挂在框住格子中心的最里面那块上(那块和外面几层的框撑到包住它);没有就挂在页上 */
function cellRegions(p: BookPage, zones: Zone[]): ZoneRegion[] {
  const loose: ZoneRegion[] = [];
  (p.cells ?? []).forEach((c, i) => {
    const box = linePermille(p, c);
    const r: ZoneRegion = { id: String(i), kind: 'write', label: c.kind === 'blank' ? '填空' : c.kind === 'model' ? `范字「${c.ch ?? ''}」` : c.m ? `照着「${c.m}」写的格` : '田字格', box, ...(c.kind !== 'blank' ? { tian: true as const } : {}), cell: c.kind, ...(c.ch ? { ch: c.ch } : {}), ...(c.m ? { m: c.m } : {}) };
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    const path: Zone[] = [];
    let zs: readonly Zone[] = zones;
    for (;;) {
      const z = zs.find((x) => cx >= x.box[0] && cx <= x.box[2] && cy >= x.box[1] && cy <= x.box[3]);
      if (!z) break;
      path.push(z);
      zs = z.children ?? [];
    }
    const host = path[path.length - 1];
    if (!host) { loose.push(r); return; }
    (host.regions ??= []).push(r);
    for (const z of path) z.box = union([z.box, box])!;
  });
  return loose;
}

/** 一组页(一课、目录)出分块:一页一份 */
export function ruleLessonZones(pages: readonly BookPage[], layout: BookLayout): ZonePage[] {
  if (!pages.length) return [];
  const zones = groupZones(pages, ruleBlocks(pages, layout), pages[0].n);
  return pages.map((p) => {
    const zs = zones.get(p.n) ?? [];
    const loose = cellRegions(p, zs);
    return { page: p.n, zones: zs, ...(loose.length ? { regions: loose } : {}) };
  });
}

/**
 * 一册出分块,每页一份(没有块的页也有,zones 空着)。按课分组,段号、例题号一组里连着数:
 *  - 数学:目录上最外一层(单元)一组,整个页码范围(不截 BOOK_MAX_PAGES):正文的字号、跨页接着的栏目要整个单元一起看
 *    (人教数学二上第 26 页的「做一做」接着上一页,单看这一页会把下面的 1、2 认成例题);小节、课题读单元分好的;
 *  - 语文、科学:目录上最里一层一组(一课下面的诗一首一组,各自分段、点读),外面那课剩下没分到的页再一组;
 *  - 目录页一组,别的连着的页一组。一页落在两组里归先分到的那组
 */
export function ruleZones(index: BookIndex): ZonePage[] {
  const owner = new Map<number, number>();
  const groups: number[][] = [];
  const claim = (ns: number[]): void => {
    const mine = ns.filter((n) => !owner.has(n) && index.pages.some((p) => p.n === n));
    if (!mine.length) return;
    for (const n of mine) owner.set(n, groups.length);
    groups.push(mine);
  };
  const span = (l: { pages: [number, number] }): number[] => Array.from({ length: l.pages[1] - l.pages[0] + 1 }, (_, k) => l.pages[0] + k);
  claim(index.toc);
  const parents = new Set(index.lessons.flatMap((l) => (l.parent ? [l.parent] : [])));
  const order = index.layout === 'math' ? index.lessons.filter((l) => !l.parent) : [...index.lessons.filter((l) => !parents.has(l.title)), ...index.lessons.filter((l) => parents.has(l.title))];
  for (const l of order) claim(span(l));
  let run: number[] = [];
  for (const p of index.pages) {
    if (owner.has(p.n)) { claim(run); run = []; continue; }
    if (run.length && p.n !== run[run.length - 1] + 1) { claim(run); run = []; }
    run.push(p.n);
  }
  claim(run);
  const out = new Map<number, ZonePage>();
  for (const ns of groups) {
    const pages = ns.map((n) => index.pages.find((p) => p.n === n)!);
    // 一组里断开的页(两课重叠剩下的)各自连着的一截当一组,段号不跨过断开的地方
    let from = 0;
    for (let k = 1; k <= pages.length; k++) {
      if (k < pages.length && pages[k].n === pages[k - 1].n + 1) continue;
      for (const z of ruleLessonZones(pages.slice(from, k), index.layout)) out.set(z.page, z);
      from = k;
    }
  }
  return index.pages.map((p) => out.get(p.n) ?? { page: p.n, zones: [] });
}

// ——— 一课的结构(三种分法) ———

/** 统编版语文园地里的栏目名(一行只有它、靠左):按它分节 */
const SECTION_NAMES: readonly string[] = ['识字加油站', '字词句运用', '书写提示', '日积月累', '口语交际', '我爱阅读', '快乐读书吧', '我的发现', '展示台', '写话', '查字典', '和大人一起读', '读读写写', '读一读,记一记'];

interface At { p: BookPage; l: BookLine; i: number }

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const headOf = (t: string): string | null => { const s = t.replace(/^◎/, '').replace(/\s/g, ''); return SECTION_NAMES.find((h) => h.replace(/,/g, '，') === s || h === s) ?? null; };

/**
 * 一课的结构:有栏目名(语文园地)就按栏目分;没有就找课文正文——字最多的那种字体字号、行距一样连着的一串行,跨页接着——再按缩进分自然段
 * (段首比这一栏的左边缩进一个字以上);一行都很短(诗)就一行一段。别的行(认字栏、写字栏、课后题)各成一块 other。
 * 数学、科学课本另有分法,见 mathBlocks、scienceBlocks。
 */
export function ruleBlocks(pages: readonly BookPage[], layout: BookLayout = 'prose'): RuleBlock[] {
  if (layout === 'math') return mathBlocks(pages);
  if (layout === 'science') return scienceBlocks(pages);
  const all: At[] = pages.flatMap((p) => p.lines.map((l, i) => ({ p, l, i })).filter((x) => !bookChrome(x.p, x.l)));
  const ref = (x: At) => ({ n: x.p.n, i: x.i });
  const heads = all.filter((x) => headOf(x.l.text));
  if (heads.length) {
    const out: RuleBlock[] = [];
    const before = all.slice(0, all.indexOf(heads[0]));
    if (before.length) out.push({ kind: 'title', text: before.map((x) => x.l.text).join(' '), refs: before.map(ref) });
    heads.forEach((h, k) => {
      const body = all.slice(all.indexOf(h) + 1, k + 1 < heads.length ? all.indexOf(heads[k + 1]) : all.length);
      out.push({ kind: 'section', head: headOf(h.l.text)!, text: body.map((x) => withPinyin(x.l)).join(' '), refs: [ref(h), ...body.map(ref)] });
    });
    return out;
  }
  // 正文:字最多的那种(字体, 字号),只数六个字以上的行
  const weight = new Map<string, number>();
  for (const x of all) if (x.l.chars.length >= 6) weight.set(`${x.l.f}|${x.l.z}`, (weight.get(`${x.l.f}|${x.l.z}`) ?? 0) + x.l.chars.length);
  const key = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0];
  // 同一册里字体的名字每页可以不一样(统编语文二上《寒号鸟》第一页 f31、后面 f17):一页上压根没有那种字体,就认这一页同字号里字最多的那种
  const keyZ = key ? Number(key.slice(key.lastIndexOf('|') + 1)) : NaN;
  const keyF = key ? key.slice(0, key.lastIndexOf('|')) : '';
  const pageFont = new Map<BookPage, string>();
  for (const p of new Set(all.map((x) => x.p))) {
    const same = all.filter((x) => x.p === p && x.l.z === keyZ);
    if (!same.length || same.some((x) => x.l.f === keyF)) { pageFont.set(p, keyF); continue; }
    const w = new Map<string, number>();
    for (const x of same) w.set(x.l.f, (w.get(x.l.f) ?? 0) + x.l.chars.length);
    pageFont.set(p, [...w].sort((a, b) => b[1] - a[1])[0][0]);
  }
  // 课文后面认字栏的那一排字(「汽越温滴奔海洋发坏」)和正文同字号,换了字体名的那页会混进来:没有标点、全是汉字、字距宽(字号的 1.44 倍,正文 1.2 上下、识字课的诗 1.36)
  const letterRow = (l: BookLine): boolean => l.chars.length >= 6 && l.chars.every((c) => /\p{Script=Han}/u.test(c.c)) && (l.x2 - l.x1) / l.chars.length / l.z >= 1.4;
  const isBody = (x: At): boolean => x.l.z === keyZ && x.l.f === pageFont.get(x.p) && !letterRow(x.l);
  const bodies = all.filter(isBody);
  const gaps: number[] = [];
  for (let k = 1; k < bodies.length; k++) if (bodies[k].p === bodies[k - 1].p && bodies[k].l.y1 > bodies[k - 1].l.y1) gaps.push(bodies[k].l.y1 - bodies[k - 1].l.y1);
  const pitch = median(gaps) || 30;
  // 连着的一串:同一页里行距不超过 1.6 倍;换页时下一页第一行正文在上面四分之一
  const run: At[] = [];
  for (const x of bodies) {
    const prev = run[run.length - 1];
    if (!prev) { run.push(x); continue; }
    // 下一页顶上是插图(《寒号鸟》第二页)时正文从页中间起:上面没有别的字(图注那种小字不算)也算接着
    const clearAbove = (): boolean => !all.some((y) => y.p === x.p && y.l.y1 < x.l.y1 && y.l.z >= x.l.z * 0.85);
    const ok = prev.p === x.p ? x.l.y1 - prev.l.y1 <= 1.6 * pitch : x.p.n === prev.p.n + 1 && !run.some((y) => y.p === x.p) && (x.l.y1 < x.p.h * 0.25 || clearAbove());
    if (!ok) break;
    run.push(x);
  }
  const inRun = new Set(run);
  const poem = run.length > 0 && run.every((x) => x.l.chars.length <= 10);
  const paras: At[][] = [];
  let stanzas = false;
  run.forEach((x, k) => {
    const z = x.l.z;
    const near = run.filter((y) => y.p === x.p && Math.abs(y.l.y1 - x.l.y1) <= 6 * pitch && y.l.x1 >= x.l.x1 - 4 * z);
    const margin = Math.min(...near.map((y) => y.l.x1));
    // 诗的一节和一节之间空一点(《植物妈妈有办法》行距 40、节间 60):同一页里空出 1.3 倍行距以上另起一段
    const prev = run[k - 1];
    const gap = prev && prev.p === x.p && x.l.y1 - prev.l.y1 > 1.3 * pitch;
    const start = k === 0 || poem || gap || x.l.x1 - margin >= 1.2 * z;
    if (start) paras.push([x]); else paras[paras.length - 1].push(x);
    if (gap) stanzas = true;
  });
  // 分节的诗翻页处正好换节(《植物妈妈有办法》第 3、4 节):这一段跨了页,页前或页后正好是一节常见的行数,就在翻页处分开
  if (stanzas) {
    const n = new Map<number, number>();
    for (const ls of paras) n.set(ls.length, (n.get(ls.length) ?? 0) + 1);
    const usual = [...n].sort((a, b) => b[1] - a[1])[0][0];
    for (let k = 0; k < paras.length; k++) {
      const ls = paras[k], cut = ls.findIndex((x, j) => j > 0 && x.p !== ls[j - 1].p);
      if (cut > 0 && (cut === usual || ls.length - cut === usual)) paras.splice(k, 1, ls.slice(0, cut), ls.slice(cut));
    }
  }
  const out: RuleBlock[] = [];
  const first = run[0] ? all.indexOf(run[0]) : all.length;
  const title = all.slice(0, first);
  if (title.length) out.push({ kind: 'title', text: title.map((x) => x.l.text).join(' '), refs: title.map(ref) });
  paras.forEach((ls, k) => out.push({ kind: 'para', no: k + 1, text: ls.map((x) => x.l.text).join(''), refs: ls.map(ref) }));
  for (const x of all.slice(first)) if (!inRun.has(x)) out.push({ kind: 'other', text: withPinyin(x.l), refs: [ref(x)] });
  return out;
}

type MathMark = { kind: 'title' } | { kind: 'section'; head: string } | { kind: 'example'; no: number; skip: number } | { kind: 'problem'; no: number };

/**
 * 数学课本里一行是不是一块的开头(2026-11-15 照人教版数学二年级上册):
 *  - 标题:小节、课题(schema 的 mathHeading),单元页上的大字(正文的 1.4 倍以上);
 *  - 栏目名独占一行(做一做、练一练……);
 *  - 例题号:贴着左边距的一两位数,单独一行(比正文小一号)或后面空开一截接着题目(「1 把下面的气球分类。」);
 *  - 题号:做一做、练一练下面更小的数(不到正文的八成),单独一行;两道题并排时右边那道的题号不贴左边距,认字号(正文的六到七成,图里的数比这大)。
 */
function mathMark(p: BookPage, l: BookLine, body: number): MathMark | null {
  const head = l.text.replace(/^整理和.习$/, '整理和复习');
  if (MATH_COLUMNS.test(l.text)) return { kind: 'section', head };
  if (mathHeading(l, p.w, body) || (l.z >= 1.4 * body && /\p{Script=Han}/u.test(l.text) && l.chars.length <= 16)) return { kind: 'title' };
  if (l.x1 > 0.16 * p.w) return /^\d{1,2}$/.test(l.text) && l.z >= 0.6 * body && l.z <= 0.72 * body ? { kind: 'problem', no: Number(l.text) } : null;
  const m = /^\d{1,2}/.exec(l.text);
  if (!m) return null;
  if (m[0].length === l.chars.length) return l.z >= 0.78 * body ? { kind: 'example', no: Number(m[0]), skip: m[0].length } : { kind: 'problem', no: Number(m[0]) };
  // 数和后面的字空开将近一个字:例题号(「17世纪」挨着,不是)。题目自己也可能数字起头(例 1「18袋饼干」排成「1 18袋饼干」):空开的地方在第一个数后面就是例 1
  for (let k = 1; k <= m[0].length && k < l.chars.length; k++) if (l.chars[k].x1 - l.chars[k - 1].x2 >= 0.9 * l.z) return { kind: 'example', no: Number(m[0].slice(0, k)), skip: k };
  return null;
}

/**
 * 数学课本一课的结构:先认出每页的标记行(标题、栏目名、例题号、题号),别的行归给基线在它上面(差不到半个字)的最后一个标记;
 * 页顶在第一个标记以上的接着上一页的那一块。题记着自己在哪个栏目下(head);例题、标题之后不在栏目里。
 */
function mathBlocks(pages: readonly BookPage[]): RuleBlock[] {
  const body = bodySize(pages.flatMap((p) => p.lines));
  const base = (l: BookLine): number => l.y2 - 0.12 * l.z;
  const out: RuleBlock[] = [];
  let last: RuleBlock | null = null;
  let column: string | null = null;
  const intro = new Map<RuleBlock, RuleBlock>();
  for (const p of pages) {
    const ls = p.lines.map((l, i) => ({ l, i })).filter((x) => !bookChrome(p, x.l));
    const marks: { b: RuleBlock; y: number; x: number; z: number }[] = [];
    const rest: typeof ls = [];
    for (const x of ls) {
      const m = mathMark(p, x.l, body);
      if (!m) { rest.push(x); continue; }
      const ref = [{ n: p.n, i: x.i }];
      let b: RuleBlock;
      if (m.kind === 'title') { b = { kind: 'title', text: x.l.text, refs: ref }; column = null; }
      else if (m.kind === 'section') { b = { kind: 'section', head: m.head, text: '', refs: ref }; column = m.head; }
      else if (m.kind === 'example') { b = { kind: 'example', no: m.no, text: x.l.chars.slice(m.skip).map((c) => c.c).join(''), refs: ref }; column = null; }
      else b = { kind: 'problem', no: m.no, ...(column ? { head: column } : {}), text: '', refs: ref };
      marks.push({ b, y: base(x.l), x: x.l.x1, z: x.l.z });
    }
    marks.sort((a, b) => a.y - b.y);
    // 单元页上的大号序号和单元名(「二」「1～6的表内乘法」)挨着,合成一个标题
    for (let k = marks.length - 1; k > 0; k--) {
      const a = marks[k - 1], b = marks[k];
      if (a.b.kind === 'title' && b.b.kind === 'title' && b.y - a.y < 1.2 * Math.max(a.z, b.z)) {
        a.b.text = `${a.b.text} ${b.b.text}`;
        a.b.refs.push(...b.b.refs);
        marks.splice(k, 1);
      }
    }
    for (const x of rest) {
      // 归给在它上面、又不在右半栏的标记里最下面的那个(并排的两道题各管各的那一栏);一样高取靠右的
      const up = marks.filter((m) => m.y <= base(x.l) + 0.5 * x.l.z && m.x <= x.l.x1 + 0.25 * p.w);
      const near = up.reduce<(typeof up)[number] | null>((a, m) => (!a || m.y > a.y + 0.5 * m.z || (Math.abs(m.y - a.y) <= 0.5 * m.z && m.x > a.x) ? m : a), null);
      let owner: RuleBlock | null = near?.b ?? last;
      // 标题只放标题那一行:后面的字(单元页上的引导语、图里的字)另成一块
      if (owner?.kind === 'title') {
        const t = owner;
        owner = intro.get(t) ?? null;
        if (!owner) { owner = { kind: 'other', text: '', refs: [] }; intro.set(t, owner); out.push(owner); }
      }
      if (!owner) { owner = { kind: 'other', text: '', refs: [] }; out.push(owner); last = owner; }
      owner.text = owner.text ? `${owner.text} ${x.l.text}` : x.l.text;
      owner.refs.push({ n: p.n, i: x.i });
    }
    for (const m of marks) out.push(m.b);
    if (marks.length) last = marks[marks.length - 1].b;
  }
  // 按每块最先的那一行排(一页里接上一页的那几行、题号下面先于题号排的那一行都算进去了)
  const first = (b: RuleBlock): number => Math.min(...b.refs.map((r) => r.n * 10000 + r.i));
  return out.sort((a, b) => first(a) - first(b));
}

/**
 * 科学课本一课的结构(2026-11-24 照广东版科学二年级上册):一课是几个栏目(问题与想法 1、探索与实践 1、讨论与发现 1……,schema 的 scienceColumn),
 * 栏目里是正文(做什么、想什么)夹着插图里的字、观察记录表、安全提示。照读的先后一行一行走:
 *  - 栏目名另成一块,后面的块都记着它(head),「看 探索与实践 2」连着整个栏目;
 *  - 比正文大四成以上的汉字短行是标题(课名、单元页的大字),挨着的并成一块;
 *  - 正文字号(带拼音的那种字号)的行连成段:比这一页正文的左边缩进一个字以上、空出 1.6 倍行距以上、过了栏目名或标题就另起一段;段号整课连着数(点读、「第 3 段」照它);
 *    中间夹着的别的字(和正文并排的安全提示)不打断这一段;
 *  - 别的字(插图里的字、表格)挨着的连成一块 other。
 */
function scienceBlocks(pages: readonly BookPage[]): RuleBlock[] {
  // 正文的字号:低年级的正文字字带拼音,图里的字、表格、制作步骤不带(第12课的步骤图字多,只数字数会把它们当正文);整课没拼音的照字数
  const lines = pages.flatMap((p) => p.lines);
  const han = (l: BookLine) => l.chars.filter((c) => /\p{Script=Han}/u.test(c.c));
  const voiced = lines.filter((l) => { const h = han(l); return h.length > 0 && h.filter((c) => c.py).length >= 0.5 * h.length; });
  const body = bodySize(voiced.length >= 3 ? voiced : lines);
  const isBody = (l: BookLine): boolean => Math.abs(l.z - body) <= 0.06 * body && /\p{Script=Han}/u.test(l.text);
  const gaps: number[] = [];
  for (const p of pages) {
    const ys = p.lines.filter((l) => isBody(l) && !bookChrome(p, l)).map((l) => l.y1);
    for (let k = 1; k < ys.length; k++) if (ys[k] > ys[k - 1]) gaps.push(ys[k] - ys[k - 1]);
  }
  const pitch = median(gaps) || 1.8 * body;
  const out: RuleBlock[] = [];
  let head: string | undefined;
  let para: RuleBlock | null = null, other: RuleBlock | null = null, title: RuleBlock | null = null;
  let prev: { n: number; y: number } | null = null;
  let no = 0;
  const tag = (): { head?: string } => (head ? { head } : {});
  for (const p of pages) {
    const ls = p.lines.map((l, i) => ({ l, i })).filter((x) => !bookChrome(p, x.l));
    const margin = Math.min(...ls.filter((x) => isBody(x.l)).map((x) => x.l.x1));
    for (const { l, i } of ls) {
      const ref = { n: p.n, i };
      const col = scienceColumn(l.text);
      if (col) {
        head = col;
        out.push({ kind: 'section', head: col, text: '', refs: [ref] });
        para = other = title = null;
        continue;
      }
      if (l.z >= 1.4 * body && l.chars.length <= 16 && /\p{Script=Han}/u.test(l.text)) {
        if (title) { title.text += ` ${l.text}`; title.refs.push(ref); }
        else { title = { kind: 'title', text: l.text, refs: [ref] }; out.push(title); }
        para = other = null;
        continue;
      }
      title = null;
      if (isBody(l)) {
        other = null;
        const start = !para || l.x1 - margin >= 1.2 * l.z || (prev !== null && prev.n === p.n && l.y1 - prev.y > 1.6 * pitch);
        if (start) { para = { kind: 'para', no: ++no, ...tag(), text: l.text, refs: [ref] }; out.push(para); }
        else { para!.text += l.text; para!.refs.push(ref); }
        prev = { n: p.n, y: l.y1 };
        continue;
      }
      if (other) { other.text += ` ${l.text}`; other.refs.push(ref); }
      else { other = { kind: 'other', ...tag(), text: l.text, refs: [ref] }; out.push(other); }
    }
  }
  return out;
}


/**
 * 课本:vault 里的教材 PDF 做底(2026-11-14《语文预习:PDF 课本与镜头交互》)。一课的几页竖着排成一长条,屏幕是看它的一扇窗:
 * 老师说看哪里(`看: 第 6–7 段`、`看: 日积月累`、`看: 小鸟回答说`),应用照课本的索引算出那一块在哪、窗移过去;孩子用手指拖、捏着放大,Apple Pencil 写画。
 * 字的位置来自 PDF 的文字层(src/memory/textbook-index.ts),不认图:圈字、遮拼音、点字都照它找,不用老师估坐标。
 *
 * 场景坐标:一页的宽是 1000,高 = 1000 × 页的高宽比;几页从上往下排,页和页之间空 BOOK_GAP。老师的记号、孩子的笔画、窗(frame)都在这套坐标里,
 * 所以窗怎么动、换几张卡,孩子画在第 55 页上的那一笔都还在那里。
 * 这个文件是纯函数:索引(BookPage)由服务端读好给进来(落板之前换框、上下文包)或舞台拉来(点字)。
 */

import { MATH_COLUMNS, bodySize, mathHeading, type BookLayout, type BookLesson, type BookLine, type BookPage } from '../../schema/index.ts';
import type { ChalkSkeleton } from '../types.ts';
import type { Kit, KitEnv, KitScene } from './types.ts';

/** 一页的宽(场景坐标) */
export const BOOK_W = 1000;
/** 页和页之间空多少 */
export const BOOK_GAP = 30;
/** 没量过高宽比时取的数:16 开的课本(人教版 521.6 × 737 pt) */
export const BOOK_ASPECT = 1.413;
/** 围栏的名字 */
export const BOOK_KIT = '课本';
/** 刚进来、还没定哪一课时板上铺的那几页 */
export const BOOK_TOC = '目录';
/** 一张课本卡最多铺几页(数学一个小节能有十几页,多的不铺,老师写下一层的课题) */
export const BOOK_MAX_PAGES = 13;

const RED = '#e03131';
const RING_MAX = 4;
const COVER_MAX = 8;
const MARK_CHARS = 12;

type Box = [number, number, number, number];

/** 一页在场景里的位置:top 是页顶,s 是 PDF 的点到场景坐标的倍数 */
export interface BookSheet { n: number; top: number; s: number; height: number }

/** 几页从上往下排(页的宽高比照各页自己的;只给页号时都按 aspect) */
export function bookSheets(pages: readonly { n: number; w?: number; h?: number }[], aspect = BOOK_ASPECT): BookSheet[] {
  let top = 0;
  return pages.map((p) => {
    const s = p.w ? BOOK_W / p.w : 1;
    const height = p.w && p.h ? (BOOK_W * p.h) / p.w : BOOK_W * aspect;
    const sh = { n: p.n, top, s, height };
    top += height + BOOK_GAP;
    return sh;
  });
}

/** 这一长条有多高 */
export const bookHeight = (sheets: readonly BookSheet[]): number => (sheets.length ? sheets[sheets.length - 1].top + sheets[sheets.length - 1].height : 0);

const r1 = (n: number): number => Math.round(n * 10) / 10;
const union = (bs: readonly Box[]): Box | null => (bs.length ? [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] : null);
const toScene = (sh: BookSheet, x1: number, y1: number, x2: number, y2: number): Box => [r1(x1 * sh.s), r1(sh.top + y1 * sh.s), r1(x2 * sh.s), r1(sh.top + y2 * sh.s)];

/** 一行在场景里的框 */
export const lineBox = (sh: BookSheet, l: BookLine): Box => toScene(sh, l.x1, l.y1, l.x2, l.y2);

// ——— 找一课 ———

// 课名前的编号要隔开才去掉(「11 坐井观天」「第11课」「1.乘法的初步认识」);「6的乘法口诀」的 6 是课名的一部分
const bare = (s: string): string => s.trim().replace(/^[《「]?第?\s*\d{1,2}\s*(?:课|[.．、]|\s)\s*/, '').replace(/[《》「」""“”\s·.。,,、::]/g, '');

/** 课名(「坐井观天」「11 坐井观天」「《语文园地八》」)→ 目录里的一项;认不出 = null。先找一模一样的,再找包含的(短的那个在长的里) */
export function findLesson(lessons: readonly BookLesson[], name: string): BookLesson | null {
  const q = bare(name);
  if (!q) return null;
  return lessons.find((l) => bare(l.title) === q) ?? lessons.find((l) => bare(l.title).includes(q) || (q.length >= 2 && q.includes(bare(l.title)) && bare(l.title).length >= 2)) ?? null;
}

// ——— 一课的结构 ———

/** 统编版语文园地里的栏目名(一行只有它、靠左):按它分节 */
export const SECTION_NAMES: readonly string[] = ['识字加油站', '字词句运用', '书写提示', '日积月累', '口语交际', '我爱阅读', '快乐读书吧', '我的发现', '展示台', '写话', '查字典', '和大人一起读', '读读写写', '读一读,记一记'];

/**
 * 一课里的一块:标题、一段(no 从 1 起)、一个栏目(head)、别的(认字栏、写字栏、课后题、注释)。
 * 数学(layout: math):标题(单元、小节、课题)、例题(example,no 是例几)、栏目(做一做、练一练,section)、栏目下面的一道题(problem,no 是题号,head 是哪个栏目)
 */
export interface BookBlock {
  kind: 'title' | 'para' | 'section' | 'other' | 'example' | 'problem';
  no?: number;
  head?: string;
  text: string;
  /** 哪几行:页号 + 那一页的第几行 */
  refs: { n: number; i: number }[];
}

interface At { p: BookPage; l: BookLine; i: number }

/** 页脚:页码;和页码同一条基线的小字(数学的页脚是「16 1～6的表内乘法」、偶数页另起的单元名) */
function footer(p: BookPage, l: BookLine): boolean {
  if (l.y1 <= p.h - 70) return false;
  if (/^\d{1,3}$/.test(l.text)) return true;
  if (p.printed === null || l.z > 12.5) return false;
  const no = String(p.printed);
  return p.lines.some((o) => o.y1 > p.h - 70 && Math.abs(o.y1 - l.y1) < 2 && o.text.startsWith(no));
}

/** 页眉(单元名)、页脚(页码、「仅供个人学习使用」)不算正文 */
// 页顶的数只在它就是这一页的页码时算页眉:数学的题号常印在页顶(第 5 题从这一页开头)
const chrome = (p: BookPage, l: BookLine): boolean => (l.y1 < 45 && (/单元/.test(l.text) || (p.printed !== null && l.text === String(p.printed)))) || footer(p, l) || /仅供个人学习使用/.test(l.text);
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const headOf = (t: string): string | null => { const s = t.replace(/^◎/, '').replace(/\s/g, ''); return SECTION_NAMES.find((h) => h.replace(/,/g, '，') === s || h === s) ?? null; };

/**
 * 一课的结构:有栏目名(语文园地)就按栏目分;没有就找课文正文——字最多的那种字体字号、行距一样连着的一串行,跨页接着——再按缩进分自然段
 * (段首比这一栏的左边缩进一个字以上);一行都很短(诗)就一行一段。别的行(认字栏、写字栏、课后题)各成一块 other。
 * 数学课本(layout: math)另有分法,见 mathBlocks。
 */
export function lessonBlocks(pages: readonly BookPage[], layout: BookLayout = 'prose'): BookBlock[] {
  if (layout === 'math') return mathBlocks(pages);
  const all: At[] = pages.flatMap((p) => p.lines.map((l, i) => ({ p, l, i })).filter((x) => !chrome(x.p, x.l)));
  const ref = (x: At) => ({ n: x.p.n, i: x.i });
  const heads = all.filter((x) => headOf(x.l.text));
  if (heads.length) {
    const out: BookBlock[] = [];
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
  const isBody = (x: At): boolean => `${x.l.f}|${x.l.z}` === key;
  const bodies = all.filter(isBody);
  const gaps: number[] = [];
  for (let k = 1; k < bodies.length; k++) if (bodies[k].p === bodies[k - 1].p && bodies[k].l.y1 > bodies[k - 1].l.y1) gaps.push(bodies[k].l.y1 - bodies[k - 1].l.y1);
  const pitch = median(gaps) || 30;
  // 连着的一串:同一页里行距不超过 1.6 倍;换页时下一页第一行正文在上面四分之一
  const run: At[] = [];
  for (const x of bodies) {
    const prev = run[run.length - 1];
    if (!prev) { run.push(x); continue; }
    const ok = prev.p === x.p ? x.l.y1 - prev.l.y1 <= 1.6 * pitch : x.p.n === prev.p.n + 1 && !run.some((y) => y.p === x.p) && x.l.y1 < x.p.h * 0.25;
    if (!ok) break;
    run.push(x);
  }
  const inRun = new Set(run);
  const poem = run.length > 0 && run.every((x) => x.l.chars.length <= 10);
  const paras: At[][] = [];
  run.forEach((x, k) => {
    const z = x.l.z;
    const near = run.filter((y) => y.p === x.p && Math.abs(y.l.y1 - x.l.y1) <= 6 * pitch && y.l.x1 >= x.l.x1 - 4 * z);
    const margin = Math.min(...near.map((y) => y.l.x1));
    const start = k === 0 || poem || x.l.x1 - margin >= 1.2 * z;
    if (start) paras.push([x]); else paras[paras.length - 1].push(x);
  });
  const out: BookBlock[] = [];
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
function mathBlocks(pages: readonly BookPage[]): BookBlock[] {
  const body = bodySize(pages.flatMap((p) => p.lines));
  const base = (l: BookLine): number => l.y2 - 0.12 * l.z;
  const out: BookBlock[] = [];
  let last: BookBlock | null = null;
  let column: string | null = null;
  const intro = new Map<BookBlock, BookBlock>();
  for (const p of pages) {
    const ls = p.lines.map((l, i) => ({ l, i })).filter((x) => !chrome(p, x.l));
    const marks: { b: BookBlock; y: number; x: number; z: number }[] = [];
    const rest: typeof ls = [];
    for (const x of ls) {
      const m = mathMark(p, x.l, body);
      if (!m) { rest.push(x); continue; }
      const ref = [{ n: p.n, i: x.i }];
      let b: BookBlock;
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
      let owner: BookBlock | null = near?.b ?? last;
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
  const first = (b: BookBlock): number => Math.min(...b.refs.map((r) => r.n * 10000 + r.i));
  return out.sort((a, b) => first(a) - first(b));
}

/** 一行短的、几乎每个字都带拼音的(认字栏、识字加油站的词):给老师看时带上读音「观(guān)沿(yán)」;别的只给字 */
function withPinyin(l: BookLine): string {
  const han = l.chars.filter((c) => /\p{Script=Han}/u.test(c.c));
  if (l.chars.length > 14 || !han.length || han.filter((c) => c.py).length < han.length * 0.8) return l.text;
  return l.chars.map((c) => (c.py ? `${c.c}(${c.py})` : c.c)).join('');
}

// ——— 找东西在哪 ———

/** 页号 → 这一页在场景里的位置 */
const sheetOf = (sheets: readonly BookSheet[], n: number): BookSheet | undefined => sheets.find((s) => s.n === n);

function refsBox(pages: readonly BookPage[], sheets: readonly BookSheet[], refs: readonly { n: number; i: number }[]): Box | null {
  return union(refs.flatMap((r) => {
    const p = pages.find((x) => x.n === r.n), sh = sheetOf(sheets, r.n), l = p?.lines[r.i];
    return p && sh && l ? [lineBox(sh, l)] : [];
  }));
}

const PUNCT = /[\s\p{P}\p{S}]/u;

/** 一课的字连成一串(照行的先后),每个字记着它在哪页哪行第几个 */
function stream(pages: readonly BookPage[]): { c: string; n: number; i: number; k: number }[] {
  return pages.flatMap((p) => p.lines.flatMap((l, i) => (chrome(p, l) ? [] : l.chars.flatMap((ch, k) => (PUNCT.test(ch.c) ? [] : [{ c: ch.c, n: p.n, i, k }])))));
}

/** 一段原文在哪:不管标点、空格、换行;找到第一处(在一行里的优先,给了 within 再先找和它挨着的),回这几个字所在的行与字 */
function findText(pages: readonly BookPage[], sheets: readonly BookSheet[], text: string, within?: Box | null): { refs: { n: number; i: number }[]; box: Box } | null {
  const q = Array.from(text).filter((c) => !PUNCT.test(c)).join('');
  if (!q) return null;
  const s = stream(pages);
  const hay = s.map((x) => x.c).join('');
  const hits: number[] = [];
  for (let at = hay.indexOf(q); at >= 0; at = hay.indexOf(q, at + 1)) hits.push(at);
  if (!hits.length) return null;
  const boxOf = (at: number): { refs: { n: number; i: number }[]; box: Box } => {
    const xs = s.slice(at, at + q.length);
    const boxes = xs.flatMap((x) => {
      const p = pages.find((pp) => pp.n === x.n)!, sh = sheetOf(sheets, x.n)!, l = p.lines[x.i], ch = l.chars[x.k];
      return [toScene(sh, ch.x1, l.y1, ch.x2, l.y2)];
    });
    const refs = [...new Map(xs.map((x) => [`${x.n}.${x.i}`, { n: x.n, i: x.i }])).values()];
    return { refs, box: union(boxes)! };
  };
  // 在一行里的那几处优先:短的(盖: 12)跨行拼出来的多半是巧合(表头末尾的 1 接下一格的 2);长的原话跨行时还是找得到
  const found = hits.map(boxOf);
  const all = found.some((h) => h.refs.length === 1) ? found.filter((h) => h.refs.length === 1) : found;
  if (within) {
    const inside = all.find((h) => h.box[0] < within[2] && h.box[2] > within[0] && h.box[1] < within[3] && h.box[3] > within[1]);
    if (inside) return inside;
  }
  return all[0];
}

/** 一个字词在哪(圈、遮用):只要这几个字的框;跨了行只取第一行那一截 */
export function bookFind(pages: readonly BookPage[], sheets: readonly BookSheet[], text: string, within?: Box | null): Box | null {
  const hit = findText(pages, sheets, text, within);
  if (!hit) return null;
  if (hit.refs.length === 1) return hit.box;
  const first = hit.refs[0];
  const p = pages.find((x) => x.n === first.n)!, l = p.lines[first.i];
  const sh = sheetOf(sheets, first.n)!;
  const y1 = sh.top + l.y1 * sh.s;
  return [hit.box[0] < l.x2 * sh.s ? hit.box[0] : r1(l.x1 * sh.s), r1(y1), r1(l.x2 * sh.s), r1(sh.top + l.y2 * sh.s)];
}

const RANGE = /^第?\s*(\d{1,2})\s*(?:[-–—~～到至]\s*第?\s*(\d{1,2}))?\s*(?:自然)?段$/;
const PAGE = /^第?\s*(\d{1,3})\s*页$/;
const EXAMPLE = /^例\s*(\d{1,2})$/;
const PROBLEM = /^(做一做|练一练|试一试|整理和复习)?\s*的?\s*第?\s*(\d{1,2})\s*(?:题|小题)$/;

/**
 * 老师的「看」→ 那一块(场景坐标)与给人看的名字。认这几种写法:
 *  第 6 段 / 第 6–7 段(一课的自然段)· 第 55 页(印的页码,整页)· 栏目名(日积月累;数学的做一做、练一练连着下面的题)· 标题 / 开头 · 课本上的一句原话(取它所在的几行)
 *  数学:例 2 · 练一练第 3 题(只写「第 3 题」是这一课里第一个第 3 题)。同名的栏目、例题有几处取第一处,要别的那处写原话
 * 认不出 = null(应用不动窗,给家长端记一行)。
 */
export function bookTarget(pages: readonly BookPage[], sheets: readonly BookSheet[], blocks: readonly BookBlock[], what: string): { label: string; box: Box } | null {
  const q = what.trim().replace(/[「」『』《》""“”]/g, '');
  const r = RANGE.exec(q);
  if (r) {
    const a = Number(r[1]), b = Number(r[2] ?? r[1]);
    const ps = blocks.filter((x) => x.kind === 'para' && x.no! >= Math.min(a, b) && x.no! <= Math.max(a, b));
    const box = refsBox(pages, sheets, ps.flatMap((x) => x.refs));
    return box ? { label: a === b ? `第${a}段` : `第${Math.min(a, b)}–${Math.max(a, b)}段`, box } : null;
  }
  const pg = PAGE.exec(q);
  if (pg) {
    const p = pages.find((x) => x.printed === Number(pg[1])), sh = p ? sheetOf(sheets, p.n) : undefined;
    return sh ? { label: `第${pg[1]}页`, box: [0, r1(sh.top), BOOK_W, r1(sh.top + sh.height)] } : null;
  }
  const ex = EXAMPLE.exec(q.replace(/\s/g, ''));
  if (ex) {
    const b = blocks.find((x) => x.kind === 'example' && x.no === Number(ex[1]));
    const box = b ? refsBox(pages, sheets, b.refs) : null;
    return box ? { label: `例${ex[1]}`, box } : null;
  }
  const pr = PROBLEM.exec(q.replace(/\s/g, ''));
  if (pr) {
    const b = blocks.find((x) => x.kind === 'problem' && x.no === Number(pr[2]) && (!pr[1] || x.head === pr[1]));
    const box = b ? refsBox(pages, sheets, b.refs) : null;
    return box ? { label: `${b!.head ?? ''}第${pr[2]}题`, box } : null;
  }
  if (/^(标题|题目|开头|课题)$/.test(q)) {
    const t = blocks.filter((x) => x.kind === 'title' || (x.kind === 'para' && x.no === 1));
    const box = refsBox(pages, sheets, t.flatMap((x) => x.refs));
    return box ? { label: '开头', box } : null;
  }
  const sec = blocks.find((x) => x.kind === 'section' && (x.head === q || x.head!.includes(q) || (q.length >= 2 && q.includes(x.head!))));
  if (sec) {
    // 数学的栏目连着下面的题
    const k = blocks.indexOf(sec);
    let end = k + 1;
    while (end < blocks.length && blocks[end].kind === 'problem') end++;
    const box = refsBox(pages, sheets, blocks.slice(k, end).flatMap((x) => x.refs));
    return box ? { label: sec.head!, box } : null;
  }
  const hit = findText(pages, sheets, q);
  if (!hit) return null;
  return { label: q.length > 12 ? `${Array.from(q).slice(0, 12).join('')}…` : q, box: refsBox(pages, sheets, hit.refs)! };
}

/** 孩子点到的是哪个字(场景坐标的一点):落在一行里(上下各宽出两成)、离哪个字最近;不是汉字 = null */
export function bookPick(pages: readonly BookPage[], sheets: readonly BookSheet[], x: number, y: number): { c: string; py?: string; box: Box } | null {
  for (const p of pages) {
    const sh = sheetOf(sheets, p.n);
    if (!sh || y < sh.top || y > sh.top + sh.height) continue;
    let best: { c: string; py?: string; box: Box; d: number } | null = null;
    for (const l of p.lines) {
      const [x1, y1, x2, y2] = lineBox(sh, l);
      const pad = (y2 - y1) * 0.2;
      if (y < y1 - pad || y > y2 + pad || x < x1 - pad || x > x2 + pad) continue;
      for (const ch of l.chars) {
        if (!/\p{Script=Han}/u.test(ch.c)) continue;
        const cx = (ch.x1 + ch.x2) / 2 * sh.s;
        const d = Math.abs(cx - x) + Math.abs((y1 + y2) / 2 - y) * 0.5;
        if (!best || d < best.d) best = { c: ch.c, ...(ch.py ? { py: ch.py } : {}), box: toScene(sh, ch.x1, l.y1, ch.x2, l.y2), d };
      }
    }
    if (best && best.d < (best.box[2] - best.box[0]) * 1.2) { const { d: _d, ...hit } = best; return hit; }
  }
  return null;
}

/** 窗里看得见什么(给老师的一句):哪几页、哪几段 / 哪几个栏目;一行露出一半以上才算 */
export function bookView(pages: readonly BookPage[], sheets: readonly BookSheet[], blocks: readonly BookBlock[], box: Box): string {
  const seen = (refs: readonly { n: number; i: number }[]): boolean => refs.some((r) => {
    const p = pages.find((x) => x.n === r.n), sh = sheetOf(sheets, r.n), l = p?.lines[r.i];
    if (!p || !sh || !l) return false;
    const [x1, y1, x2, y2] = lineBox(sh, l);
    const w = Math.max(0, Math.min(x2, box[2]) - Math.max(x1, box[0])), h = Math.max(0, Math.min(y2, box[3]) - Math.max(y1, box[1]));
    return w * h >= 0.5 * (x2 - x1) * (y2 - y1);
  });
  const printed = [...new Set(sheets.filter((s) => s.top < box[3] && s.top + s.height > box[1]).map((s) => pages.find((p) => p.n === s.n)?.printed).filter((n): n is number => typeof n === 'number'))];
  const where = printed.length ? `第 ${printed.length > 1 ? `${printed[0]}–${printed[printed.length - 1]}` : printed[0]} 页` : '';
  const paras = blocks.filter((b) => b.kind === 'para' && seen(b.refs)).map((b) => b.no!);
  // 数学:例几、栏目;栏目名没露出来、只露出下面的题,说是哪个栏目第几题
  const named = blocks.filter((b) => (b.kind === 'section' || b.kind === 'example') && seen(b.refs)).map((b) => (b.kind === 'example' ? `例${b.no}` : b.head!));
  const probs = new Map<string, number[]>();
  for (const b of blocks) if (b.kind === 'problem' && seen(b.refs) && !named.includes(b.head ?? '')) probs.set(b.head ?? '', [...(probs.get(b.head ?? '') ?? []), b.no!]);
  const qs = [...probs].map(([h, ns]) => `${h}第 ${ns.length > 1 ? `${ns[0]}–${ns[ns.length - 1]}` : ns[0]} 题`);
  const secs = [...new Set(named), ...qs];
  const others = blocks.filter((b) => b.kind === 'other' && seen(b.refs)).length;
  const parts = [paras.length ? `第 ${paras.length > 1 ? `${paras[0]}–${paras[paras.length - 1]}` : paras[0]} 段` : '', secs.join('、'), others && !paras.length && !secs.length ? '课文后面的部分' : ''].filter(Boolean);
  return [where, parts.join(',')].filter(Boolean).join(':') || '空白处';
}

/**
 * 这一册的课本卡开放哪些操作:数学不开点字(点一个字弹田字格是语文的事,数学课本上点到字只会打岔);剩下的空了就是只看
 */
export function bookOps(layout: BookLayout, ops: readonly string[]): string[] {
  if (layout !== 'math') return [...ops];
  const out = ops.filter((o) => o !== '点字');
  return out.length ? out : ['看'];
}

// ——— 画法 ———

/** 「59-60」「59」→ [59, 60] */
export function bookPages(v: string | undefined): number[] {
  const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec((v ?? '').trim());
  if (!m) return [];
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  if (b < a || b - a >= BOOK_MAX_PAGES) return [];
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

/** 「看」「圈」「遮」里的一处:文字与(应用找到的)框;框没有就是还没找、或找不到 */
export function bookSpots(v: string | undefined): { text: string; box: Box | null }[] {
  return (v ?? '').split(';').filter(Boolean).map((part) => {
    const [a, b] = part.includes('|') ? [part.slice(0, part.lastIndexOf('|')), part.slice(part.lastIndexOf('|') + 1)] : [part, ''];
    const n = b.split(' ').filter(Boolean).map(Number);
    return { text: a, box: n.length === 4 && n.every(Number.isFinite) ? (n as Box) : null };
  });
}

function readPdf(v: string): string {
  const s = v.trim();
  if (!/\.pdf$/i.test(s) || s.startsWith('/') || s.includes('..') || /^https?:/.test(s)) throw new Error('课本的「书」由应用填,是 vault 里教材 PDF 的路径');
  return s;
}

function readRange(v: string): string {
  const p = bookPages(v.replace(/\s/g, '').replace(/[–—~～到至]/, '-'));
  if (!p.length) throw new Error('课本的「页」由应用填:PDF 的第几页到第几页,如 59-60');
  return p.length > 1 ? `${p[0]}-${p[p.length - 1]}` : String(p[0]);
}

/** 「圈」「遮」:几处字词,分号、顿号隔开;存下来「字|左 上 右 下」(找到了)或「字|」(还没找) */
function readSpots(name: string, max: number) {
  return (v: string): string => {
    const parts = v.split(/[;;]/).flatMap((x) => (x.includes('|') ? [x] : x.split(/[、,,\s]+/))).map((x) => x.trim()).filter(Boolean);
    if (!parts.length || parts.length > max) throw new Error(`课本的「${name}」最多 ${max} 处:写课本上的字词,用顿号隔开,如 ${name}: 井沿、无边无际`);
    return parts.map((part) => {
      const spot = bookSpots(part)[0];
      const text = spot.text.replace(/[「」『』《》""“”]/g, '').trim();
      if (!text || Array.from(text).length > MARK_CHARS) throw new Error(`课本的「${name}」写课本上的字词(${MARK_CHARS} 个字以内),应用照课本找到它在哪`);
      return spot.box ? `${text}|${spot.box.join(' ')}` : `${text}|`;
    }).join(';');
  };
}

/** 「看」:一处;存「第6–7段|左 上 右 下」 */
function readLook(v: string): string {
  const spot = bookSpots(v.replace(/[;;]/g, ''))[0];
  const text = spot?.text.trim() ?? '';
  if (!text || Array.from(text).length > 40) throw new Error('课本的「看」写一处:第 6–7 段、第 55 页、栏目名(日积月累、做一做)、例 2、练一练第 3 题,或课本上的一句原话');
  return spot.box ? `${text}|${spot.box.join(' ')}` : `${text}|`;
}

/** 老师要看的那一块 → 窗:四周留一点边;太小就放大到页宽的三分之一为止(字够大了),太高只取上面一页多 */
export function bookFrame(box: Box | null, sheets: readonly BookSheet[]): [number, number, number, number] {
  if (!box) {
    const first = sheets[0];
    return [0, first ? first.top : 0, BOOK_W, Math.min(first ? first.height : BOOK_W * BOOK_ASPECT, BOOK_W * 0.8)];
  }
  let [x1, y1, x2, y2] = box;
  const pad = Math.max(30, (x2 - x1) * 0.05);
  x1 -= pad; x2 += pad; y1 -= pad; y2 += pad;
  const minW = BOOK_W / 3;
  if (x2 - x1 < minW) { const cx = (x1 + x2) / 2; x1 = cx - minW / 2; x2 = cx + minW / 2; }
  if (y2 - y1 > BOOK_W * 1.25) y2 = y1 + BOOK_W * 1.25;
  return [r1(x1), r1(y1), r1(x2 - x1), r1(y2 - y1)];
}

export const book: Kit = {
  name: BOOK_KIT,
  about: '课本:家长放在 vault 里的教材 PDF,一课的几页铺在板上。你说看哪里,应用把那一块移到孩子眼前;圈字、遮拼音、盖住印好的答案都写字,应用照课本找到它。孩子手指拖动、放大,点一个字看笔顺;用笔在上面圈、写。',
  ops: ['点字', '圈', '画', '看'],
  open: ['点字', '圈', '画'],
  params: [
    { key: '课', note: '哪一课:课名或语文园地几(课: 坐井观天)。不写就是板上现在这一课;第一次写,应用就把这一课的几页铺上。', read: (v) => v.trim().slice(0, 20), fallback: '' },
    { key: '看', note: '让孩子看哪里:第 6–7 段、第 55 页、栏目名(日积月累、做一做)、例 2、练一练第 3 题,或课本上的一句原话。应用把它移到屏幕中间、字太小就放大。不写就不动(孩子正看着哪里就还是哪里)。', read: readLook, fallback: '' },
    { key: '圈', note: '圈出课本上的字词:写字(圈: 井沿),应用照课本找到它。几处用顿号隔开,最多 4 处。', read: readSpots('圈', RING_MAX), fallback: '' },
    { key: '遮', note: '要孩子自己认的字词:盖住头上的拼音,孩子点一下揭开。写字,几处用顿号隔开,最多 8 处。', read: readSpots('遮', COVER_MAX), fallback: '' },
    { key: '盖', note: '盖住课本上印的字(例题里的算式、答案),请孩子先自己想,他点一下揭开。写课本上的原样(盖: 3×5=15),几处用顿号隔开,最多 8 处。', read: readSpots('盖', COVER_MAX), fallback: '' },
    { key: '书', note: '应用填:教材 PDF 的路径。你不用写。', read: readPdf, fallback: '' },
    { key: '页', note: '应用填:这一课在 PDF 的第几页到第几页。你不用写。', read: readRange, fallback: '' },
  ],
  build(p, env?: KitEnv): KitScene {
    const a = env?.aspect && env.aspect > 0 ? env.aspect : BOOK_ASPECT;
    const pages = bookPages(p['页']);
    const sheets = bookSheets(pages.map((n) => ({ n })), a);
    const look = bookSpots(p['看'])[0];
    const frame = bookFrame(look?.box ?? null, sheets);
    // 记号照窗的大小:窗越小(放得越大)线越细,铺到屏幕上一样粗
    const u = Math.max(frame[2], frame[3]) / 640;
    const w = Math.max(1.2, 2.5 * u);
    const sk: ChalkSkeleton[] = [];
    for (const { text, box } of bookSpots(p['圈'])) {
      if (!box) continue;
      const [x1, y1, x2, y2] = box;
      const pad = Math.max(4, (y2 - y1) * 0.35);
      sk.push({ type: 'ellipse', id: `ring-${text}-${x1}-${y1}`, label: `老师圈的:${text}`, x: r1(x1 - pad * 1.4), y: r1(y1 - pad), width: r1(x2 - x1 + pad * 2.8), height: r1(y2 - y1 + pad * 2), strokeColor: RED, strokeWidth: w, animateDuration: 700 });
    }
    // 遮拼音:字头上一条纸色的块(拼音印在字的正上方,约 0.8 个字高);孩子点它揭开(舞台按 id 前缀认)
    for (const { text, box } of bookSpots(p['遮'])) {
      if (!box) continue;
      const [x1, y1, x2, y2] = box;
      const h = y2 - y1;
      sk.push({ type: 'rectangle', id: `cover-${text}`, label: `盖住的拼音:${text}`, x: r1(x1 - h * 0.1), y: r1(y1 - h * 0.95), width: r1(x2 - x1 + h * 0.2), height: r1(h * 0.9), strokeColor: '#d9c9a3', strokeWidth: Math.max(1, u * 0.6), backgroundColor: '#f1e6c8', fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, animateDuration: 150 });
    }
    // 盖字:那几个字整个盖住(纸色的块,比字宽出一点);孩子点它揭开(舞台按 id 前缀认)
    for (const { text, box } of bookSpots(p['盖'])) {
      if (!box) continue;
      const [x1, y1, x2, y2] = box;
      const h = y2 - y1;
      sk.push({ type: 'rectangle', id: `cover-${text}`, label: `盖住的:${text}`, x: r1(x1 - h * 0.25), y: r1(y1 - h * 0.2), width: r1(x2 - x1 + h * 0.5), height: r1(h * 1.4), strokeColor: '#d9c9a3', strokeWidth: Math.max(1, u * 0.6), backgroundColor: '#f1e6c8', fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, animateDuration: 150 });
    }
    return { skeletons: sk, groups: [], turns: [], frame, book: { src: p['书'] ?? '', pages, aspect: a, gap: BOOK_GAP } };
  },
  read(p, state) {
    const marks = (state.marks ?? []).filter((s) => s.length);
    const picked = (state.picked ?? []).filter(Boolean);
    const looked = picked.length ? `点开看了笔顺:${picked.map((w) => `「${w}」`).join('')}` : '';
    if (!marks.length) return looked || '还没画';
    const a = state.aspect && state.aspect > 0 ? state.aspect : BOOK_ASPECT;
    const sheets = bookSheets(bookPages(p['页']).map((n) => ({ n })), a);
    // 画在哪一页的哪一截(上、中、下):具体圈住了什么看图
    const where = (y: number): string => {
      const sh = sheets.find((s) => y >= s.top && y <= s.top + s.height + BOOK_GAP) ?? sheets[sheets.length - 1];
      if (!sh) return '';
      const f = (y - sh.top) / sh.height;
      return `PDF 第 ${sh.n} 页${f < 0.34 ? '上面' : f < 0.67 ? '中间' : '下面'}`;
    };
    const parts = marks.map((s) => {
      const ys = s.map((q) => q[1]);
      return `画了一笔,在${where((Math.min(...ys) + Math.max(...ys)) / 2)}`;
    });
    if (looked) parts.unshift(looked);
    parts.push('圈住了什么看图');
    return parts.join(';');
  },
};

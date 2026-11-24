/**
 * 课本:vault 里的教材 PDF 做页。一课的几页竖着排成一长条,屏幕是看它的一扇窗:
 * 老师说看哪里(`[[看 第 6–7 段]]`、`[[看 日积月累]]`、`[[看 小鸟回答说]]`),应用照课本的索引算出那一块在哪、窗移过去;孩子用手指拖、点两下放大,Apple Pencil 写画。
 * 字的位置来自 PDF 的文字层(src/memory/textbook-index.ts),不认图:圈字、遮拼音、盖字、点字都照它找,不用老师估坐标。
 *
 * 场景坐标:一页的宽是 1000,高 = 1000 × 页的高宽比;几页从上往下排。每页底下没有字的那一条裁掉(bookCut:教育平台盖的「仅供个人学习使用」就印在那里),
 * 页和页直接连着(没裁的页之间空 BOOK_GAP)。老师的记号、孩子的笔画、窗都在这套坐标里,所以窗怎么动,孩子画在第 55 页上的那一笔都还在那里。
 * 这个文件是纯函数:索引(BookPage)由服务端读好给进来(落到页上之前找框、上下文包)或舞台拉来(点字)。
 * 老师的动作落到页上在 src/board/lesson-fit.ts;这里只有课本的几何。
 */

import { MATH_COLUMNS, bodySize, mathHeading, scienceColumn, type BookLayout, type BookLesson, type BookLine, type BookPage } from '../../schema/index.ts';

/** 一页的宽(场景坐标) */
export const BOOK_W = 1000;
/** 页和页之间空多少(没裁页底的;裁了的直接连着) */
export const BOOK_GAP = 30;
/** 没量过高宽比时取的数:16 开的课本(人教版 521.6 × 737 pt) */
export const BOOK_ASPECT = 1.413;
/** 刚进来、还没定哪一课时板上铺的那几页 */
export const BOOK_TOC = '目录';
/** 一课最多铺几页(数学一个小节能有十几页,多的不铺,老师翻下一层的课题) */
export const BOOK_MAX_PAGES = 13;

type Box = [number, number, number, number];

/** 一页在场景里的位置:top 是页顶,s 是 PDF 的点到场景坐标的倍数 */
export interface BookSheet { n: number; top: number; s: number; height: number }

/**
 * 几页从上往下排(页的宽高比照各页自己的;只给页号时都按 aspect);cut 是每页底下裁掉多少(场景坐标),裁了页和页就直接连着。
 * gaps = 每页上面空多少(第一页上面的也算;作业本照天、周分开,src/board/lesson.ts 的 photoGaps);不给就是第一页贴顶、之后空 BOOK_GAP
 */
export function bookSheets(pages: readonly { n: number; w?: number; h?: number }[], aspect = BOOK_ASPECT, cut = 0, gaps?: readonly number[]): BookSheet[] {
  let top = 0;
  return pages.map((p, i) => {
    const s = p.w ? BOOK_W / p.w : 1;
    const full = p.w && p.h ? (BOOK_W * p.h) / p.w : BOOK_W * aspect;
    const height = cut > 0 ? Math.max(full / 2, full - cut) : full;
    top += gaps ? (gaps[i] ?? 0) : i && cut <= 0 ? BOOK_GAP : 0;
    const sh = { n: p.n, top, s, height };
    top += height;
    return sh;
  });
}

const cuts = new WeakMap<readonly BookPage[], number>();
/** 页底的字和页边之间留的一点(PDF 的点) */
const CUT_KEEP = 3;

/**
 * 这一册每页底下裁掉多少(场景坐标):整册里印得最低的那行字(页码)以下。给整册的页(index.pages),一册一个数,每一课都一样。
 * 国家中小学智慧教育平台下载的课本每页底边盖着一行「仅供个人学习使用」,不在文字层里(认不出来),但总在页码下面;没盖的书裁掉的只是白边。
 * 只是显示时不铺这一条,vault 里的 PDF 不改。
 */
export function bookCut(pages: readonly BookPage[]): number {
  const had = cuts.get(pages);
  if (had !== undefined) return had;
  let cut = Infinity;
  for (const p of pages) {
    if (!p.lines.length || !p.w) continue;
    const low = Math.max(...p.lines.map((l) => l.y2));
    cut = Math.min(cut, ((p.h - low - CUT_KEEP) * BOOK_W) / p.w);
  }
  const out = Number.isFinite(cut) ? Math.max(0, r1(cut)) : 0;
  cuts.set(pages, out);
  return out;
}

/** 这一长条有多高 */
export const bookHeight = (sheets: readonly BookSheet[]): number => (sheets.length ? sheets[sheets.length - 1].top + sheets[sheets.length - 1].height : 0);

const r1 = (n: number): number => Math.round(n * 10) / 10;
const union = (bs: readonly Box[]): Box | null => (bs.length ? [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] : null);
const toScene = (sh: BookSheet, x1: number, y1: number, x2: number, y2: number): Box => [r1(x1 * sh.s), r1(sh.top + y1 * sh.s), r1(x2 * sh.s), r1(sh.top + y2 * sh.s)];

/** 一行在场景里的框 */
export const lineBox = (sh: BookSheet, l: BookLine): Box => toScene(sh, l.x1, l.y1, l.x2, l.y2);

/** 一课几页上的田字格(场景坐标):id = <PDF 第几页>.<这一页第几格>(一节课状态里 kid.cells 的键);kind、ch、m 同 BookCell */
export interface SceneCell { id: string; box: Box; kind: 'model' | 'trace' | 'empty' | 'blank'; ch?: string; m?: string }
export function bookCellsOf(pages: readonly BookPage[], sheets: readonly BookSheet[]): SceneCell[] {
  return pages.flatMap((p) => {
    const sh = sheetOf(sheets, p.n);
    return sh ? (p.cells ?? []).map((c, i) => ({ id: `${p.n}.${i}`, box: toScene(sh, c.x1, c.y1, c.x2, c.y2), kind: c.kind, ...(c.ch ? { ch: c.ch } : {}), ...(c.m ? { m: c.m } : {}) })) : [];
  });
}

// ——— 找一课 ———

// 课名前的编号要隔开才去掉(「11 坐井观天」「第11课」「1.乘法的初步认识」);「6的乘法口诀」的 6 是课名的一部分
const bare = (s: string): string => s.trim().replace(/^[《「]?第?\s*\d{1,2}\s*(?:课|[.．、]|\s)\s*/, '').replace(/[《》「」""“”\s·.。,,、::]/g, '');

/**
 * 课名(「坐井观天」「11 坐井观天」「《语文园地八》」)→ 目录里的一项;认不出 = null。先找一模一样的,再找包含的(短的那个在长的里)。
 * 一样的课名有几课(统编语文的两个「古诗二首」):写了编号的照编号挑,没写的是第一个
 */
export function findLesson(lessons: readonly BookLesson[], name: string): BookLesson | null {
  const q = bare(name);
  if (!q) return null;
  const same = lessons.filter((l) => bare(l.title) === q);
  const no = /^[《「]?第?\s*(\d{1,2})\s*(?:课|[.．、]|\s)/.exec(name.trim())?.[1];
  return same.find((l) => no !== undefined && l.no === no) ?? same[0] ?? lessons.find((l) => bare(l.title).includes(q) || (q.length >= 2 && q.includes(bare(l.title)) && bare(l.title).length >= 2)) ?? null;
}

/** 一课在页上、板的日志里叫什么:课名;和别的课同名又有编号的带上编号(「18 古诗二首」),findLesson 照它找回这一课 */
export function lessonName(lessons: readonly BookLesson[], l: BookLesson): string {
  return l.no && /^\d+$/.test(l.no) && lessons.some((x) => x !== l && x.title === l.title) ? `${l.no} ${l.title}` : l.title;
}

// ——— 一课的结构 ———

/** 统编版语文园地里的栏目名(一行只有它、靠左):按它分节 */
export const SECTION_NAMES: readonly string[] = ['识字加油站', '字词句运用', '书写提示', '日积月累', '口语交际', '我爱阅读', '快乐读书吧', '我的发现', '展示台', '写话', '查字典', '和大人一起读', '读读写写', '读一读,记一记'];

/**
 * 一课里的一块:标题、一段(no 从 1 起)、一个栏目(head)、别的(认字栏、写字栏、课后题、注释)。
 * 数学(layout: math):标题(单元、小节、课题)、例题(example,no 是例几)、栏目(做一做、练一练,section)、栏目下面的一道题(problem,no 是题号,head 是哪个栏目)
 * 科学(layout: science):标题、栏目(探索与实践 1,section)、栏目下面的段(para,段号整课连着数)和别的字(other);段和别的字的 head 是它在哪个栏目下
 */
export interface BookBlock {
  kind: 'title' | 'para' | 'section' | 'other' | 'example' | 'problem';
  no?: number;
  head?: string;
  text: string;
  /** 哪几行:页号 + 那一页的第几行 */
  refs: { n: number; i: number }[];
  /** 这一块自己的框(页的坐标,PDF 的点):照片上认出的题框住整道题(题里的图、要填的空也在里面),比框里那几行的并集大;没有就照 refs 算 */
  area?: { n: number; box: Box };
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
 * 数学、科学课本另有分法,见 mathBlocks、scienceBlocks。
 */
export function lessonBlocks(pages: readonly BookPage[], layout: BookLayout = 'prose'): BookBlock[] {
  if (layout === 'math') return mathBlocks(pages);
  if (layout === 'science') return scienceBlocks(pages);
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

/**
 * 科学课本一课的结构(2026-11-24 照广东版科学二年级上册):一课是几个栏目(问题与想法 1、探索与实践 1、讨论与发现 1……,schema 的 scienceColumn),
 * 栏目里是正文(做什么、想什么)夹着插图里的字、观察记录表、安全提示。照读的先后一行一行走:
 *  - 栏目名另成一块,后面的块都记着它(head),「看 探索与实践 2」连着整个栏目;
 *  - 比正文大四成以上的汉字短行是标题(课名、单元页的大字),挨着的并成一块;
 *  - 正文字号(带拼音的那种字号)的行连成段:比这一页正文的左边缩进一个字以上、空出 1.6 倍行距以上、过了栏目名或标题就另起一段;段号整课连着数(点读、「第 3 段」照它);
 *    中间夹着的别的字(和正文并排的安全提示)不打断这一段;
 *  - 别的字(插图里的字、表格)挨着的连成一块 other。
 */
function scienceBlocks(pages: readonly BookPage[]): BookBlock[] {
  // 正文的字号:低年级的正文字字带拼音,图里的字、表格、制作步骤不带(第12课的步骤图字多,只数字数会把它们当正文);整课没拼音的照字数
  const lines = pages.flatMap((p) => p.lines);
  const han = (l: BookLine) => l.chars.filter((c) => /\p{Script=Han}/u.test(c.c));
  const voiced = lines.filter((l) => { const h = han(l); return h.length > 0 && h.filter((c) => c.py).length >= 0.5 * h.length; });
  const body = bodySize(voiced.length >= 3 ? voiced : lines);
  const isBody = (l: BookLine): boolean => Math.abs(l.z - body) <= 0.06 * body && /\p{Script=Han}/u.test(l.text);
  const gaps: number[] = [];
  for (const p of pages) {
    const ys = p.lines.filter((l) => isBody(l) && !chrome(p, l)).map((l) => l.y1);
    for (let k = 1; k < ys.length; k++) if (ys[k] > ys[k - 1]) gaps.push(ys[k] - ys[k - 1]);
  }
  const pitch = median(gaps) || 1.8 * body;
  const out: BookBlock[] = [];
  let head: string | undefined;
  let para: BookBlock | null = null, other: BookBlock | null = null, title: BookBlock | null = null;
  let prev: { n: number; y: number } | null = null;
  let no = 0;
  const tag = (): { head?: string } => (head ? { head } : {});
  for (const p of pages) {
    const ls = p.lines.map((l, i) => ({ l, i })).filter((x) => !chrome(p, x.l));
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

/** 一行短的、几乎每个字都带拼音的(认字栏、识字加油站的词):给老师看时带上读音「观(guān)沿(yán)」;别的只给字 */
function withPinyin(l: BookLine): string {
  const han = l.chars.filter((c) => /\p{Script=Han}/u.test(c.c));
  if (l.chars.length > 14 || !han.length || han.filter((c) => c.py).length < han.length * 0.8) return l.text;
  return l.chars.map((c) => (c.py ? `${c.c}(${c.py})` : c.c)).join('');
}

// ——— 点读课文 ———

/** 点读一句最多几个字(合成一次的长度;长的在逗号处再切) */
export const READ_SAY_MAX = 120;

/**
 * 一段话切成一句一句(点读一句合成一次、放一次,暂停了从那一句接着读):句号、问号、叹号、省略号、分号收一句,紧跟的引号、括号跟着这一句;
 * 还是太长的在逗号处切。空白都去掉(PDF 的文字层里一行里偶尔有空格)
 */
export function readSentences(text: string): string[] {
  const cs = Array.from(text.replace(/\s+/g, ''));
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < cs.length; i++) {
    cur += cs[i];
    if (!/[。！？!?…；;]/.test(cs[i])) continue;
    while (i + 1 < cs.length && /[。！？!?…”’」』)）]/.test(cs[i + 1])) cur += cs[++i];
    out.push(cur);
    cur = '';
  }
  if (cur) out.push(cur);
  return out.flatMap((s) => {
    if (Array.from(s).length <= READ_SAY_MAX) return [s];
    const parts: string[] = [];
    let at = '';
    for (const piece of s.split(/(?<=[，,、：:])/)) {
      if (at && Array.from(at + piece).length > READ_SAY_MAX) { parts.push(at); at = ''; }
      at += piece;
    }
    if (at) parts.push(at);
    return parts.flatMap((p) => (Array.from(p).length <= READ_SAY_MAX ? [p] : Array.from({ length: Math.ceil(Array.from(p).length / READ_SAY_MAX) }, (_, k) => Array.from(p).slice(k * READ_SAY_MAX, (k + 1) * READ_SAY_MAX).join(''))));
  });
}

/** 标题里的课名:去掉课号和略读课的星号(「5 秋天的信」「*8 古诗二首」「第1课认识空气」→ 课名) */
const titleSay = (t: string): string => t.replace(/^[\s*＊]*(?:第\s*\d{1,2}\s*课|\d{1,2})[\s.．、]*/, '').replace(/\s+/g, '');

/**
 * 一课里点读的几块(语文课文,docs/dev/课本.md):标题(no 0)和一个个自然段(no = 第几段),每块切成句;
 * 标题读课名,古诗再读诗题和作者(标题下面同一页、字不太小的那几行:「登鹳雀楼」「[唐]王之涣」);
 * 一行一段的诗(识字课、古诗)按节读:一节一块(同一页里空出一截、或换页就是下一节),no 是这一节第一行那段。
 * line = 这一块读的那一行(标题是字号最大的那行,段是段首那一行);rows = 这一块的字在哪几行(照读的先后;舞台照它把句对到字上)。没有自然段(语文园地按栏目分、数学)= 空:不点读。
 * 服务端照它整篇合成(/api/kid/textbook/read,readLessonText、readTimes),舞台照它摆段首的钮、铺正在读的那一句(bookReadParts),两边拿同一份行,所以块和句对得上。
 */
export interface ReadText { no: number; sents: string[]; line: { n: number; i: number }; rows: { n: number; i: number }[] }
export function bookReadTexts(pages: readonly BookPage[], blocks: readonly BookBlock[]): ReadText[] {
  const paras = blocks.filter((b) => b.kind === 'para' && b.refs.length);
  if (!paras.length) return [];
  const lineOf = (r: { n: number; i: number }): BookLine | undefined => pages.find((p) => p.n === r.n)?.lines[r.i];
  const out: ReadText[] = [];
  // 标题:标题那一块里有汉字、字号最大的那行(前面可能还有上一课的尾巴、单元名)
  const t = blocks.find((b) => b.kind === 'title');
  const rows = (t?.refs ?? []).map((r) => ({ r, l: lineOf(r) })).filter((x): x is { r: { n: number; i: number }; l: BookLine } => Boolean(x.l));
  const main = rows.filter((x) => /\p{Script=Han}/u.test(x.l.text)).sort((a, b) => b.l.z - a.l.z)[0];
  const say = main ? titleSay(main.l.text) : '';
  if (main && say) {
    const subRows = rows.filter((x) => x !== main && x.r.n === main.r.n && x.l.y1 > main.l.y1 && x.l.z >= main.l.z * 0.5 && /\p{Script=Han}/u.test(x.l.text) && !/^\d+$/.test(x.l.text.trim()));
    const sub = subRows.map((x) => x.l.text.replace(/[[\]［］〔〕【】]/g, ' ').trim().replace(/\s+/g, ','));
    out.push({ no: 0, sents: [say, ...sub], line: main.r, rows: [main.r, ...subRows.map((x) => x.r)] });
  }
  // 一行一段的诗:按节并起来
  const poem = paras.every((b) => b.refs.length === 1 && Array.from(b.text).length <= 12);
  if (poem) {
    const ys = paras.map((b) => ({ b, n: b.refs[0].n, y: lineOf(b.refs[0])?.y1 ?? 0 }));
    const gaps = ys.slice(1).flatMap((x, k) => (x.n === ys[k].n ? [x.y - ys[k].y] : [])).sort((a, b) => a - b);
    const pitch = gaps[Math.floor(gaps.length / 2)] ?? 0;
    let cur: ReadText | null = null;
    ys.forEach((x, k) => {
      const prev = ys[k - 1];
      if (!cur || !prev || prev.n !== x.n || x.y - prev.y > pitch * 1.3) { cur = { no: x.b.no!, sents: [], line: x.b.refs[0], rows: [] }; out.push(cur); }
      cur.sents.push(...readSentences(x.b.text));
      cur.rows.push(...x.b.refs);
    });
    return out.filter((x) => x.sents.length);
  }
  for (const b of paras) {
    const sents = readSentences(b.text);
    if (sents.length) out.push({ no: b.no!, sents, line: b.refs[0], rows: b.refs });
  }
  return out;
}

/** 点读整篇一次合成的字:一块一行(标题、一段、诗的一节),块里的句连着;服务端照它合成,照 readTimes 对回块和句 */
export const readLessonText = (texts: readonly ReadText[]): string => texts.map((x) => x.sents.join('')).join('\n');

/**
 * 整篇的声音里每一句从第几毫秒起(times[k][s]):把合成回来的字(一个字一条,标点粘在后一个字前面)连成一串,
 * 句里的字(不算标点、空白)照先后一个一个对上去,句的起点 = 对上的第一个字的起点;一个字都没对上的句照前一句。
 * end = 最后一个字读完
 */
export function readTimes(texts: readonly ReadText[], words: readonly { text: string; begin_time: number; end_time: number }[]): { times: number[][]; end: number } {
  const chars: { c: string; t: number }[] = [];
  for (const w of words) for (const c of Array.from(w.text)) if (!PUNCT.test(c)) chars.push({ c, t: w.begin_time });
  let at = 0, prev = 0;
  const times = texts.map((x) => x.sents.map((sent) => {
    let start: number | null = null;
    for (const c of Array.from(sent)) {
      if (PUNCT.test(c)) continue;
      let j = at;
      while (j < chars.length && j < at + SAY_LOOK && chars[j].c !== c) j++;
      if (j >= chars.length || chars[j].c !== c) continue;
      if (start === null) start = chars[j].t;
      at = j + 1;
    }
    prev = start ?? prev;
    return prev;
  }));
  return { times, end: words.length ? words[words.length - 1].end_time : 0 };
}

/**
 * 点读的几块摆在场景里:hit = 能点的那块空白——段首缩进的那两格(宽两个字,从这一行第一个字往左),标题是课号左边两个字宽;
 * 高是这一行字连着头上的拼音。dot = 钮的圆心(那两格正中,和字同一高度),r = 钮的半径;
 * says[s] = 第 s 句在页上的框,一行一个(从这句第一个字到最后一个字,连着头上的拼音;正在读的那一句舞台照它铺一层学科色)
 */
export interface ReadPart { no: number; sents: string[]; hit: Box; dot: [number, number]; r: number; says: Box[][] }
export function bookReadParts(pages: readonly BookPage[], sheets: readonly BookSheet[], blocks: readonly BookBlock[]): ReadPart[] {
  return bookReadTexts(pages, blocks).flatMap((x) => {
    const p = pages.find((pp) => pp.n === x.line.n), sh = sheetOf(sheets, x.line.n), l = p?.lines[x.line.i];
    if (!p || !sh || !l) return [];
    const [x1, y1, x2, y2] = lineBox(sh, l);
    const h = y2 - y1;
    // 一个字宽:这一行的字距(字加字间的空)
    const step = (x2 - x1) / Math.max(1, l.chars.length);
    const top = l.chars.some((c) => c.py) ? y1 - h * 0.95 : y1;
    // 标题:课号印在课名左边(和课名同一高度、在它左边的那几行里最左的字),空白在课号左边
    const right = x.no === 0 ? Math.min(x1, ...p.lines.filter((o) => o !== l && o.x2 <= l.x1 && o.y1 < l.y2 && o.y2 > l.y1).map((o) => lineBox(sh, o)[0])) : x1;
    const from = Math.max(0, right - step * 2);
    if (right - from < step) return [];
    const r = r1(Math.min(18, h * 0.5, (right - from) * 0.4));
    return [{ no: x.no, sents: x.sents, hit: [r1(from), r1(top), r1(right), r1(y2)] as Box, dot: [r1((from + right) / 2), r1((y1 + y2) / 2)] as [number, number], r, says: readSays(pages, sheets, x) }];
  });
}

/** 句里的字对不上时往后找几个字(句是去了空白的段文字,标题的诗题把空格换成了逗号) */
const SAY_LOOK = 6;

/**
 * 每一句在页上的框:把这一块那几行的字连成一串,句里的字照先后一个一个对上去(对不上的字跳过,往后最多找 SAY_LOOK 个),
 * 对上的字按行并成框;一句没对上一个字 = 空(不铺)
 */
function readSays(pages: readonly BookPage[], sheets: readonly BookSheet[], x: ReadText): Box[][] {
  const chars: { c: string; row: number; x1: number; x2: number }[] = [];
  const rows: { y1: number; y2: number; s: number }[] = [];
  for (const ref of x.rows) {
    const p = pages.find((pp) => pp.n === ref.n), sh = sheetOf(sheets, ref.n), l = p?.lines[ref.i];
    if (!p || !sh || !l) continue;
    const [, y1, , y2] = lineBox(sh, l);
    const top = l.chars.some((c) => c.py) ? y1 - (y2 - y1) * 0.95 : y1;
    const row = rows.push({ y1: top, y2, s: sh.s }) - 1;
    for (const ch of l.chars) if (!/\s/.test(ch.c)) chars.push({ c: ch.c, row, x1: ch.x1, x2: ch.x2 });
  }
  let at = 0;
  return x.sents.map((sent) => {
    const hit = new Map<number, [number, number]>();
    for (const c of Array.from(sent.replace(/\s+/g, ''))) {
      let j = at;
      while (j < chars.length && j < at + SAY_LOOK && chars[j].c !== c) j++;
      if (j >= chars.length || chars[j].c !== c) continue;
      const ch = chars[j], had = hit.get(ch.row);
      hit.set(ch.row, had ? [Math.min(had[0], ch.x1), Math.max(had[1], ch.x2)] : [ch.x1, ch.x2]);
      at = j + 1;
    }
    return [...hit.entries()].sort((a, b) => a[0] - b[0]).map(([row, [a, b]]): Box => [r1(a * rows[row].s), r1(rows[row].y1), r1(b * rows[row].s), r1(rows[row].y2)]);
  });
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

/** 那几行在场景里各自的框(照行的先后):老师「看」的那一块,舞台照它一行一行刷 */
function refsRows(pages: readonly BookPage[], sheets: readonly BookSheet[], refs: readonly { n: number; i: number }[]): Box[] {
  return refs.flatMap((r) => {
    const p = pages.find((x) => x.n === r.n), sh = sheetOf(sheets, r.n), l = p?.lines[r.i];
    return p && sh && l ? [lineBox(sh, l)] : [];
  });
}

/** 一块在场景里的框:有自己的框就用它,没有照那几行 */
function blockBox(pages: readonly BookPage[], sheets: readonly BookSheet[], b: BookBlock): Box | null {
  if (b.area) { const sh = sheetOf(sheets, b.area.n); return sh ? toScene(sh, ...b.area.box) : null; }
  return refsBox(pages, sheets, b.refs);
}

const PUNCT = /[\s\p{P}\p{S}]/u;

/** 一课的字连成一串(照行的先后),每个字记着它在哪页哪行第几个 */
function stream(pages: readonly BookPage[]): { c: string; n: number; i: number; k: number }[] {
  return pages.flatMap((p) => p.lines.flatMap((l, i) => (chrome(p, l) ? [] : l.chars.flatMap((ch, k) => (PUNCT.test(ch.c) ? [] : [{ c: ch.c, n: p.n, i, k }])))));
}

/** 一段原文在哪:不管标点、空格、换行;找到第一处(在一行里的优先,给了 within 再先找和它挨着的),回这几个字所在的行与字 */
function findText(pages: readonly BookPage[], sheets: readonly BookSheet[], text: string, within?: Box | null): { refs: { n: number; i: number }[]; box: Box; rows: Box[]; py: boolean } | null {
  const q = Array.from(text).filter((c) => !PUNCT.test(c)).join('');
  if (!q) return null;
  const s = stream(pages);
  const hay = s.map((x) => x.c).join('');
  const hits: number[] = [];
  for (let at = hay.indexOf(q); at >= 0; at = hay.indexOf(q, at + 1)) hits.push(at);
  if (!hits.length) return null;
  const boxOf = (at: number): { refs: { n: number; i: number }[]; box: Box; rows: Box[]; py: boolean } => {
    const xs = s.slice(at, at + q.length);
    let py = false;
    // 一行一截(这几个字在这一行的那一段):「看」一句原话时舞台照它刷
    const perLine = new Map<string, Box[]>();
    const boxes = xs.map((x) => {
      const p = pages.find((pp) => pp.n === x.n)!, sh = sheetOf(sheets, x.n)!, l = p.lines[x.i], ch = l.chars[x.k];
      const b = toScene(sh, ch.x1, l.y1, ch.x2, l.y2);
      if (ch.py) py = true;
      const key = `${x.n}.${x.i}`;
      perLine.set(key, [...(perLine.get(key) ?? []), b]);
      return b;
    });
    const refs = [...new Map(xs.map((x) => [`${x.n}.${x.i}`, { n: x.n, i: x.i }])).values()];
    return { refs, box: union(boxes)!, rows: [...perLine.values()].map((bs) => union(bs)!), py };
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

/**
 * 指着字的记号落在哪(圈、划、加点用):box 同 bookFind;rows = 一行一截(划一句跨行时一行一条);
 * py = 这几个字头上有没有印拼音(圈要把拼音一起圈进去,不切拼音那一行)
 */
export function bookSpot(pages: readonly BookPage[], sheets: readonly BookSheet[], text: string, within?: Box | null): { box: Box; rows: Box[]; py: boolean } | null {
  const hit = findText(pages, sheets, text, within);
  const box = hit ? bookFind(pages, sheets, text, within) : null;
  return hit && box ? { box, rows: hit.rows, py: hit.py } : null;
}

const RANGE = /^第?\s*(\d{1,2})\s*(?:[-–—~～到至]\s*第?\s*(\d{1,2}))?\s*(?:自然)?段$/;
const PAGE = /^第?\s*(\d{1,3})\s*页$/;
const EXAMPLE = /^例\s*(\d{1,2})$/;
const PROBLEM = /^(做一做|练一练|试一试|整理和复习)?\s*的?\s*第?\s*(\d{1,2})\s*(?:题|小题)$/;

/**
 * 老师的「看」→ 那一块(场景坐标)与给人看的名字。认这几种写法:
 *  第 6 段 / 第 6–7 段(一课的自然段)· 第 55 页(印的页码,整页)· 栏目名(日积月累;数学的做一做、练一练连着下面的题)· 标题 / 开头 · 课本上的一句原话(取它所在的几行)
 *  数学:例 2 · 练一练第 3 题(只写「第 3 题」是这一课里第一个第 3 题)。同名的栏目、例题有几处取第一处,要别的那处写原话
 *  科学:栏目名带序号(探索与实践 2,连着这个栏目下的段、表、图里的字;只写「探索与实践」是第一个)
 * rows = 这一块的字行各自的框(一句原话是每行那一截;舞台照它刷荧光,不按框去猜——跨页的框会把中间的脚注罩进去)。
 * 认不出 = null(应用不动窗,给家长端记一行)。
 */
export function bookTarget(pages: readonly BookPage[], sheets: readonly BookSheet[], blocks: readonly BookBlock[], what: string): { label: string; box: Box; rows: Box[] } | null {
  const q = what.trim().replace(/[「」『』《》""“”]/g, '');
  const r = RANGE.exec(q);
  if (r) {
    const a = Number(r[1]), b = Number(r[2] ?? r[1]);
    const ps = blocks.filter((x) => x.kind === 'para' && x.no! >= Math.min(a, b) && x.no! <= Math.max(a, b));
    const refs = ps.flatMap((x) => x.refs);
    const box = refsBox(pages, sheets, refs);
    return box ? { label: a === b ? `第${a}段` : `第${Math.min(a, b)}–${Math.max(a, b)}段`, box, rows: refsRows(pages, sheets, refs) } : null;
  }
  const pg = PAGE.exec(q);
  if (pg) {
    const p = pages.find((x) => x.printed === Number(pg[1])), sh = p ? sheetOf(sheets, p.n) : undefined;
    return p && sh ? { label: `第${pg[1]}页`, box: [0, r1(sh.top), BOOK_W, r1(sh.top + sh.height)], rows: refsRows(pages, sheets, p.lines.flatMap((l, i) => (chrome(p, l) ? [] : [{ n: p.n, i }]))) } : null;
  }
  const ex = EXAMPLE.exec(q.replace(/\s/g, ''));
  if (ex) {
    const b = blocks.find((x) => x.kind === 'example' && x.no === Number(ex[1]));
    const box = b ? refsBox(pages, sheets, b.refs) : null;
    return box ? { label: `例${ex[1]}`, box, rows: refsRows(pages, sheets, b!.refs) } : null;
  }
  const pr = PROBLEM.exec(q.replace(/\s/g, ''));
  if (pr) {
    const b = blocks.find((x) => x.kind === 'problem' && x.no === Number(pr[2]) && (!pr[1] || x.head === pr[1]));
    const box = b ? blockBox(pages, sheets, b) : null;
    return box ? { label: `${b!.head ?? ''}第${pr[2]}题`, box, rows: refsRows(pages, sheets, b!.refs) } : null;
  }
  if (/^(标题|题目|开头|课题)$/.test(q)) {
    const t = blocks.filter((x) => x.kind === 'title' || (x.kind === 'para' && x.no === 1));
    const refs = t.flatMap((x) => x.refs);
    const box = refsBox(pages, sheets, refs);
    return box ? { label: '开头', box, rows: refsRows(pages, sheets, refs) } : null;
  }
  // 栏目名不管空格(「探索与实践 2」「探索与实践2」)
  const sq = q.replace(/\s/g, '');
  const sec = blocks.find((x) => { const h = x.head?.replace(/\s/g, '') ?? ''; return x.kind === 'section' && (h === sq || h.includes(sq) || (sq.length >= 2 && sq.includes(h))); });
  if (sec) {
    // 数学的栏目连着下面的题;科学的连着记着这个栏目的段和别的字
    const k = blocks.indexOf(sec);
    let end = k + 1;
    while (end < blocks.length && (blocks[end].kind === 'problem' || (blocks[end].kind !== 'section' && blocks[end].head === sec.head))) end++;
    const refs = blocks.slice(k, end).flatMap((x) => x.refs);
    const box = refsBox(pages, sheets, refs);
    return box ? { label: sec.head!, box, rows: refsRows(pages, sheets, refs) } : null;
  }
  const hit = findText(pages, sheets, q);
  if (!hit) return null;
  return { label: q.length > 12 ? `${Array.from(q).slice(0, 12).join('')}…` : q, box: refsBox(pages, sheets, hit.refs)!, rows: hit.rows };
}

/** 能弹出来的:一到四个汉字(田字格),或一个英文单词(四线三格,最多 20 个字母) */
const HANZI = /^[\u3400-\u9fff]+$/;
const EN_WORD = /^[A-Za-z][A-Za-z'-]{0,19}$/;
export const PICK_CHARS = 4;
export const pickable = (text: string): boolean => (HANZI.test(text) && Array.from(text).length <= PICK_CHARS) || EN_WORD.test(text);
/** 这一项是英文单词(浮层是四线三格,不是田字格) */
export const pickEnglish = (text: string): boolean => EN_WORD.test(text);

/** 孩子点到的是哪个字(场景坐标的一点):落在一行里(上下各宽出两成)、离哪个字最近;英文是那个字母所在的词;别的(数字、标点)= null */
export function bookPick(pages: readonly BookPage[], sheets: readonly BookSheet[], x: number, y: number): { c: string; py?: string; box: Box } | null {
  for (const p of pages) {
    const sh = sheetOf(sheets, p.n);
    if (!sh || y < sh.top || y > sh.top + sh.height) continue;
    let best: { c: string; py?: string; box: Box; d: number } | null = null;
    for (const l of p.lines) {
      const [x1, y1, x2, y2] = lineBox(sh, l);
      const pad = (y2 - y1) * 0.2;
      if (y < y1 - pad || y > y2 + pad || x < x1 - pad || x > x2 + pad) continue;
      for (let k = 0; k < l.chars.length; k++) {
        const ch = l.chars[k];
        const han = /\p{Script=Han}/u.test(ch.c);
        if (!han && !/[A-Za-z]/.test(ch.c)) continue;
        const cx = (ch.x1 + ch.x2) / 2 * sh.s;
        const d = Math.abs(cx - x) + Math.abs((y1 + y2) / 2 - y) * 0.5;
        if (best && d >= best.d) continue;
        if (han) { best = { c: ch.c, ...(ch.py ? { py: ch.py } : {}), box: toScene(sh, ch.x1, l.y1, ch.x2, l.y2), d }; continue; }
        // 英文:点中一个字母就是它所在的那个词(英语课本、英语作业的照片)
        let a = k, b = k;
        while (a > 0 && /[A-Za-z'-]/.test(l.chars[a - 1].c)) a--;
        while (b < l.chars.length - 1 && /[A-Za-z'-]/.test(l.chars[b + 1].c)) b++;
        const word = l.chars.slice(a, b + 1).map((c) => c.c).join('').replace(/^['-]+|['-]+$/g, '');
        if (EN_WORD.test(word)) best = { c: word, box: toScene(sh, l.chars[a].x1, l.y1, l.chars[b].x2, l.y2), d };
      }
    }
    if (best && best.d < (best.box[2] - best.box[0]) * 1.2) { const { d: _d, ...hit } = best; return hit; }
  }
  return null;
}

/**
 * 一块(场景坐标,老师「看」的那一块)里的字行:老师的「看」没带 rows(照片的第几张、新拍的照片)时舞台照它刷荧光黄。每行只取中心落在块里的字,从第一个到最后一个连成一段;
 * 行的上下就是字的上下(拼音挂在字上,不另成行);照读的顺序(从上到下、从左到右)。没有文字层(白纸、照片还没认完)= []
 */
export function bookRows(pages: readonly BookPage[], sheets: readonly BookSheet[], box: Box): Box[] {
  const out: Box[] = [];
  for (const p of pages) {
    const sh = sheetOf(sheets, p.n);
    if (!sh) continue;
    for (const l of p.lines) {
      const [, y1, , y2] = lineBox(sh, l);
      const cy = (y1 + y2) / 2;
      if (cy < box[1] || cy > box[3]) continue;
      let a = Infinity, b = -Infinity;
      for (const ch of l.chars) {
        const x1 = ch.x1 * sh.s, x2 = ch.x2 * sh.s, cx = (x1 + x2) / 2;
        if (cx < box[0] || cx > box[2]) continue;
        a = Math.min(a, x1); b = Math.max(b, x2);
      }
      if (a < b) out.push([r1(a), y1, r1(b), y2]);
    }
  }
  return out.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
}

/** 窗里看得见什么(给老师的一句):哪几页、哪几段 / 哪几个栏目;一行露出一半以上才算 */
export function bookView(pages: readonly BookPage[], sheets: readonly BookSheet[], blocks: readonly BookBlock[], box: Box, unit: '页' | '张' = '页'): string {
  const seen = (refs: readonly { n: number; i: number }[], b?: BookBlock): boolean => (b?.area ? areaSeen(b.area) : false) || refs.some((r) => {
    const p = pages.find((x) => x.n === r.n), sh = sheetOf(sheets, r.n), l = p?.lines[r.i];
    if (!p || !sh || !l) return false;
    const [x1, y1, x2, y2] = lineBox(sh, l);
    const w = Math.max(0, Math.min(x2, box[2]) - Math.max(x1, box[0])), h = Math.max(0, Math.min(y2, box[3]) - Math.max(y1, box[1]));
    return w * h >= 0.5 * (x2 - x1) * (y2 - y1);
  });
  // 照片上的题:题框露出一半以上才算
  const areaSeen = (a: NonNullable<BookBlock['area']>): boolean => {
    const sh = sheetOf(sheets, a.n);
    if (!sh) return false;
    const [x1, y1, x2, y2] = toScene(sh, ...a.box);
    const w = Math.max(0, Math.min(x2, box[2]) - Math.max(x1, box[0])), h = Math.max(0, Math.min(y2, box[3]) - Math.max(y1, box[1]));
    return w * h >= 0.5 * (x2 - x1) * (y2 - y1);
  };
  const shown = sheets.filter((s) => s.top < box[3] && s.top + s.height > box[1]);
  // 照片一张一张数(第 2 张),课本照印的页码
  const printed = unit === '张' ? shown.map((s) => s.n) : [...new Set(shown.map((s) => pages.find((p) => p.n === s.n)?.printed).filter((n): n is number => typeof n === 'number'))];
  const where = printed.length ? `第 ${printed.length > 1 ? `${printed[0]}–${printed[printed.length - 1]}` : printed[0]} ${unit}` : '';
  const paras = blocks.filter((b) => b.kind === 'para' && seen(b.refs)).map((b) => b.no!);
  // 数学:例几、栏目;栏目名没露出来、只露出下面的题,说是哪个栏目第几题
  const named = blocks.filter((b) => (b.kind === 'section' || b.kind === 'example') && seen(b.refs)).map((b) => (b.kind === 'example' ? `例${b.no}` : b.head!));
  const probs = new Map<string, number[]>();
  for (const b of blocks) if (b.kind === 'problem' && seen(b.refs, b) && !named.includes(b.head ?? '')) probs.set(b.head ?? '', [...(probs.get(b.head ?? '') ?? []), b.no!]);
  const qs = [...probs].map(([h, ns]) => `${h}第 ${ns.length > 1 ? `${ns[0]}–${ns[ns.length - 1]}` : ns[0]} 题`);
  const secs = [...new Set(named), ...qs];
  const others = blocks.filter((b) => b.kind === 'other' && seen(b.refs)).length;
  const parts = [paras.length ? `第 ${paras.length > 1 ? `${paras[0]}–${paras[paras.length - 1]}` : paras[0]} 段` : '', secs.join('、'), others && !paras.length && !secs.length ? '课文后面的部分' : ''].filter(Boolean);
  return [where, parts.join(',')].filter(Boolean).join(':') || '空白处';
}

/** 「59-60」「59」→ [59, 60] */
export function bookPages(v: string | undefined): number[] {
  const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec((v ?? '').trim());
  if (!m) return [];
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  if (b < a || b - a >= BOOK_MAX_PAGES) return [];
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
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

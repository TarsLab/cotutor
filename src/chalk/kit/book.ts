/**
 * 课本:vault 里的教材 PDF 做底(2026-11-14《语文预习:PDF 课本与镜头交互》)。一课的几页竖着排成一长条,屏幕是看它的一扇窗:
 * 老师说看哪里(`看: 第 6–7 段`、`看: 日积月累`、`看: 小鸟回答说`),应用照课本的索引算出那一块在哪、窗移过去;孩子用手指拖、捏着放大,Apple Pencil 写画。
 * 字的位置来自 PDF 的文字层(src/memory/textbook-index.ts),不认图:圈字、遮拼音、点字都照它找,不用老师估坐标。
 *
 * 场景坐标:一页的宽是 1000,高 = 1000 × 页的高宽比;几页从上往下排,页和页之间空 BOOK_GAP。老师的记号、孩子的笔画、窗(frame)都在这套坐标里,
 * 所以窗怎么动、换几张卡,孩子画在第 55 页上的那一笔都还在那里。
 * 这个文件是纯函数:索引(BookPage)由服务端读好给进来(落板之前换框、上下文包)或舞台拉来(点字)。
 */

import type { BookLesson, BookLine, BookPage } from '../../schema/index.ts';
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

const bare = (s: string): string => s.replace(/[《》「」""“”\s·.。,,、::]/g, '').replace(/^第?\d{1,2}课?/, '');

/** 课名(「坐井观天」「11 坐井观天」「《语文园地八》」)→ 目录里的一项;认不出 = null。先找一模一样的,再找包含的(短的那个在长的里) */
export function findLesson(lessons: readonly BookLesson[], name: string): BookLesson | null {
  const q = bare(name);
  if (!q) return null;
  return lessons.find((l) => bare(l.title) === q) ?? lessons.find((l) => bare(l.title).includes(q) || (q.length >= 2 && q.includes(bare(l.title)) && bare(l.title).length >= 2)) ?? null;
}

// ——— 一课的结构 ———

/** 统编版语文园地里的栏目名(一行只有它、靠左):按它分节 */
export const SECTION_NAMES: readonly string[] = ['识字加油站', '字词句运用', '书写提示', '日积月累', '口语交际', '我爱阅读', '快乐读书吧', '我的发现', '展示台', '写话', '查字典', '和大人一起读', '读读写写', '读一读,记一记'];

/** 一课里的一块:标题、一段(no 从 1 起)、一个栏目(head)、别的(认字栏、写字栏、课后题、注释) */
export interface BookBlock {
  kind: 'title' | 'para' | 'section' | 'other';
  no?: number;
  head?: string;
  text: string;
  /** 哪几行:页号 + 那一页的第几行 */
  refs: { n: number; i: number }[];
}

interface At { p: BookPage; l: BookLine; i: number }

/** 页眉(单元名)、页脚(页码、「仅供个人学习使用」)不算正文 */
const chrome = (p: BookPage, l: BookLine): boolean => (l.y1 < 45 && /单元|^\d+$/.test(l.text)) || (l.y1 > p.h - 70 && /^\d{1,3}$/.test(l.text)) || /仅供个人学习使用/.test(l.text);
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const headOf = (t: string): string | null => { const s = t.replace(/^◎/, '').replace(/\s/g, ''); return SECTION_NAMES.find((h) => h.replace(/,/g, '，') === s || h === s) ?? null; };

/**
 * 一课的结构:有栏目名(语文园地)就按栏目分;没有就找课文正文——字最多的那种字体字号、行距一样连着的一串行,跨页接着——再按缩进分自然段
 * (段首比这一栏的左边缩进一个字以上);一行都很短(诗)就一行一段。别的行(认字栏、写字栏、课后题)各成一块 other。
 */
export function lessonBlocks(pages: readonly BookPage[]): BookBlock[] {
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

/** 一段原文在哪:不管标点、空格、换行;找到第一处(给了 within 先找和它挨着的),回这几个字所在的行与字 */
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
  const all = hits.map(boxOf);
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

/**
 * 老师的「看」→ 那一块(场景坐标)与给人看的名字。认这几种写法:
 *  第 6 段 / 第 6–7 段(一课的自然段)· 第 55 页(印的页码,整页)· 栏目名(日积月累)· 标题 / 开头 · 课本上的一句原话(取它所在的几行)
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
  if (/^(标题|题目|开头|课题)$/.test(q)) {
    const t = blocks.filter((x) => x.kind === 'title' || (x.kind === 'para' && x.no === 1));
    const box = refsBox(pages, sheets, t.flatMap((x) => x.refs));
    return box ? { label: '开头', box } : null;
  }
  const sec = blocks.find((x) => x.kind === 'section' && (x.head === q || x.head!.includes(q) || (q.length >= 2 && q.includes(x.head!))));
  if (sec) { const box = refsBox(pages, sheets, sec.refs); return box ? { label: sec.head!, box } : null; }
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
  const secs = blocks.filter((b) => b.kind === 'section' && seen(b.refs)).map((b) => b.head!);
  const others = blocks.filter((b) => b.kind === 'other' && seen(b.refs)).length;
  const parts = [paras.length ? `第 ${paras.length > 1 ? `${paras[0]}–${paras[paras.length - 1]}` : paras[0]} 段` : '', secs.join('、'), others && !paras.length && !secs.length ? '课文后面的部分' : ''].filter(Boolean);
  return [where, parts.join(',')].filter(Boolean).join(':') || '空白处';
}

// ——— 画法 ———

/** 「59-60」「59」→ [59, 60] */
export function bookPages(v: string | undefined): number[] {
  const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec((v ?? '').trim());
  if (!m) return [];
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  if (b < a || b - a > 12) return [];
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
  if (!text || Array.from(text).length > 40) throw new Error('课本的「看」写一处:第 6–7 段、第 55 页、栏目名(日积月累),或课本上的一句原话');
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
  about: '课本:家长放在 vault 里的教材 PDF,一课的几页铺在板上。你说看哪里,应用把那一块移到孩子眼前;圈字、遮拼音写字,应用照课本找到它。孩子手指拖动、放大,点一个字看笔顺;用笔在上面圈、写。',
  ops: ['点字', '圈', '画', '看'],
  open: ['点字', '圈', '画'],
  params: [
    { key: '课', note: '哪一课:课名或语文园地几(课: 坐井观天)。不写就是板上现在这一课;第一次写,应用就把这一课的几页铺上。', read: (v) => v.trim().slice(0, 20), fallback: '' },
    { key: '看', note: '让孩子看哪里:第 6–7 段、第 55 页、栏目名(日积月累),或课本上的一句原话。应用把它移到屏幕中间、字太小就放大。不写就不动(孩子正看着哪里就还是哪里)。', read: readLook, fallback: '' },
    { key: '圈', note: '圈出课本上的字词:写字(圈: 井沿),应用照课本找到它。几处用顿号隔开,最多 4 处。', read: readSpots('圈', RING_MAX), fallback: '' },
    { key: '遮', note: '要孩子自己认的字词:盖住头上的拼音,孩子点一下揭开。写字,几处用顿号隔开,最多 8 处。', read: readSpots('遮', COVER_MAX), fallback: '' },
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

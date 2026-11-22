/**
 * 课本索引(纯函数):pdf.js 取出来的每页文字(PdfPage)→ BookIndex。读 PDF、存缓存在 textbook-pdf.ts。
 * 2026-11-14 照人教统编版语文二年级上册(国家中小学智慧教育平台下载的)定的规则:
 *  - 拼音是一种自造编码的字体:一个大写字母 = 带调的韵母(Q = ā,J = ǐ……,表在 PINYIN_TONES),按 2×2 的键位排:一声左上、二声右上、三声左下、四声右下。
 *    已经是标准带调字母的原样收。表里没有的大写字母不猜,记进 problems。
 *  - 拼音比字小(字号不到字的 0.75),印在字的正上方:配给下面中心对得上的那个汉字。
 *  - 同一基线、同一字号、挨着的字是一行;隔开两个字宽以上的另起一行(两栏、词语表一个词一个)。
 *  - 页码印在页脚(离页底 70pt 以内的 1–3 位数,字号不大)。
 *  - 目录不认出版社(parseToc):一行末尾是页码、前面是课名,中间有点线或空开一大截的就是一项;每一项记下它印在目录页的哪一行(孩子点它翻过去)。
 *    统编语文是两栏带点线(「11 坐井观天……54」),◎ 开头的是语文园地这类,没编号、比编号缩进的是上一课下面的一首(古诗二首 → 登鹳雀楼)。
 * 2026-11-15 照人教版数学二年级上册(同一个网站)加的:
 *  - 页脚是页码挨着单元名(「16 1～6的表内乘法」),页码取最靠页边的那个数。
 *  - 目录没有点线、课名居中:大号的单元序号(一、二……)印在左边、比课名高半行,页码在最右;没序号的是单元之间的综合实践(校园小导游)。
 *  - 单元下面再分:页里的小节标题(比正文大两成以上、「1.」起头:1.乘法的初步认识)、课题标题(比正文大一成、靠左:6的乘法口诀)。
 *    做一做、练一练这些栏目名也是这个字号,不算课题。
 */
import { BOOK_INDEX_VERSION, bodySize, mathHeading, type BookCell, type BookChar, type BookIndex, type PdfCell, type BookLayout, type BookLesson, type BookLine, type BookPage, type PdfItem, type PdfPage } from '../schema/index.ts';

/** 自造拼音字体的大写字母 → 带调的韵母 */
export const PINYIN_TONES: Readonly<Record<string, string>> = {
  Q: 'ā', W: 'á', A: 'ǎ', S: 'à',
  E: 'ē', R: 'é', D: 'ě', F: 'è',
  U: 'ī', I: 'í', J: 'ǐ', K: 'ì',
  T: 'ō', Y: 'ó', G: 'ǒ', H: 'ò',
  O: 'ū', P: 'ú', L: 'ǔ', M: 'ù',
  V: 'ǚ', C: 'ǜ',
};
const TONED = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü';
const RAW_PINYIN = new RegExp(`^[a-zA-Z${TONED}]+$`);
/** 全是大写的(封面的 YUWEN)不是拼音 */
const ALL_CAPS = /^[A-Z]{2,}$/;
/** 一个音节大致的样子(用来自检解码对不对,不求全) */
const SYLLABLE = new RegExp(`^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?[aeiouü${TONED}]{1,3}(ng|n|r)?r?$`);
const HAN = /\p{Script=Han}/u;

/** 一段拼音字体的字 → 带调的拼音;有表里没有的大写字母回 null */
export function decodePinyin(s: string): string | null {
  let out = '';
  for (const ch of s) {
    if (/[A-Z]/.test(ch)) {
      const t = PINYIN_TONES[ch];
      if (!t) return null;
      out += t;
    } else out += ch;
  }
  return out;
}

/** 字宽:汉字、全角标点一个字号宽;ASCII(数字、字母、半角标点)约半个 */
const unitOf = (c: string): number => (c.charCodeAt(0) < 0x2000 && !/[“”‘’]/.test(c) ? 0.55 : 1);

interface Glyph { c: string; x1: number; x2: number; y: number; z: number; f: string }

/** 一段字拆成一个一个字,照字宽分它的宽;空格占剩下的 */
export function splitItem(i: PdfItem): Glyph[] {
  const cs = Array.from(i.s);
  const want = cs.reduce((a, c) => a + (c.trim() ? unitOf(c) : 0), 0);
  const spaces = cs.filter((c) => !c.trim()).length;
  let unit = i.z;
  let gap = spaces ? Math.max(0, (i.w - want * unit) / spaces) : 0;
  if (want * unit > i.w + 0.5 && want > 0) { unit = i.w / want; gap = 0; }
  const out: Glyph[] = [];
  let x = i.x;
  for (const c of cs) {
    if (!c.trim()) { x += gap; continue; }
    const w = unitOf(c) * unit;
    out.push({ c, x1: x, x2: x + w, y: i.y, z: i.z, f: i.f });
    x += w;
  }
  return out;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** 一页的字分成行,拼音配到字上;解不出的拼音记进 bad */
export function pageLines(page: PdfPage, bad: string[] = []): BookLine[] {
  const items = page.items.filter((i) => i.s.trim());
  const hanZ = items.filter((i) => HAN.test(i.s)).map((i) => i.z).sort((a, b) => a - b);
  const med = hanZ.length ? hanZ[Math.floor(hanZ.length / 2)] : 12;
  const isPy = (i: PdfItem): boolean => RAW_PINYIN.test(i.s.trim()) && !ALL_CAPS.test(i.s.trim()) && i.z < 0.75 * Math.max(med, i.z * 1.4);
  const pys = items.filter(isPy);
  const glyphs = items.filter((i) => !isPy(i)).flatMap(splitItem).sort((a, b) => a.y - b.y || a.x1 - b.x1);
  // 先归条带:基线差不到字号的 0.35、字号差不到三成(目录的点线比字高几个点,也归进来);
  // 条带里从左到右排,隔开两个字宽以上的切开另成一行
  const bands: { y: number; z: number; g: Glyph[] }[] = [];
  for (const g of glyphs) {
    const band = bands.find((b) => Math.abs(b.y - g.y) < 0.35 * Math.min(b.z, g.z) && Math.abs(b.z - g.z) < 0.3 * b.z);
    if (band) band.g.push(g); else bands.push({ y: g.y, z: g.z, g: [g] });
  }
  const rows: Glyph[][] = [];
  for (const b of bands) {
    const gs = [...b.g].sort((p, q) => p.x1 - q.x1);
    let cur: Glyph[] = [];
    for (const g of gs) {
      if (cur.length && g.x1 - cur[cur.length - 1].x2 > 2 * Math.max(g.z, b.z)) { rows.push(cur); cur = []; }
      cur.push(g);
    }
    if (cur.length) rows.push(cur);
  }
  const lines: BookLine[] = rows.map((gs) => {
    // 这一行的基线:汉字的基线(中位数);没有汉字取全部的
    const ys = (gs.some((g) => HAN.test(g.c)) ? gs.filter((g) => HAN.test(g.c)) : gs).map((g) => g.y).sort((a, b) => a - b);
    const y = ys[Math.floor(ys.length / 2)];
    const z = Math.max(...gs.map((g) => g.z));
    return {
      text: gs.map((g) => g.c).join(''),
      x1: r2(gs[0].x1),
      x2: r2(gs[gs.length - 1].x2),
      y1: r2(y - 0.88 * z),
      y2: r2(y + 0.12 * z),
      z,
      f: gs[0].f,
      chars: gs.map((g): BookChar => ({ c: g.c, x1: r2(g.x1), x2: r2(g.x2) })),
    };
  });
  // 拼音:字的正上方,中心对得上(差不到字号的 0.6),基线在字的基线上面两个字号以内
  for (const p of pys) {
    const raw = p.s.trim();
    const py = decodePinyin(raw);
    if (!py || !SYLLABLE.test(py)) { bad.push(raw); continue; }
    const cx = p.x + p.w / 2;
    let best: { ch: BookChar; d: number } | null = null;
    for (const l of lines) {
      const base = l.y2 - 0.12 * l.z;
      const dy = base - p.y;
      if (dy <= 0 || dy > 2.2 * l.z || p.z >= 0.75 * l.z) continue;
      for (const ch of l.chars) {
        if (!HAN.test(ch.c) || ch.py) continue;
        const d = Math.abs((ch.x1 + ch.x2) / 2 - cx) + dy * 0.01;
        if (Math.abs((ch.x1 + ch.x2) / 2 - cx) < 0.6 * l.z && (!best || d < best.d)) best = { ch, d };
      }
    }
    if (best) best.ch.py = py;
  }
  return lines.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
}

/** 页脚的页码:离页底 70pt 以内、1–3 位的数、字号不大;页脚还印着单元名的(「16 1～6的表内乘法」),取最靠页边的那个 */
export function printedOf(page: PdfPage): number | null {
  const edge = (i: PdfItem): number => Math.min(i.x, page.w - (i.x + i.w));
  const hit = page.items.filter((i) => /^\d{1,3}$/.test(i.s.trim()) && i.y > page.h - 70 && i.z <= 16).sort((a, b) => edge(a) - edge(b))[0];
  return hit ? Number(hit.s.trim()) : null;
}

const UNIT = /^第.{1,3}单元/;
/** 课名和页码之间的点线 */
const LEADER = /^[.．·…‥・]$/;
const DIGIT = /^\d$/;
/** 大号的单元序号(人教数学的一、二……);一两位数的也算 */
const BIG_MARK = /^(?:[一二三四五六七八九十]{1,3}|\d{1,2})$/;
const HEADING = /^(?:目录|contents)$/i;
const flat = (s: string): string => s.replace(/\s+/g, '');

type TocBox = [number, number, number, number];

/** 目录里读出的一项(还没算到哪一页止);depth:0 = 一课、一个单元,往下一层加一(没写:有 parent 是 1);at = 印在目录哪一页的哪一行(PDF 的点) */
interface TocRow { title: string; unit: string | null; no: string | null; kind: BookLesson['kind']; parent?: string; from: number; depth?: number; at?: { n: number; box: TocBox } }

/** 目录页上的一行:同一栏里基线差不到半个字号的字(点线比字偏几个点、页码字号小,都归进来),从左到右 */
interface TocLine { g: Glyph[]; y: number; text: string }

/** 认成一项的一行:序号(◎、隔开的编号)、课名、页码;tx 是课名从哪起、到哪止 */
interface TocHit { line: TocLine; mark: string | null; title: string; from: number; tx: number; tx2: number; z: number }

const glyphBox = (g: Glyph): TocBox => [g.x1, g.y - 0.88 * g.z, g.x2, g.y + 0.12 * g.z];
const boxOf = (gs: readonly Glyph[]): TocBox => { const bs = gs.map(glyphBox); return [r2(Math.min(...bs.map((b) => b[0]))), r2(Math.min(...bs.map((b) => b[1]))), r2(Math.max(...bs.map((b) => b[2]))), r2(Math.max(...bs.map((b) => b[3])))]; };

function tocLines(glyphs: readonly Glyph[]): TocLine[] {
  const rows: { y: number; z: number; g: Glyph[] }[] = [];
  for (const g of [...glyphs].sort((a, b) => a.y - b.y)) {
    const row = rows.find((r) => Math.abs(r.y - g.y) < 0.5 * Math.min(r.z, g.z));
    if (row) row.g.push(g); else rows.push({ y: g.y, z: g.z, g: [g] });
  }
  return rows.map((r) => { const g = r.g.sort((a, b) => a.x1 - b.x1); return { g, y: r.y, text: g.map((x) => x.c).join('') }; });
}

/**
 * 一行是不是目录的一项:末尾是 1–3 位的页码,前面是课名(有汉字或字母);课名和页码之间有点线,或者空开一个半字号以上。
 * 序号:开头的 ◎,或开头隔开的一两位数(「11 坐井观天」;「1～6 的表内乘法」的 1 和后面挨着,是课名的一部分)
 */
function tocHit(line: TocLine): TocHit | null {
  const gs = line.g;
  let k = gs.length;
  while (k > 0 && DIGIT.test(gs[k - 1].c)) k--;
  const digits = gs.length - k;
  if (!digits || digits > 3) return null;
  let j = k;
  while (j > 0 && LEADER.test(gs[j - 1].c)) j--;
  const body = gs.slice(0, j);
  if (!body.length) return null;
  const z = Math.max(...body.map((g) => g.z));
  if (k - j < 3 && gs[k].x1 - body[body.length - 1].x2 < 1.5 * z) return null;
  let i = 0;
  let mark: string | null = null;
  if (body[0].c === '◎') { mark = '◎'; i = 1; }
  else {
    let d = 0;
    while (d < body.length && d < 2 && DIGIT.test(body[d].c)) d++;
    if (d && d < body.length && body[d].x1 - body[d - 1].x2 > 0.4 * z) { mark = body.slice(0, d).map((g) => g.c).join(''); i = d; }
  }
  const words = body.slice(i);
  const title = words.map((g) => g.c).join('').replace(/[.．·…]+$/, '');
  if (!words.length || !(HAN.test(title) || /[A-Za-z]/.test(title))) return null;
  return { line, mark, title, from: Number(gs.slice(k).map((g) => g.c).join('')), tx: words[0].x1, tx2: words[words.length - 1].x2, z };
}

/** 一页上可能的分栏:整页一栏;页的中间三分之一里有一道竖着的空(一个半字号宽以上,所有字都不过)就从那里分左右两栏 */
function tocSplits(page: PdfPage, glyphs: readonly Glyph[]): Glyph[][][] {
  const one = [[...glyphs]];
  if (!glyphs.length) return [one];
  const zs = glyphs.map((g) => g.z).sort((a, b) => a - b);
  const want = 1.5 * zs[Math.floor(zs.length / 2)];
  const spans = glyphs.map((g) => [g.x1, g.x2] as [number, number]).sort((a, b) => a[0] - b[0]);
  let best: [number, number] | null = null;
  let reach = spans[0][1];
  for (const [a, b] of spans.slice(1)) {
    const mid = (reach + a) / 2;
    if (a - reach >= want && mid > page.w / 3 && mid < (2 * page.w) / 3 && (!best || a - reach > best[1] - best[0])) best = [reach, a];
    reach = Math.max(reach, b);
  }
  if (!best) return [one];
  const cut = (best[0] + best[1]) / 2;
  return [one, [glyphs.filter((g) => (g.x1 + g.x2) / 2 < cut), glyphs.filter((g) => (g.x1 + g.x2) / 2 >= cut)]];
}

/** 读一页目录:一栏一栏、从上到下的项;大号的单元序号单独成行的,配给它右边差不多高的那一项 */
function tocPage(page: PdfPage): { cols: { lines: TocLine[]; hits: Map<TocLine, TocHit>; marks: Map<TocLine, Glyph[]> }[]; count: number } {
  const glyphs = page.items.filter((i) => i.s.trim()).flatMap(splitItem);
  let best: ReturnType<typeof tocPage> = { cols: [], count: 0 };
  for (const split of tocSplits(page, glyphs)) {
    const cols = split.map((gs) => {
      const lines = tocLines(gs).filter((l) => !HEADING.test(flat(l.text)));
      const hits = new Map<TocLine, TocHit>();
      for (const l of lines) { const h = tocHit(l); if (h) hits.set(l, h); }
      const marks = new Map<TocLine, Glyph[]>();
      for (const l of lines) {
        if (hits.has(l) || !BIG_MARK.test(flat(l.text))) continue;
        const right = l.g[l.g.length - 1].x2;
        const near = [...hits.values()].filter((h) => h.line.g[0].x1 > right && Math.abs(h.line.y - l.y) < 1.2 * h.z && !marks.has(h.line)).sort((a, b) => Math.abs(a.line.y - l.y) - Math.abs(b.line.y - l.y))[0];
        if (near) marks.set(near.line, l.g);
      }
      return { lines: lines.filter((l) => hits.has(l) || ![...marks.values()].includes(l.g)), hits, marks };
    });
    const count = cols.reduce((n, c) => n + c.hits.size, 0);
    if (count > best.count) best = { cols, count };
  }
  return best;
}

/** 印的页码照读的顺序不往回走(一栏一栏、从上到下) */
const ordered = (p: ReturnType<typeof tocPage>): number[] => p.cols.flatMap((c) => c.lines.flatMap((l) => (c.hits.has(l) ? [c.hits.get(l)!.from] : [])));
const rising = (xs: readonly number[]): boolean => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

/**
 * 目录页:一页上三项以上、页码照读的顺序不往回走的,是目录的第一页;紧跟着的页有两项以上、页码接得上的也是。
 * 不认出版社:点线可有可无,一栏两栏都行(分不分栏照哪样认出的项多),序号是 ◎、隔开的编号,或单独印在左边的大号一、二。
 *  - 不带页码的行:「第一单元」这样的是单元;◎ 起头的是下一项的前半(◎ 快乐读书吧 / 读读童话故事……15)
 *  - 没序号的:课名左对齐的目录里比这一栏缩进的是上一课下面的一首(古诗二首 → 登鹳雀楼),不缩进的是附录(识字表,other);
 *    课名居中的目录(人教数学)不看缩进,没序号的是单元之间的综合实践(校园小导游,garden)
 */
export function parseToc(pages: readonly PdfPage[]): { rows: TocRow[]; pages: number[] } {
  const read: { n: number; p: ReturnType<typeof tocPage> }[] = [];
  for (const pg of pages) {
    const p = tocPage(pg);
    const nums = ordered(p);
    const prev = read.length ? ordered(read[read.length - 1].p) : [];
    if (read.length) {
      if (pg.n !== read[read.length - 1].n + 1 || p.count < 2 || !rising(nums) || nums[0] < prev[prev.length - 1]) break;
      read.push({ n: pg.n, p });
    } else if (p.count >= 3 && rising(nums)) read.push({ n: pg.n, p });
  }
  const out: TocRow[] = [];
  let unit: string | null = null;
  let prefix: { title: string; g: Glyph[] } | null = null;
  let lastLesson: string | null = null;
  for (const { n, p } of read) {
    for (const col of p.cols) {
      if (!col.lines.length) continue;
      const base = Math.min(...col.lines.map((l) => l.g[0].x1));
      const hs = [...col.hits.values()];
      const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
      const centered = hs.length >= 3 && spread(hs.map((h) => (h.tx + h.tx2) / 2)) < 0.5 * spread(hs.map((h) => h.tx));
      for (const l of col.lines) {
        const t = flat(l.text);
        const h = col.hits.get(l);
        if (!h) {
          if (UNIT.test(t)) { unit = t; lastLesson = null; }
          else if (t.startsWith('◎')) prefix = { title: t.replace(/^◎/, ''), g: l.g };
          continue;
        }
        const big = col.marks.get(l);
        const at = { n, box: boxOf([...l.g, ...(big ?? []), ...(prefix?.g ?? [])]) };
        const title = h.title;
        if (prefix) { out.push({ title: `${prefix.title} ${title}`, unit, no: null, kind: 'garden', from: h.from, at }); prefix = null; lastLesson = null; continue; }
        if (h.mark === '◎') { out.push({ title, unit, no: null, kind: 'garden', from: h.from, at }); lastLesson = null; continue; }
        const no = big ? flat(big.map((g) => g.c).join('')) : h.mark;
        if (no) { out.push({ title, unit, no, kind: 'lesson', from: h.from, at }); lastLesson = title; continue; }
        if (!centered && lastLesson && l.g[0].x1 - base > 0.8 * h.z) { out.push({ title, unit, no: null, kind: 'lesson', parent: lastLesson, from: h.from, at }); continue; }
        out.push({ title, unit: null, no: null, kind: centered ? 'garden' : 'other', from: h.from, at });
        lastLesson = null;
      }
    }
  }
  return { rows: out, pages: read.map((x) => x.n) };
}

/**
 * 数学课本:目录只到单元,单元下面的小节、课题从页里的标题读出来,插在目录的单元后面(parent 是上一层)。
 * 和目录里的一项同名的标题(综合实践翻页后又印一次的)不算。
 */
function mathRows(top: readonly TocRow[], pages: readonly BookPage[]): TocRow[] {
  const starts = top.map((r) => ({ r, n: pdfPageOf(pages, r.from) })).filter((x): x is { r: TocRow; n: number } => x.n !== null);
  const names = new Set(top.map((r) => r.title));
  const out: TocRow[] = [];
  let cur: TocRow | null = null;
  let section: TocRow | null = null;
  // 正文字号照整本算:一页里正文少(口诀表、插图页),课题自己就成了那一页字最多的
  const body = bodySize(pages.flatMap((p) => p.lines));
  for (const p of pages) {
    const owner = [...starts].reverse().find((x) => x.n <= p.n)?.r ?? null;
    if (owner !== cur) { cur = owner; section = null; if (owner) out.push({ ...owner, depth: 0 }); }
    if (!cur || p.printed === null) continue;
    for (const l of p.lines) {
      const kind = mathHeading(l, p.w, body);
      if (!kind || names.has(l.text)) continue;
      names.add(l.text);
      if (kind === 'section') { section = { title: l.text, unit: cur.title, no: null, kind: 'lesson', parent: cur.title, from: p.printed, depth: 1 }; out.push(section); continue; }
      out.push({ title: l.text, unit: cur.title, no: null, kind: 'lesson', parent: (section ?? cur).title, from: p.printed, depth: section ? 2 : 1 });
    }
  }
  // 目录里有、页码对不上 PDF 的,照原样留着(算页时会被丢掉)
  for (const r of top) if (!starts.some((x) => x.r === r)) out.push({ ...r, depth: 0 });
  return out;
}

/** 印刷页码 → PDF 页:页脚读到的直接用;没读到的(插图页)照最近读到的那页推 */
export function pdfPageOf(pages: readonly Pick<BookPage, 'n' | 'printed'>[], printed: number): number | null {
  const hit = pages.find((p) => p.printed === printed);
  if (hit) return hit.n;
  let near: Pick<BookPage, 'n' | 'printed'> | null = null;
  for (const p of pages) if (p.printed !== null && (!near || Math.abs(p.printed - printed) < Math.abs(near.printed! - printed))) near = p;
  if (!near) return null;
  const n = near.n + (printed - near.printed!);
  return n >= 1 && n <= pages.length ? n : null;
}

/** 目录项算出止于哪一页:到下一项(不是自己下面的)的前一页;最后一项到最后一页印了页码的 */
function lessonsOf(rows: readonly TocRow[], pages: readonly BookPage[]): BookLesson[] {
  const lastPrinted = Math.max(0, ...pages.map((p) => p.printed ?? 0));
  const depth = (r: TocRow): number => r.depth ?? (r.parent ? 1 : 0);
  const out: BookLesson[] = [];
  rows.forEach((r, i) => {
    const next = rows.slice(i + 1).find((x) => depth(x) <= depth(r));
    const to = Math.max(r.from, next ? next.from - 1 : lastPrinted);
    const a = pdfPageOf(pages, r.from), b = pdfPageOf(pages, to);
    if (a === null || b === null) return;
    out.push({ title: r.title, unit: r.unit, no: r.no, kind: r.kind, ...(r.parent ? { parent: r.parent } : {}), from: r.from, to, pages: [a, b], ...(r.at ? { toc: r.at } : {}) });
  });
  return out;
}

/**
 * 页上的田字格分成范字、描红、空格,每格记下照着写的那个字:一排(上沿差 3pt 以内)从左往右,空格照它左边最近的范字;
 * 描红照它自己的字。同一排隔开的两组(转 转 □ □ 夹 夹 □ □)各照各的
 */
export function bookCells(raw: readonly PdfCell[]): BookCell[] {
  const sorted = [...raw].sort((a, b) => (Math.abs(a.y1 - b.y1) > 3 ? a.y1 - b.y1 : a.x1 - b.x1));
  const out: BookCell[] = [];
  let row = -Infinity, model: string | undefined;
  for (const c of sorted) {
    if (Math.abs(c.y1 - row) > 3) { row = c.y1; model = undefined; }
    const kind: BookCell['kind'] = !c.ch ? 'empty' : c.red ? 'trace' : 'model';
    if (kind === 'model') model = c.ch;
    const m = kind === 'empty' ? model : c.ch;
    out.push({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, kind, ...(c.ch ? { ch: c.ch } : {}), ...(m ? { m } : {}) });
  }
  return out;
}

/**
 * 页上的填空(docs/artifact/页上记号/规范.html 的 R5a、R5b,2026-11-22 拿人教数学二上核实):
 *  算式里的空:描边的空方框(框里没字),左边紧挨着以 = × + − ÷ → 收尾的字,或右边紧挨着以 = × + − ÷ 起头的字(7×□=□ 一串都中);
 *    和别的框共用一条边的是表格的格,不算(口诀表、数轴下面的框分不清,先不做)。
 *  空着的括号:一段字以「(」收尾、同一条基线上紧接着的下一段以「)」起头,中间空着(至少半个字宽);「(1)」这种编号里面有字(字单独一段也算),不算。
 */
export function blankCells(p: Pick<PdfPage, 'items' | 'boxes'>): BookCell[] {
  const items = p.items, boxes = p.boxes ?? [];
  const out: BookCell[] = [];
  const mid = (it: PdfItem): number => it.y - it.z * 0.35;
  const touch = (a: readonly number[], b: readonly number[]): boolean => ((Math.abs(a[2] - b[0]) < 1.5 || Math.abs(a[0] - b[2]) < 1.5) && Math.abs(a[1] - b[1]) < 1.5) || ((Math.abs(a[3] - b[1]) < 1.5 || Math.abs(a[1] - b[3]) < 1.5) && Math.abs(a[0] - b[0]) < 1.5);
  for (const b of boxes) {
    if (items.some((it) => it.x < b[2] - 2 && it.x + it.w > b[0] + 2 && it.y > b[1] + 2 && it.y - it.z * 0.7 < b[3] - 2)) continue;
    if (boxes.some((o) => o !== b && touch(b, o))) continue;
    const cy = (b[1] + b[3]) / 2;
    const row = items.filter((it) => Math.abs(mid(it) - cy) < 8);
    const left = row.some((it) => it.x + it.w <= b[0] + 3 && it.x + it.w > b[0] - 30 && /[=＝×+\-－÷→]\s*$/.test(it.s));
    const right = row.some((it) => it.x >= b[2] - 3 && it.x < b[2] + 30 && /^\s*[=＝×+\-－÷]/.test(it.s));
    if (left || right) out.push({ x1: b[0], y1: b[1], x2: b[2], y2: b[3], kind: 'blank' });
  }
  for (const it of items) {
    if (!/[（(]\s*$/.test(it.s)) continue;
    const end = it.x + it.w;
    const close = items.find((o) => o !== it && Math.abs(o.y - it.y) < 1 && o.x >= end - 1 && o.x - end < it.z * 8 && /^\s*[）)]/.test(o.s));
    if (!close || close.x - end < it.z * 0.5) continue;
    // 括号中间另有一段字(「(1)」的 1 单独一段):不是空的
    if (items.some((o) => o !== it && o !== close && Math.abs(o.y - it.y) < it.z * 0.6 && o.x < close.x - 1 && o.x + o.w > end + 1)) continue;
    out.push({ x1: r2(end), y1: r2(it.y - it.z * 0.9), x2: r2(close.x), y2: r2(it.y + it.z * 0.2), kind: 'blank' });
  }
  return out;
}

/** 整本:每页分行、读页码、认田字格和填空,读目录,自检 */
/** 一册怎么分块:文件名带「数学」的是 math */
export const layoutOf = (title: string): BookLayout => (title.includes('数学') ? 'math' : 'prose');

export function buildBookIndex(raw: readonly PdfPage[], meta: { file: string; sha: string; title: string }): BookIndex {
  const bad: string[] = [];
  const pages: BookPage[] = raw.map((p) => {
    const cells = [...bookCells(p.cells ?? []), ...blankCells(p)].sort((a, b) => (Math.abs(a.y1 - b.y1) > 3 ? a.y1 - b.y1 : a.x1 - b.x1));
    return { n: p.n, printed: printedOf(p), w: r2(p.w), h: r2(p.h), lines: pageLines(p, bad), ...(cells.length ? { cells } : {}) };
  });
  const toc = parseToc(raw);
  const layout = layoutOf(meta.title);
  const lessons = lessonsOf(layout === 'math' ? mathRows(toc.rows, pages) : toc.rows, pages);
  const decoded = pages.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.chars.filter((c) => c.py).length, 0), 0);
  const problems: string[] = [];
  const chars = pages.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.chars.length, 0), 0);
  if (chars < raw.length * 20) problems.push('这个 PDF 里几乎没有文字(多半是扫描的图),读不出字的位置');
  if (!pages.some((p) => p.printed !== null)) problems.push('没读到页脚的页码');
  if (!lessons.length) problems.push('没读到目录');
  // 零星几处(儿化单印的 r)不算;多了多半是换了一种拼音字体,点读、遮拼音会不准
  if (bad.length > Math.max(5, decoded * 0.01)) problems.push(`有 ${bad.length} 处拼音解不出(如 ${[...new Set(bad)].slice(0, 5).join('、')})`);
  return { v: BOOK_INDEX_VERSION, file: meta.file, sha: meta.sha, title: meta.title, layout, pages, toc: toc.pages, lessons, problems };
}

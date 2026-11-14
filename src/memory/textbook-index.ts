/**
 * 课本索引(纯函数):pdf.js 取出来的每页文字(PdfPage)→ BookIndex。读 PDF、存缓存在 textbook-pdf.ts。
 * 2026-11-14 照人教统编版语文二年级上册(国家中小学智慧教育平台下载的)定的规则:
 *  - 拼音是一种自造编码的字体:一个大写字母 = 带调的韵母(Q = ā,J = ǐ……,表在 PINYIN_TONES),按 2×2 的键位排:一声左上、二声右上、三声左下、四声右下。
 *    已经是标准带调字母的原样收。表里没有的大写字母不猜,记进 problems。
 *  - 拼音比字小(字号不到字的 0.75),印在字的正上方:配给下面中心对得上的那个汉字。
 *  - 同一基线、同一字号、挨着的字是一行;隔开两个字宽以上的另起一行(两栏、词语表一个词一个)。
 *  - 页码印在页脚(离页底 70pt 以内的 1–3 位数,字号不大)。
 *  - 目录:带点线的行(「11 坐井观天……54」);◎ 开头的是语文园地这类;没编号、比编号缩进的是上一课下面的一首(古诗二首 → 登鹳雀楼)。
 */
import { BOOK_INDEX_VERSION, type BookChar, type BookIndex, type BookLesson, type BookLine, type BookPage, type PdfItem, type PdfPage } from '../schema/index.ts';

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

/** 页脚的页码:离页底 70pt 以内、1–3 位的数、字号不大 */
export function printedOf(page: PdfPage): number | null {
  const hit = page.items.find((i) => /^\d{1,3}$/.test(i.s.trim()) && i.y > page.h - 70 && i.z <= 16);
  return hit ? Number(hit.s.trim()) : null;
}

const UNIT = /^第.{1,3}单元/;
const ENTRY = /^(◎|\d{1,2})?\s*(.+?)\s*[.．·…]{3,}\s*(\d{1,3})$/;

/** 目录里读出的一项(还没算到哪一页止) */
interface TocRow { title: string; unit: string | null; no: string | null; kind: BookLesson['kind']; parent?: string; from: number }

/**
 * 目录页的一栏一栏:按页的中线分左右两栏,栏里按基线归行(点线比字偏几个点,容差放宽到半个字号),不按空隙切。
 * 正文分行的规则(pageLines)在这里不合用:点线和课名不在一条基线上,两栏挨得近会并成一行。
 */
function tocColumns(page: PdfPage): { x1: number; text: string }[][] {
  const glyphs = page.items.filter((i) => i.s.trim()).flatMap(splitItem);
  return [0, 1].map((col) => {
    const gs = glyphs.filter((g) => (g.x1 < page.w / 2 ? 0 : 1) === col).sort((a, b) => a.y - b.y);
    const rows: { y: number; g: Glyph[] }[] = [];
    for (const g of gs) {
      const row = rows.find((r) => Math.abs(r.y - g.y) < 0.5 * g.z);
      if (row) row.g.push(g); else rows.push({ y: g.y, g: [g] });
    }
    return rows.map((r) => { const s = r.g.sort((a, b) => a.x1 - b.x1); return { x1: s[0].x1, text: s.map((g) => g.c).join('') }; });
  });
}

/** 目录页:有两行以上带点线的页。一栏一栏、从上到下读 */
export function parseToc(pages: readonly PdfPage[]): { rows: TocRow[]; pages: number[] } {
  const out: TocRow[] = [];
  const at: number[] = [];
  let unit: string | null = null;
  let prefix: string | null = null;
  let lastLesson: string | null = null;
  for (const pg of pages) {
    const cols = tocColumns(pg);
    if (cols.flat().filter((l) => ENTRY.test(l.text)).length < 2) continue;
    at.push(pg.n);
    for (const col of cols) {
      const lines = col.filter((l) => l.text !== '目录');
      if (!lines.length) continue;
      const base = Math.min(...lines.map((l) => l.x1));
      for (const l of lines) {
        const t = l.text.trim();
        if (UNIT.test(t) && !ENTRY.test(t)) { unit = t; lastLesson = null; continue; }
        const m = ENTRY.exec(t);
        if (!m) {
          // ◎ 快乐读书吧(下一行才是带点线的「读读童话故事」)
          if (t.startsWith('◎')) prefix = t.replace(/^◎\s*/, '');
          continue;
        }
        const mark = m[1] ?? null;
        let title = m[2].replace(/\s+/g, '').replace(/[.．·…]+$/, '');
        const from = Number(m[3]);
        if (prefix) { title = `${prefix} ${title}`; prefix = null; out.push({ title, unit, no: null, kind: 'garden', from }); lastLesson = null; continue; }
        if (mark === '◎') { out.push({ title, unit, no: null, kind: 'garden', from }); lastLesson = null; continue; }
        if (mark) { out.push({ title, unit, no: mark, kind: 'lesson', from }); lastLesson = title; continue; }
        // 没编号:比这一栏的左边缩进的是上一课下面的一首;不缩进的是附录(识字表)
        if (lastLesson && l.x1 - base > 12) out.push({ title, unit, no: null, kind: 'lesson', parent: lastLesson, from });
        else { out.push({ title, unit: null, no: null, kind: 'other', from }); lastLesson = null; }
      }
    }
  }
  return { rows: out, pages: at };
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

/** 目录项算出止于哪一页:到下一项(不是自己下面的一首)的前一页;最后一项到最后一页印了页码的 */
function lessonsOf(rows: readonly TocRow[], pages: readonly BookPage[]): BookLesson[] {
  const lastPrinted = Math.max(0, ...pages.map((p) => p.printed ?? 0));
  const out: BookLesson[] = [];
  rows.forEach((r, i) => {
    const next = rows.slice(i + 1).find((x) => (r.parent ? true : x.parent !== r.title));
    const to = Math.max(r.from, next ? next.from - 1 : lastPrinted);
    const a = pdfPageOf(pages, r.from), b = pdfPageOf(pages, to);
    if (a === null || b === null) return;
    out.push({ title: r.title, unit: r.unit, no: r.no, kind: r.kind, ...(r.parent ? { parent: r.parent } : {}), from: r.from, to, pages: [a, b] });
  });
  return out;
}

/** 整本:每页分行、读页码,读目录,自检 */
export function buildBookIndex(raw: readonly PdfPage[], meta: { file: string; sha: string; title: string }): BookIndex {
  const bad: string[] = [];
  const pages: BookPage[] = raw.map((p) => ({ n: p.n, printed: printedOf(p), w: r2(p.w), h: r2(p.h), lines: pageLines(p, bad) }));
  const toc = parseToc(raw);
  const lessons = lessonsOf(toc.rows, pages);
  const decoded = pages.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.chars.filter((c) => c.py).length, 0), 0);
  const problems: string[] = [];
  const chars = pages.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.chars.length, 0), 0);
  if (chars < raw.length * 20) problems.push('这个 PDF 里几乎没有文字(多半是扫描的图),读不出字的位置');
  if (!pages.some((p) => p.printed !== null)) problems.push('没读到页脚的页码');
  if (!lessons.length) problems.push('没读到目录');
  // 零星几处(儿化单印的 r)不算;多了多半是换了一种拼音字体,点读、遮拼音会不准
  if (bad.length > Math.max(5, decoded * 0.01)) problems.push(`有 ${bad.length} 处拼音解不出(如 ${[...new Set(bad)].slice(0, 5).join('、')})`);
  return { v: BOOK_INDEX_VERSION, file: meta.file, sha: meta.sha, title: meta.title, pages, toc: toc.pages, lessons, problems };
}

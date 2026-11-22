/**
 * 课本书后的词语表、写字表:一课一行,听写从这里挑(/api/dictation/book,听写页的「选一课」)。只读索引里的文字层,不认图。
 *
 * 照人教统编语文二上排的(2026-11-22 量过真书):
 *   - 表头「词语表」「写字表」、栏名「阅读」「识字」一行一个;页码、「(共236个词)」这种不要。
 *   - 一课一行,行首是课的编号(1、17),后面是词;一行放不下,接着的一行缩进、没有编号。
 *   - 词语表里词和词之间空一个字宽(16pt 的字空 16pt),一个词里的字挨着(空 0);编号和第一个词之间空不到一个字宽(12.9 或 16)。
 *     所以照字和字之间的空切词:空过字号的三成就是下一个词。写字表一个字一项。
 *   - 写字表里语文园地的字和「语文园地一」印在同一排,字在右边、行比它高一点(字号大),读出来的行序在「语文园地一」前面;
 *     照上下位置认:和园地那行竖着重叠的那行就是它的字,不当上一课的接续。
 * 编号照栏各自起(阅读 1–3,识字 1–4,阅读 4…),所以一课 = 栏 + 编号,对目录里单元名带这个栏、编号一样的那一课。
 */
import type { BookIndex, BookLesson, BookLine } from '../schema/index.ts';

export interface WordRow {
  /** 栏 + 编号(「阅读3」「识字2」),园地是它的名字;一张表里不重 */
  key: string;
  /** 这一课在哪一栏;没有栏的书、园地 = null */
  sec: string | null;
  /** 印的编号(「3」);园地是它的名字 */
  no: string;
  /** 目录里的课名;对不上 = 编号本身 */
  lesson: string;
  /** 词语表是词,写字表是一个一个字 */
  words: string[];
  garden?: true;
}

export interface WordTable {
  title: '词语表' | '写字表';
  /** 表头那页印的页码 */
  printed: number | null;
  rows: WordRow[];
}

export interface WordTables {
  ci: WordTable | null;
  zi: WordTable | null;
}

const SECTIONS = /^(阅读|识字|课文)$/;
const GARDEN = /^语文园地[一二三四五六七八九十]+$/;
const HAN = /^\p{Script=Han}$/u;
const DIGIT = /^\d$/;

/** 一行里的词:字和字之间空过字号的三成就断开;不是汉字的(标点)丢掉。each = 一个字一项(写字表) */
function splitWords(chars: BookLine['chars'], z: number, each: boolean): string[] {
  const out: string[] = [];
  let cur = '';
  let prev: BookLine['chars'][number] | null = null;
  for (const c of chars) {
    if (!HAN.test(c.c)) { if (cur) out.push(cur); cur = ''; prev = null; continue; }
    if (each || (prev && c.x1 - prev.x2 > z * 0.3)) { if (cur) out.push(cur); cur = ''; }
    cur += c.c;
    prev = c;
  }
  if (cur) out.push(cur);
  return out;
}

const hanOnly = (l: BookLine): boolean => l.chars.length > 0 && l.chars.every((c) => HAN.test(c.c));

/** 栏 + 编号 → 目录里那一课:单元名里带这个栏的优先,没有栏的照编号找第一课 */
export function lessonOfRow(lessons: readonly BookLesson[], sec: string | null, no: string): BookLesson | null {
  const same = lessons.filter((l) => l.kind === 'lesson' && l.no === no);
  return (sec ? same.find((l) => l.unit?.includes(sec)) : null) ?? same[0] ?? null;
}

function readTable(ix: BookIndex, title: '词语表' | '写字表'): WordTable | null {
  const entry = ix.lessons.find((l) => l.kind === 'other' && l.title.replace(/\s/g, '') === title);
  if (!entry) return null;
  const pages = ix.pages.filter((p) => p.n >= entry.pages[0] && p.n <= entry.pages[1]);
  if (!pages.length) return null;
  const zi = title === '写字表';
  const rows: WordRow[] = [];
  let sec: string | null = null;
  let cur: WordRow | null = null;
  for (const page of pages) {
    const lines = page.lines;
    // 先认园地那几排:和「语文园地一」竖着重叠的汉字行是园地的字(读出来的行序可能在它前面)
    const partner = new Map<number, number>();
    lines.forEach((l, i) => {
      if (!GARDEN.test(l.text.trim())) return;
      const j = lines.findIndex((o, k) => k !== i && !partner.has(k) && hanOnly(o) && !GARDEN.test(o.text.trim()) && o.x1 > l.x2 && o.y1 < l.y2 && o.y2 > l.y1);
      partner.set(i, j);
      if (j >= 0) partner.set(j, -2);
    });
    lines.forEach((l, i) => {
      const text = l.text.trim();
      if (!text || text === title || /^[（(]共/.test(text) || /^\d+$/.test(text) || partner.get(i) === -2) return;
      if (SECTIONS.test(text)) { sec = text; cur = null; return; }
      if (GARDEN.test(text)) {
        const j = partner.get(i) ?? -1;
        const words = j >= 0 ? splitWords(lines[j].chars, lines[j].z, zi) : [];
        if (words.length) rows.push({ key: text, sec: null, no: text, lesson: text, words, garden: true });
        cur = null;
        return;
      }
      let k = 0;
      while (k < l.chars.length && DIGIT.test(l.chars[k].c)) k++;
      if (k > 0 && k <= 2) {
        const no = l.chars.slice(0, k).map((c) => c.c).join('');
        const words = splitWords(l.chars.slice(k), l.z, zi);
        if (!words.length) return;
        const key = `${sec ?? ''}${no}`;
        if (rows.some((r) => r.key === key)) { cur = null; return; }
        cur = { key, sec, no, lesson: lessonOfRow(ix.lessons, sec, no)?.title ?? no, words };
        rows.push(cur);
        return;
      }
      if (cur && hanOnly(l)) cur.words.push(...splitWords(l.chars, l.z, zi));
    });
  }
  return rows.length ? { title, printed: pages[0].printed, rows } : null;
}

/** 一册的词语表与写字表;没有(数学、没读出来)的那张 null */
export function bookWordTables(ix: BookIndex): WordTables {
  return { ci: readTable(ix, '词语表'), zi: readTable(ix, '写字表') };
}

/** 写字表的一个字听写时怎么念:同一课词语表里带这个字的第一个词(「如,如果的如」);没有就只念这个字 */
export function charSay(ch: string, ci: WordTable | null, key: string): string | undefined {
  const row = ci?.rows.find((r) => r.key === key);
  const w = row?.words.find((x) => x.length > 1 && x.includes(ch)) ?? ci?.rows.flatMap((r) => r.words).find((x) => x.length > 1 && x.includes(ch));
  return w ? `${ch},${w}的${ch}` : undefined;
}

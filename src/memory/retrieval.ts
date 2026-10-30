/**
 * 取材(《vault重构方案》§6,2026-10-30):孩子的话缺省不带工具,讲之前该查的由应用替老师查好,放进上下文包的 lookup 与 <vault-note role="lesson">。
 * 只读、确定性,只做关键词与标题匹配(不做向量检索,vault 是唯一的真相):
 *  - 生字表:孩子问到的字(「X字怎么写」「X怎么读」「“X”」这几种说法)落在这科这学期教材哪一课的 识字: / 写字: 行,或都没有
 *  - 那一课的口径:孩子提到的课(课题、第 N 课),或问到的字要会写的那一课;家长在那一节下写了 `### 口径` 就带原文
 *  - 以前讲过:最近日记里链到那一课(`[[册#节]]`)的段,最新一条的 `骨架:` 行
 * 每一样都记来源路径、hash 与为什么查它(retrieved),进这一轮的运行记录(《vault重构方案》§7)。
 * 教材的形状见《obsidian仓库设计.md》§3.3:一课一个 H2,节下 `识字:` `写字:` 行(字用空格隔开),`### 口径` 是家长写的讲法。
 */
import { textHash } from './vault-notes.ts';

export interface Lesson {
  /** 册名(教材文件名去掉 .md,wikilink 的前半) */
  book: string;
  /** H2 原文,如「课文 2 我是什么」 */
  title: string;
  recognize: string[];
  write: string[];
  /** `### 口径` 下面的原文;没有 = null */
  caliber: string | null;
}

export interface Retrieved {
  /** 相对 vault 根 */
  path: string;
  hash: string;
  why: string;
}

const HAN = '\\p{Script=Han}';
/** 孩子问字的几种说法;抓到的是要查的字词 */
const ASKS = [
  new RegExp(`(${HAN}{1,2}?)(?:这个字|字)?怎么(?:写|读|念|拼|组词)`, 'gu'),
  new RegExp(`(${HAN})字(?=的|是|不|能|要|有|怎|呢)`, 'gu'),
  new RegExp(`[「“"](${HAN}{1,4})[」”"]`, 'gu'),
];
/** 抓到了也不是在问字的 */
const NOT_WORDS = new Set(['拼音', '作文', '句子', '题目', '这题', '这道', '这个', '那个', '怎么', '这样', '那样']);

/** 孩子这句话里问到的字(去重,按出现先后,最多 6 个);没在问字 → [] */
export function askedChars(text: string): string[] {
  const out: string[] = [];
  for (const re of ASKS) {
    for (const m of text.matchAll(re)) {
      if (NOT_WORDS.has(m[1])) continue;
      for (const c of Array.from(m[1])) if (c !== '字' && !out.includes(c)) out.push(c);
    }
  }
  return out.slice(0, 6);
}

/** 读一册教材:每个 H2 一课;围栏里的不算 */
export function parseTextbook(book: string, text: string): Lesson[] {
  const out: Lesson[] = [];
  let cur: Lesson | null = null;
  let inCaliber = false;
  let fence = false;
  const caliber: string[] = [];
  const close = (): void => {
    if (cur) cur.caliber = caliber.join('\n').trim() || null;
    caliber.length = 0;
    inCaliber = false;
  };
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) { if (inCaliber) caliber.push(line); continue; }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      close();
      cur = { book, title: h2[1], recognize: [], write: [], caliber: null };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^#{1,3}\s/.test(line)) {
      inCaliber = /^###\s+口径\s*$/.test(line);
      continue;
    }
    if (inCaliber) { caliber.push(line); continue; }
    const row = /^(识字|写字)[:：]\s*(.*)$/.exec(line);
    if (row) (row[1] === '识字' ? cur.recognize : cur.write).push(...row[2].split(/\s+/).filter(Boolean));
  }
  close();
  return out;
}

/** 课题去掉「课文 2」「识字 1」这种编号后的那截(「我是什么」) */
const titleCore = (title: string): string => title.replace(/^(课文|识字|语文园地|口语交际|快乐读书吧)\s*[0-9一二三四五六七八九十]*\s*/, '').trim();

/** 孩子这句话提到的课:课题(去掉编号后至少两个字)出现在话里,或「课文 N」「第 N 课」 */
function mentioned(lessons: readonly Lesson[], text: string): Lesson[] {
  const n = /(?:课文|第)\s*([0-9]{1,2})\s*课?/.exec(text)?.[1];
  return lessons.filter((l) => {
    const core = titleCore(l.title);
    return (Array.from(core).length >= 2 && text.includes(core)) || (n !== undefined && new RegExp(`^课文\\s*${n}(?!\\d)`).test(l.title));
  });
}

/** 一个字落在哪几课、会认还是会写:「海」:课文 2 我是什么 会写 */
function charLine(c: string, lessons: readonly Lesson[], books: string): string {
  const hits = lessons.flatMap((l) => {
    const kinds = [l.recognize.includes(c) ? '会认' : '', l.write.includes(c) ? '会写' : ''].filter(Boolean);
    return kinds.length ? [`${l.title} ${kinds.join('、')}`] : [];
  });
  return hits.length ? `「${c}」:${hits.join(';')}` : `「${c}」:不在这学期的识字、写字表里(${books})`;
}

/** 日记里链到这一课的段,最新那条的 `骨架:` 行(日期新的在前找) */
function lastSteps(lesson: Lesson, diaries: readonly { path: string; date: string; text: string }[]): { line: string; from: { path: string; text: string } } | null {
  const link = `[[${lesson.book}#${lesson.title}]]`;
  for (const d of [...diaries].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    for (const block of d.text.split(/^(?=## )/m).reverse()) {
      if (!block.includes(link)) continue;
      const steps = /^骨架[:：]\s*(.+)$/m.exec(block)?.[1];
      if (steps) return { line: `以前讲过「${lesson.title}」(${d.date}):骨架:${steps}`, from: d };
    }
  }
  return null;
}

/**
 * 这一轮替老师查的:query = 孩子这句话(加首页按钮的讲法);textbooks = 这科这学期的教材(cotutor: textbook);diaries = 最近的日记。
 * lines 进上下文包的 lookup;caliber 是要带原文的口径(没有 = null);retrieved 记来源。什么都没查到 → 全空
 */
export function lookup(o: { query: string; textbooks: readonly { path: string; text: string }[]; diaries: readonly { path: string; date: string; text: string }[]; maxCaliber?: number }): { lines: string[]; caliber: { path: string; text: string } | null; retrieved: Retrieved[] } {
  const books = o.textbooks.map((t) => ({ ...t, book: t.path.replace(/^.*\//, '').replace(/\.md$/, ''), lessons: parseTextbook(t.path.replace(/^.*\//, '').replace(/\.md$/, ''), t.text) }));
  const lessons = books.flatMap((b) => b.lessons);
  const lines: string[] = [];
  const retrieved: Retrieved[] = [];
  const used = (path: string, text: string, why: string): void => {
    const hit = retrieved.find((r) => r.path === path);
    if (hit) { if (!hit.why.includes(why)) hit.why += `;${why}`; } else retrieved.push({ path, hash: textHash(text), why });
  };
  // 生字表:教材里有识字、写字行才查(数学的教材没有,别报一串「没有」)
  const chars = lessons.some((l) => l.recognize.length || l.write.length) ? askedChars(o.query) : [];
  for (const c of chars) lines.push(charLine(c, lessons, books.map((b) => b.book).join('、')));
  for (const b of books) if (chars.length && b.lessons.some((l) => l.recognize.length || l.write.length)) used(b.path, b.text, `问到的字:${chars.join('、')}`);
  // 那一课:提到的课,加问到的字要会写的那一课;最多两课
  const hit = [...new Set([...mentioned(lessons, o.query), ...lessons.filter((l) => chars.some((c) => l.write.includes(c)))])].slice(0, 2);
  const calibers = hit.filter((l) => l.caliber);
  for (const l of hit) {
    const b = books.find((x) => x.lessons.includes(l))!;
    if (l.caliber) used(b.path, b.text, `口径:${l.title}`);
    const s = lastSteps(l, o.diaries);
    if (s) { lines.push(s.line); used(s.from.path, s.from.text, `以前讲过:${l.title}`); }
  }
  const max = o.maxCaliber ?? 1200;
  const caliberText = calibers.map((l) => `## ${l.title}\n### 口径\n${l.caliber}`).join('\n\n');
  const caliberPath = calibers.length ? books.find((x) => x.lessons.includes(calibers[0]))!.path : null;
  return {
    lines,
    caliber: caliberPath ? { path: caliberPath, text: caliberText.length > max ? `${caliberText.slice(0, max)}\n……(后面截掉了)` : caliberText } : null,
    retrieved,
  };
}

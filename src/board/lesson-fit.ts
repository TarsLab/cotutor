/**
 * 讲稿里的动作落到页上(2026-11-16 阶段 2 任务 2;纯函数,runner 在流式与定稿时都过一遍):老师写的是课本上的字,应用照课本的索引找到它在哪。
 *  - 翻 课名:照目录找到这一课铺哪几页(找不到就不翻,还是现在这一课)
 *  - 看 第 3 题 / 例 2 / 原话…:照这一课分好的块找到那一块的框(src/chalk/kit/book.ts 的 bookTarget)
 *  - 圈、遮、盖 字词:照字找到框;先在「看」着的那一块里找(找不到的那一处不做)
 *  - 写、摆:落进「看」着的那道题的白纸条;没在看哪一道题就不做
 *  - 擦、请:照写的做
 * 一节里的动作照先后一个一个落(先翻再看,看的是新的那一课),落不了的记一句给家长(unfound / skipped),动作本身留在讲稿上、不带 do。
 * 这里也收着课本做底时以前替老师把住的规矩(以前在 board-page.ts 的 fitBook 与 runner 的 lastBoardKit、bookOn)。
 */
import { BOOK_KIT, BOOK_MAX_PAGES, BOOK_TOC, bookCut, bookFind, bookSheets, bookTarget, findLesson, lessonBlocks } from '../chalk/index.ts';
import type { BoardCard, BoardSection, BookIndex, BookPage, Lesson, LessonAct, LessonPage, LineAct } from '../schema/index.ts';
import { actParts } from './acts.ts';
import { lessonPage, lessonStep } from './lesson.ts';

/** 一课(或目录)铺哪几页(最多 BOOK_MAX_PAGES 页,数学一个小节能有十几页);认不出 = null */
export function bookLesson(index: BookIndex, name: string | null): { title: string; pages: BookPage[] } | null {
  if (!name || name === BOOK_TOC) return index.toc.length ? { title: BOOK_TOC, pages: index.pages.filter((p) => index.toc.includes(p.n)) } : null;
  const l = findLesson(index.lessons, name);
  return l ? { title: l.title, pages: index.pages.filter((p) => p.n >= l.pages[0] && p.n <= l.pages[1]).slice(0, BOOK_MAX_PAGES) } : null;
}

/** 课本做底:这一册的文件名与索引 */
export interface LessonBook { file: string; index: BookIndex }

/** 一课(或目录)当一页铺:页的样子(老师的一层、孩子的一层由 lessonStep 补) */
export function bookPageOf(book: LessonBook, name: string | null): Extract<LessonAct, { k: '翻' }>['page'] | null {
  const at = bookLesson(book.index, name);
  if (!at || !at.pages.length) return null;
  return { id: `${book.file}#${at.title}`, kind: 'book', src: book.file, title: at.title, pages: at.pages.map((p) => p.n), cut: bookCut(book.index.pages), layout: book.index.layout, pick: book.index.layout !== 'math' };
}

/** 一页课本的字与位置(找框用) */
function pageText(book: LessonBook, p: LessonPage): { pages: BookPage[]; sheets: ReturnType<typeof bookSheets>; blocks: ReturnType<typeof lessonBlocks> } {
  const pages = book.index.pages.filter((x) => p.pages.includes(x.n));
  return { pages, sheets: bookSheets(pages, undefined, p.cut), blocks: lessonBlocks(pages, p.layout) };
}

/** 一个动作落到页上;落不了回 why(给家长的一句) */
export function fitAct(l: Lesson, a: LineAct, book: LessonBook | null): { do: LessonAct; why?: string } | { why: string; do?: undefined } {
  let parts;
  try { parts = actParts(a); } catch (e) { return { why: e instanceof Error ? e.message : String(e) }; }
  if (parts.name === '翻') {
    if (!book) return { why: '没有课本,翻不了' };
    const page = bookPageOf(book, parts.lesson === BOOK_TOC ? null : parts.lesson);
    return page ? { do: { k: '翻', page } } : { why: `课本里没有「${parts.lesson}」这一课` };
  }
  const p = lessonPage(l);
  if (!p || !book || p.src !== book.file) return { why: '页上还没有东西' };
  switch (parts.name) {
    case '看': {
      const t = pageText(book, p);
      const hit = bookTarget(t.pages, t.sheets, t.blocks, parts.target);
      return hit ? { do: { k: '看', label: hit.label, box: hit.box } } : { why: `「${parts.target}」在《${p.title}》里找不到` };
    }
    case '圈':
    case '遮':
    case '盖': {
      const t = pageText(book, p);
      const within = l.look?.box ?? null;
      const spots = parts.spots.flatMap((text) => { const box = bookFind(t.pages, t.sheets, text, within); return box ? [{ text, box }] : []; });
      const lost = parts.spots.filter((text) => !spots.some((s) => s.text === text));
      const why = `${parts.name}的「${lost.join('」「')}」在《${p.title}》里找不到`;
      if (!spots.length) return { why };
      return { do: { k: parts.name, spots }, ...(lost.length ? { why } : {}) };
    }
    case '写':
    case '摆':
      if (!l.look) return { why: `${parts.name}要先「看」一道题(白纸条贴着那道题的下沿)` };
      return { do: parts.name === '写' ? { k: '写', text: parts.text, size: parts.size } : { k: '摆', kit: parts.kit, params: parts.params, size: parts.size } };
    case '擦':
      return { do: { k: '擦', all: parts.all } };
    case '请': {
      // 点字只在能点的页上(数学课本上点的是数和算式,不弹)
      const ops = p.pick ? parts.ops : parts.ops.filter((o) => o !== '点');
      return ops.length ? { do: { k: '请', ops }, ...(ops.length < parts.ops.length ? { why: `《${p.title}》上不能点字` } : {}) } : { why: `《${p.title}》上不能点字` };
    }
  }
}

/** 一串动作照先后落;回落好的(带 do 的)、到这里时这节课的样子、落不了的那几句 */
export function fitActs(l: Lesson, acts: readonly LineAct[], book: LessonBook | null): { acts: LineAct[]; lesson: Lesson; why: string[] } {
  const why: string[] = [];
  let s = l;
  const out = acts.map((a) => {
    const { do: _old, ...bare } = a;
    const r = fitAct(s, bare, book);
    if (!r.do) { why.push(`[[${a.name}${a.arg ? ` ${a.arg}` : ''}]] 没做:${r.why}`); return bare; }
    if (r.why) why.push(`[[${a.name}${a.arg ? ` ${a.arg}` : ''}]] 做了一部分:${r.why}`);
    s = lessonStep(s, { t: 'act', act: r.do });
    return { ...bare, do: r.do };
  });
  return { acts: out, lesson: s, why };
}

/**
 * 课本做底的一节里卡都不上板(页就是课本,老师用讲稿里的动作):别的卡(点阵、方向盘、字卡……)撤掉(dropped,给家长记一行),
 * 卡撤了,讲稿里引用它的锚、标注、cue 跟着拿掉。
 * 过渡(阶段 2 任务 3 起,到阶段 3 结束删掉:语文预习还写 ```课本 卡):课本卡说成讲稿里的动作
 * (课 → 翻,看、圈、遮、盖照写的,开放的操作 → 请:画 = 写、点字 = 点),跟着它前面那一句(第一句前面的马上做)。
 */
export function bookSection(section: BoardSection): { section: BoardSection; dropped: BoardCard[] } {
  const kits = section.cards.map((_, i) => i);
  if (!kits.length) return { section, dropped: [] };
  const dropped: BoardCard[] = [];
  const lead: LineAct[] = [...(section.acts ?? [])];
  const after = new Map<number, LineAct[]>();
  for (const i of kits) {
    const c = section.cards[i];
    if (c.kind !== 'kit' || c.props.kit !== BOOK_KIT) { dropped.push(c); continue; }
    const p = (c.props.params && typeof c.props.params === 'object' ? c.props.params : {}) as Record<string, unknown>;
    const text = (k: string): string[] => (typeof p[k] === 'string' ? (p[k] as string).split(';').map((x) => x.split('|')[0].trim()).filter(Boolean) : []);
    const acts: LineAct[] = [];
    if (text('课')[0]) acts.push({ name: '翻', arg: text('课')[0] });
    if (text('看')[0]) acts.push({ name: '看', arg: text('看')[0] });
    for (const k of ['圈', '遮', '盖'] as const) if (text(k).length) acts.push({ name: k, arg: text(k).join('、') });
    const ops = Array.isArray(c.props.ops) ? (c.props.ops as string[]) : [];
    const asked = [...new Set(ops.flatMap((o) => (o === '圈' ? ['圈'] : o === '画' ? ['写'] : o === '点字' ? ['点'] : [])))];
    if (asked.length) acts.push({ name: '请', arg: asked.join('、') });
    // 跟着卡前面那一句:最后一句锚在它前面的卡上(或没有锚)的
    let at = -1;
    section.lines.forEach((l, k) => { if (l.anchor === null || l.anchor < i) at = k; });
    if (at < 0) lead.push(...acts);
    else after.set(at, [...(after.get(at) ?? []), ...acts]);
  }
  const lines = section.lines.map((l, k) => {
    const acts = [...(l.acts ?? []), ...(after.get(k) ?? [])];
    return { ...l, anchor: null, marks: [], cues: [], ...(acts.length ? { acts } : {}) };
  });
  const { layout: _layout, acts: _acts, ...rest } = section;
  return { section: { ...rest, cards: [], lines, ...(lead.length ? { acts: lead } : {}) }, dropped };
}

/** 一节里落好的动作,照孩子看到的先后:第一句前面的,再一句一句(定稿时 runner 照它把这一节落进一节课的状态) */
export function sectionActs(section: BoardSection): LessonAct[] {
  return [...(section.acts ?? []), ...section.lines.flatMap((l) => l.acts ?? [])].flatMap((a) => (a.do ? [a.do] : []));
}

/** 一节里讲稿的动作都落到页上(第一句前面的先落,再一句一句);回换好的一节和落不了的那几句 */
export function fitSection(section: BoardSection, l: Lesson, book: LessonBook | null): { section: BoardSection; why: string[] } {
  if (!section.acts?.length && !section.lines.some((x) => x.acts?.length)) return { section, why: [] };
  const why: string[] = [];
  let s = l;
  const run = (acts: LineAct[] | undefined): LineAct[] | undefined => {
    if (!acts?.length) return acts;
    const r = fitActs(s, acts, book);
    s = r.lesson;
    why.push(...r.why);
    return r.acts;
  };
  const lead = run(section.acts);
  const lines = section.lines.map((x) => (x.acts?.length ? { ...x, acts: run(x.acts) } : x));
  return { section: { ...section, lines, ...(lead ? { acts: lead } : {}) }, why };
}

/** 还没有页的一节课(课本做底):先铺目录 */
export function lessonOpen(l: Lesson, book: LessonBook): Lesson {
  if (l.at) return l;
  const page = bookPageOf(book, null);
  return page ? lessonStep(l, { t: 'act', act: { k: '翻', page } }) : l;
}

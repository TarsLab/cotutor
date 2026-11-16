/**
 * 讲稿里的动作落到页上(2026-11-16 阶段 2 任务 2,阶段 3 起页不只课本;纯函数,runner 在流式与定稿时都过一遍):老师写的是页上印的字,应用照页的文字层找到它在哪。
 *  - 翻 课名 / 翻 目录:照课本目录找到这一课铺哪几页;翻 白纸:加一张白纸页(有了就回到它);翻 作业:回到孩子拍的照片页;翻 小课堂:回到那堂课
 *  - 看 第 3 题 / 例 2 / 原话…:照这一页分好的块找到那一块的框(src/chalk/kit/book.ts 的 bookTarget);照片页还认「第 2 张」「第 2 张第 3 题」
 *  - 看 0:19–0:30 / 0:19 / 课里的一句原话(小课堂页,2026-11-17 阶段 5):放那一段,对齐到句(src/board/lecture.ts 的 lectureRange);只写起点放到那一句的末尾
 *  - 圈、遮、盖 字词:照字找到框;先在「看」着的那一块里找(找不到的那一处不做)
 *  - 写、摆:落进「看」着的那道题的白纸条;白纸页上整页就是一条;课本、照片上没在看哪一道题就不做
 *  - 擦、请:照写的做
 * 页的文字层:课本是 PDF 的文字层(src/memory/textbook-index.ts);照片是认字认出的行和题,换成课本的样子(src/chalk/kit/photo.ts);小课堂是每一句的起点与原话;白纸没有。
 * 一节里的动作照先后一个一个落(先翻再看,看的是新的那一页),落不了的记一句给家长(why),动作本身留在讲稿上、不带 do。
 */
import { BOOK_MAX_PAGES, BOOK_TOC, bookCut, bookFind, bookSheets, bookTarget, findLesson, lessonBlocks, photoBookPage, type BookBlock, type BookSheet, type PhotoText } from '../chalk/index.ts';
import { LECTURE_PAGE, PHOTO_PAGE, WHITE_PAGE, type BoardCard, type BoardSection, type BookIndex, type BookPage, type Box, type Lesson, type LessonAct, type LineAct, type PageSource } from '../schema/index.ts';
import { actParts } from './acts.ts';
import { clockLabel, lectureRange, parseClock, type LectureClock } from './lecture.ts';
import { lessonPage, lessonStep } from './lesson.ts';

/** 一课(或目录)铺哪几页(最多 BOOK_MAX_PAGES 页,数学一个小节能有十几页);认不出 = null */
export function bookLesson(index: BookIndex, name: string | null): { title: string; pages: BookPage[] } | null {
  if (!name || name === BOOK_TOC) return index.toc.length ? { title: BOOK_TOC, pages: index.pages.filter((p) => index.toc.includes(p.n)) } : null;
  const l = findLesson(index.lessons, name);
  return l ? { title: l.title, pages: index.pages.filter((p) => p.n >= l.pages[0] && p.n <= l.pages[1]).slice(0, BOOK_MAX_PAGES) } : null;
}

/** 课本做底:这一册的文件名与索引 */
export interface LessonBook { file: string; index: BookIndex }

/** 页的文字层从哪来:这一科的课本(没有课本的 activity 是 null)、照片页上每张认出的字(照片的路径 → 认出的;还没认出来的没有) */
export interface LessonSource {
  book: LessonBook | null;
  photos?: Readonly<Record<string, PhotoText>>;
  /** 小课堂页的那堂课(src/runtime/lecture.ts 读的):每一句的起点、段长、原话;读不出来、没有小课堂是 null */
  lecture?: { bundle: string; clock: Pick<LectureClock, 'segments' | 'total'> } | null;
}

/** 「看」小课堂:「0:19–0:30」「0:19」(放到那一句的末尾),或课里一句原话的一截(放那一句);对齐到句 */
export function lectureTarget(clock: Pick<LectureClock, 'segments' | 'total'>, what: string): { label: string; at: [number, number] } | null {
  const t = what.trim();
  const m = /^(\d{1,2}(?::\d{2}){1,2})\s*(?:(?:[–—~～]|-|到|至)+\s*(\d{1,2}(?::\d{2}){1,2}))?$/.exec(t);
  let r: { start: number; end: number } | null = null;
  if (m) {
    const from = parseClock(m[1]);
    const to = m[2] ? parseClock(m[2]) : undefined;
    if (from === null || to === null) return null;
    r = lectureRange(clock, from, to);
  } else {
    const bare = (x: string): string => x.replace(/[\s,，。.!！?？、;；:：「」『』“”"']/g, '');
    const want = bare(t);
    const seg = want ? clock.segments.find((x) => bare(x.line ?? '').includes(want)) : undefined;
    if (seg) r = { start: seg.start, end: seg.start + seg.len };
  }
  return r ? { label: `${clockLabel(r.start)}–${clockLabel(r.end)}`, at: [r.start, r.end] } : null;
}

/** 一课(或目录)当一页铺:页的样子(老师的一层、孩子的一层由 lessonStep 补) */
export function bookPageOf(book: LessonBook, name: string | null): Extract<PageSource, { kind: 'book' }> | null {
  const at = bookLesson(book.index, name);
  if (!at || !at.pages.length) return null;
  return { id: `${book.file}#${at.title}`, kind: 'book', src: book.file, title: at.title, pages: at.pages.map((p) => p.n), cut: bookCut(book.index.pages), layout: book.index.layout, pick: book.index.layout !== 'math' };
}

/** 白纸页(一节课只有一张,翻回来原来摆的都在) */
export const whitePage = (): PageSource => ({ id: WHITE_PAGE, kind: 'white', title: WHITE_PAGE, pick: false });

/** 一页的文字层:几页(课本的 PDF 页、照片一张一页)、在场景里的位置、分好的块;白纸、对不上的课本是空的 */
export function pageText(p: PageSource, src: LessonSource): { pages: BookPage[]; sheets: BookSheet[]; blocks: BookBlock[] } {
  if (p.kind === 'book') {
    if (!src.book || p.src !== src.book.file) return { pages: [], sheets: [], blocks: [] };
    const pages = src.book.index.pages.filter((x) => p.pages.includes(x.n));
    return { pages, sheets: bookSheets(pages, undefined, p.cut), blocks: lessonBlocks(pages, p.layout) };
  }
  if (p.kind === 'photo') {
    const layers = p.photos.map((ph, i) => photoBookPage(i + 1, ph, src.photos?.[ph.src] ?? null));
    const pages = layers.map((x) => x.page);
    return { pages, sheets: bookSheets(pages), blocks: layers.flatMap((x) => x.blocks) };
  }
  return { pages: [], sheets: [], blocks: [] };
}

/** 照片页上的「第 2 张」「第 2 张第 3 题」 */
const SHEET = /^第?\s*(\d{1,2})\s*张(?:\s*的?\s*第?\s*(\d{1,2})\s*题)?$/;

/** 「看」照片页:第几张、第几张的第几题;别的同课本 */
function photoTarget(t: ReturnType<typeof pageText>, what: string): { label: string; box: Box } | null {
  const m = SHEET.exec(what.replace(/\s/g, ''));
  if (!m) return bookTarget(t.pages, t.sheets, t.blocks, what);
  const n = Number(m[1]), sh = t.sheets.find((x) => x.n === n);
  if (!sh) return null;
  if (!m[2]) return { label: `第${n}张`, box: [0, sh.top, 1000, sh.top + sh.height] };
  const hit = bookTarget(t.pages, t.sheets, t.blocks.filter((b) => b.area?.n === n), `第${m[2]}题`);
  return hit ? { label: `第${n}张${hit.label}`, box: hit.box } : null;
}

/** 翻到哪:白纸、照片页(作业、照片)、课本的一课或目录 */
function turnTo(l: Lesson, name: string, src: LessonSource): { page: PageSource } | { why: string } {
  if (name === WHITE_PAGE || name === '白板' || name === '白纸页') return { page: whitePage() };
  if (name === LECTURE_PAGE || name === '课' || name === '视频') {
    const p = l.pages.find((x) => x.kind === 'lecture');
    if (!p) return { why: '这节课没有小课堂' };
    const { teacher: _t, kid: _k, open: _o, ...page } = p;
    return { page };
  }
  if (name === PHOTO_PAGE || name === '照片' || name === '作业照片') {
    const p = l.pages.find((x) => x.kind === 'photo');
    if (!p) return { why: '孩子还没拍照片,没有照片页可翻' };
    const { teacher: _t, kid: _k, open: _o, ...page } = p;
    return { page };
  }
  if (!src.book) return { why: `这节课没有课本,翻不了「${name}」(能翻的:白纸、作业)` };
  const page = bookPageOf(src.book, name === BOOK_TOC ? null : name);
  return page ? { page } : { why: `课本里没有「${name}」这一课` };
}

/** 一个动作落到页上;落不了回 why(给家长的一句) */
export function fitAct(l: Lesson, a: LineAct, src: LessonSource): { do: LessonAct; why?: string } | { why: string; do?: undefined } {
  let parts;
  try { parts = actParts(a); } catch (e) { return { why: e instanceof Error ? e.message : String(e) }; }
  if (parts.name === '翻') {
    const r = turnTo(l, parts.lesson, src);
    return 'page' in r ? { do: { k: '翻', page: r.page } } : { why: r.why };
  }
  const p = lessonPage(l);
  if (!p) return { why: '页上还没有东西' };
  switch (parts.name) {
    case '看': {
      if (p.kind === 'white') return { why: '白纸页上没有可看的,直接摆、写' };
      if (p.kind === 'lecture') {
        const c = src.lecture && src.lecture.bundle === p.bundle ? src.lecture.clock : null;
        if (!c) return { why: `小课堂《${p.title}》读不出来,放不了` };
        const hit = lectureTarget(c, parts.target);
        return hit ? { do: { k: '看', label: hit.label, box: [0, 0, 0, 0], at: hit.at } } : { why: `「${parts.target}」在小课堂《${p.title}》里找不到(写 0:19–0:30,或课里一句原话)` };
      }
      const t = pageText(p, src);
      const hit = p.kind === 'photo' ? photoTarget(t, parts.target) : bookTarget(t.pages, t.sheets, t.blocks, parts.target);
      return hit ? { do: { k: '看', label: hit.label, box: hit.box } } : { why: `「${parts.target}」在《${p.title}》里找不到${p.kind === 'photo' ? '(照片上认出的题没有它,或者还没认完)' : ''}` };
    }
    case '圈':
    case '遮':
    case '盖': {
      if (p.kind === 'lecture') return { why: `小课堂上${parts.name}不了:请孩子停住了自己画` };
      const t = pageText(p, src);
      const within = l.look?.box ?? null;
      const spots = parts.spots.flatMap((text) => { const box = bookFind(t.pages, t.sheets, text, within); return box ? [{ text, box }] : []; });
      const lost = parts.spots.filter((text) => !spots.some((s) => s.text === text));
      const why = `${parts.name}的「${lost.join('」「')}」在《${p.title}》里找不到`;
      if (!spots.length) return { why };
      return { do: { k: parts.name, spots }, ...(lost.length ? { why } : {}) };
    }
    case '写':
    case '摆':
      if (p.kind === 'lecture') return { why: `小课堂上${parts.name}不了:[[翻 白纸]] 再${parts.name}` };
      if (!l.look && p.kind !== 'white') return { why: `${parts.name}要先「看」一道题(白纸条贴着那道题的下沿),或 [[翻 白纸]]` };
      return { do: parts.name === '写' ? { k: '写', text: parts.text, size: parts.size } : { k: '摆', kit: parts.kit, params: parts.params, size: parts.size } };
    case '擦':
      return { do: { k: '擦', all: parts.all } };
    case '请': {
      // 点字只在能点的页上(数学的课本、照片上点的是数和算式,不弹)
      const ops = p.pick ? parts.ops : parts.ops.filter((o) => o !== '点');
      return ops.length ? { do: { k: '请', ops }, ...(ops.length < parts.ops.length ? { why: `《${p.title}》上不能点字` } : {}) } : { why: `《${p.title}》上不能点字` };
    }
  }
}

/** 一串动作照先后落;回落好的(带 do 的)、到这里时这节课的样子、落不了的那几句 */
export function fitActs(l: Lesson, acts: readonly LineAct[], src: LessonSource): { acts: LineAct[]; lesson: Lesson; why: string[] } {
  const why: string[] = [];
  let s = l;
  const out = acts.map((a) => {
    const { do: _old, ...bare } = a;
    const r = fitAct(s, bare, src);
    if (!r.do) { why.push(`[[${a.name}${a.arg ? ` ${a.arg}` : ''}]] 没做:${r.why}`); return bare; }
    if (r.why) why.push(`[[${a.name}${a.arg ? ` ${a.arg}` : ''}]] 做了一部分:${r.why}`);
    s = lessonStep(s, { t: 'act', act: r.do });
    return { ...bare, do: r.do };
  });
  return { acts: out, lesson: s, why };
}

/**
 * 铺着页的一节里卡都不上板(老师用讲稿里的动作):卡都撤掉(dropped,给家长记一行),
 * 讲稿里引用卡的锚、标注、cue 跟着拿掉。
 */
export function pageSection(section: BoardSection): { section: BoardSection; dropped: BoardCard[] } {
  if (!section.cards.length) return { section, dropped: [] };
  const lines = section.lines.map((l) => ({ ...l, anchor: null, marks: [], cues: [] }));
  const { layout: _layout, ...rest } = section;
  return { section: { ...rest, cards: [], lines }, dropped: [...section.cards] };
}

/** 一节里落好的动作,照孩子看到的先后:第一句前面的,再一句一句(定稿时 runner 照它把这一节落进一节课的状态) */
export function sectionActs(section: BoardSection): LessonAct[] {
  return [...(section.acts ?? []), ...section.lines.flatMap((l) => l.acts ?? [])].flatMap((a) => (a.do ? [a.do] : []));
}

/** 一节里讲稿的动作都落到页上(第一句前面的先落,再一句一句);回换好的一节和落不了的那几句 */
export function fitSection(section: BoardSection, l: Lesson, src: LessonSource): { section: BoardSection; why: string[] } {
  if (!section.acts?.length && !section.lines.some((x) => x.acts?.length)) return { section, why: [] };
  const why: string[] = [];
  let s = l;
  const run = (acts: LineAct[] | undefined): LineAct[] | undefined => {
    if (!acts?.length) return acts;
    const r = fitActs(s, acts, src);
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

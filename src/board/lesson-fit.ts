/**
 * 讲稿里的动作落到页上(纯函数,runner 在流式与定稿时都过一遍):老师写的是页上印的字,应用照页的文字层找到它在哪。
 *  - 翻 课名 / 翻 目录:照课本目录找到这一课铺哪几页;翻 白纸:加一张白纸页(有了就回到它);翻 作业(今天):回到孩子拍的照片页(作业本);
 *    翻 小课堂:回到那堂课;翻 练习册(或册名):回到铺过的那一册。
 *    作业本是一整本连着滚的一页(老的在上):在作业本上「翻 11月20日」「翻 今天」就是窗移到那一天(落成「看」);在别的页上翻回作业本
 *  - 看 第 3 题 / 例 2 / 原话…:照这一页的分块(课本是这一课挑好的分块文件,src/schema/zones.ts)找到那一块的框(src/chalk/kit/book.ts 的 bookTarget);照片页还认「第 2 张」「第 2 张第 3 题」,练习册「第 2 页」「第 2 页第 3 题」;
 *    作业本上「第 2 张」是今天的第 2 张,以前那天的写「11月20日第 2 张」「11月20日第 2 张第 3 题」,「11月20日」是那一天的第一张
 *  - 看 0:19–0:30 / 0:19 / 课里的一句原话(小课堂页):放那一段,对齐到句(src/board/lecture.ts 的 lectureRange);只写起点放到那一句的末尾
 *  - 圈、划、加点、遮、盖 字词:照字找到框;先在「看」着的那一块里找(找不到的那一处不做)。
 *    圈的框连着字头上的拼音(圈住整个字块,不切拼音那一行);划一句跨了行就一行一截;一句里圈、划、加点最多做 3 处,多写的给家长记一句
 *  - 写、摆:落进「看」着的那道题的白纸条;白纸页上整页就是一条;课本、照片上没在看哪一道题就不做
 *  - 擦、请:照写的做
 * 页的文字层:课本是 PDF 的文字层(src/memory/textbook-index.ts);照片是认字认出的行和题,换成课本的样子(src/chalk/kit/photo.ts);
 * 练习册是 workbook.json 里排版时记下的行和题(src/chalk/kit/workbook.ts);小课堂是每一句的起点与原话;白纸没有。
 * 一节里的动作照先后一个一个落(先翻再看,看的是新的那一页),落不了的记一句给家长(why),动作本身留在讲稿上、不带 do。
 */
import { BOOK_MAX_PAGES, BOOK_TOC, bookCut, bookFind, bookSheets, bookSpot, bookTarget, bookView, findLesson, lessonName, photoBookPage, workbookLayer, zoneBlocks, type BookBlock, type BookSheet, type PhotoText } from '../chalk/index.ts';
import { LECTURE_PAGE, pickBookZones, LOOK_ROWS_MAX, PHOTO_PAGE, WHITE_PAGE, type BoardSection, type BookIndex, type BookPage, type BookZones, type Box, type Lesson, type LessonAct, type LineAct, type PageSource, type Workbook } from '../schema/index.ts';
import { actParts } from './acts.ts';
import { clockLabel, lectureRange, parseClock, type LectureClock } from './lecture.ts';
import { dayTitle, lessonPage, lessonStep, photoDay, photoGaps } from './lesson.ts';

/** 一课(或目录)铺哪几页(最多 BOOK_MAX_PAGES 页,数学一个小节能有十几页);认不出 = null。title 是这一课在页上的名字(同名的带编号,lessonName) */
export function bookLesson(index: BookIndex, name: string | null): { title: string; pages: BookPage[] } | null {
  if (!name || name === BOOK_TOC) return index.toc.length ? { title: BOOK_TOC, pages: index.pages.filter((p) => index.toc.includes(p.n)) } : null;
  const l = findLesson(index.lessons, name);
  return l ? { title: lessonName(index.lessons, l), pages: index.pages.filter((p) => p.n >= l.pages[0] && p.n <= l.pages[1]).slice(0, BOOK_MAX_PAGES) } : null;
}

/** 课本做底:这一册的文件名、索引与分块(规则出的、vault 里改好的;src/memory/textbook-zones.ts) */
export interface LessonBook { file: string; index: BookIndex; zones: BookZones }

/** 页的文字层从哪来:这一科的课本(没有课本的 activity 是 null)、照片页上每张认出的字(照片的路径 → 认出的;还没认出来的没有) */
export interface LessonSource {
  book: LessonBook | null;
  photos?: Readonly<Record<string, PhotoText>>;
  /** 小课堂页的那堂课(src/runtime/lecture.ts 读的):每一句的起点、段长、原话;读不出来、没有小课堂是 null */
  lecture?: { bundle: string; clock: Pick<LectureClock, 'segments' | 'total'> } | null;
  /** 这节课铺过的练习册(名字 → 读出来的那一册;src/memory/workbook.ts);读不出来的没有 */
  workbooks?: Readonly<Record<string, Workbook>>;
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
  return { id: `${book.file}#${at.title}`, kind: 'book', src: book.file, title: at.title, pages: at.pages.map((p) => p.n), cut: bookCut(book.index.pages), layout: book.index.layout, pick: book.index.layout === 'prose' };
}

/** 白纸页(一节课只有一张,翻回来原来摆的都在) */
export const whitePage = (): PageSource => ({ id: WHITE_PAGE, kind: 'white', title: WHITE_PAGE, pick: false });

/** 一页的文字层:几页(课本的 PDF 页、照片一张一页)、在场景里的位置、分好的块;白纸、对不上的课本是空的 */
export function pageText(p: PageSource, src: LessonSource): { pages: BookPage[]; sheets: BookSheet[]; blocks: BookBlock[] } {
  if (p.kind === 'book') {
    if (!src.book || p.src !== src.book.file) return { pages: [], sheets: [], blocks: [] };
    const pages = src.book.index.pages.filter((x) => p.pages.includes(x.n));
    return { pages, sheets: bookSheets(pages, undefined, p.cut), blocks: zoneBlocks(pages, pickBookZones(src.book.index, src.book.zones, p.pages).pages, p.layout) };
  }
  if (p.kind === 'photo') {
    const layers = p.photos.map((ph, i) => photoBookPage(i + 1, ph, src.photos?.[ph.src] ?? null));
    const pages = layers.map((x) => x.page);
    return { pages, sheets: bookSheets(pages, undefined, 0, photoGaps(p.photos, p.day)), blocks: layers.flatMap((x) => x.blocks) };
  }
  if (p.kind === 'workbook') {
    const wb = src.workbooks?.[p.src];
    if (!wb) return { pages: [], sheets: [], blocks: [] };
    const { pages, blocks } = workbookLayer(wb);
    return { pages, sheets: bookSheets(pages), blocks };
  }
  return { pages: [], sheets: [], blocks: [] };
}

/** 照片页上的「第 2 张」「第 2 张第 3 题」,练习册上的「第 2 页」「第 2 页第 3 题」 */
const SHEET = { 张: /^第?\s*(\d{1,2})\s*张(?:\s*的?\s*第?\s*(\d{1,2})\s*题)?$/, 页: /^第?\s*(\d{1,2})\s*页(?:\s*的?\s*第?\s*(\d{1,2})\s*题)?$/ } as const;

type PhotoPage = Extract<PageSource, { kind: 'photo' }>;

/** 作业本里每一张:哪天拍的、是那天的第几张(从 1 起)、给老师看的名字(今天的「第2张」,以前的「11月20日第2张」) */
export function homeworkLabels(p: PhotoPage): { day: string; k: number; label: string }[] {
  const today = p.day ?? '';
  const seen = new Map<string, number>();
  return p.photos.map((ph) => {
    const day = photoDay(ph, today);
    const k = (seen.get(day) ?? 0) + 1;
    seen.set(day, k);
    return { day, k, label: day === today ? `第${k}张` : `${dayTitle(day)}第${k}张` };
  });
}

/** 作业本里说的是哪一天:「今天」、「11月20日」、「2026-11-20」;这本里没有那天 = null */
function homeworkDay(p: PhotoPage, name: string): string | null {
  const t = name.replace(/\s/g, '');
  if (t === '今天' || t === PHOTO_PAGE) return p.day ?? null;
  const days = [...new Set(p.photos.map((ph) => photoDay(ph, p.day ?? '')))];
  return days.find((d) => d === t || dayTitle(d) === t) ?? null;
}

/** 作业本上「看」:「11月20日」(那天的第一张)、「第 2 张」(今天的)、「11月20日第 2 张」、「…第 3 题」;别的同课本 */
function homeworkTarget(p: PhotoPage, t: ReturnType<typeof pageText>, what: string): { label: string; box: Box; rows?: Box[] } | null {
  const w = what.replace(/\s/g, '');
  const m = /^(今天|\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2})?的?(?:第?(\d{1,2})张(?:的?第?(\d{1,2})题)?)?$/.exec(w);
  if (!m || (!m[1] && !m[2])) return bookTarget(t.pages, t.sheets, t.blocks, what);
  const day = m[1] ? homeworkDay(p, m[1]) : (p.day ?? null);
  if (!day) return null;
  const labels = homeworkLabels(p);
  const i = labels.findIndex((x) => x.day === day && x.k === (m[2] ? Number(m[2]) : 1));
  const sh = i >= 0 ? t.sheets.find((x) => x.n === i + 1) : undefined;
  if (!sh) return null;
  const name = m[2] ? labels[i].label : day === p.day ? '今天' : dayTitle(day);
  if (!m[3]) return { label: name, box: [0, sh.top, 1000, sh.top + sh.height] };
  const hit = bookTarget(t.pages, t.sheets, t.blocks.filter((b) => b.area?.n === i + 1), `第${m[3]}题`);
  return hit ? { label: `${name}${hit.label}`, box: hit.box, rows: hit.rows } : null;
}

/** 窗停下来的那一块说成一句(给老师的「孩子在看」):照片页「第 1 张:第 3 题」;作业本带哪天(「11月20日第 1 张:第 3 题」),窗在最后那张白纸上说白纸 */
export function photoView(p: PhotoPage, t: ReturnType<typeof pageText>, box: Box): string {
  const said = bookView(t.pages, t.sheets, t.blocks, box, '张');
  if (!p.day) return said;
  const labels = homeworkLabels(p);
  const shown = t.sheets.filter((s) => s.top < box[3] && s.top + s.height > box[1]).map((s) => labels[s.n - 1]).filter(Boolean);
  const rest = said.replace(/^第 [\d–]+ 张:?/, '').replace(/^空白处$/, '');
  if (!shown.length) return '作业本最后那张白纸(拍照的地方)';
  const days = [...new Set(shown.map((x) => x.day))];
  const where = days.length > 1 ? `${shown[0].label}到${shown[shown.length - 1].label}` : shown.length > 1 ? `${shown[0].label}–${shown[shown.length - 1].k}张` : shown[0].label;
  return [where, rest].filter(Boolean).join(':');
}

/** 「看」照片页、练习册:第几张(页)、第几张(页)的第几题;别的同课本 */
function photoTarget(t: ReturnType<typeof pageText>, what: string, unit: keyof typeof SHEET = '张'): { label: string; box: Box; rows?: Box[] } | null {
  const m = SHEET[unit].exec(what.replace(/\s/g, ''));
  if (!m) return bookTarget(t.pages, t.sheets, t.blocks, what);
  const n = Number(m[1]), sh = t.sheets.find((x) => x.n === n);
  if (!sh) return null;
  if (!m[2]) return { label: `第${n}${unit}`, box: [0, sh.top, 1000, sh.top + sh.height] };
  const hit = bookTarget(t.pages, t.sheets, t.blocks.filter((b) => b.area?.n === n), `第${m[2]}题`);
  return hit ? { label: `第${n}${unit}${hit.label}`, box: hit.box, rows: hit.rows } : null;
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
  // 作业本的一天(「11月20日」「2026-11-20」)也是回到作业本那一页
  const hwBook = l.pages.find((x): x is Extract<typeof x, { kind: 'photo' }> => x.kind === 'photo' && Boolean(x.day));
  if (name === PHOTO_PAGE || name === '照片' || name === '作业照片' || name === '今天' || name === '作业本' || (hwBook && homeworkDay(hwBook, name))) {
    const p = l.pages.find((x) => x.kind === 'photo');
    if (!p) return { why: '孩子还没拍照片,没有照片页可翻' };
    const { teacher: _t, kid: _k, open: _o, ...page } = p;
    return { page };
  }
  const wb = l.pages.find((x) => x.kind === 'workbook' && (name === '练习册' || name === x.title || name === x.src));
  if (wb) {
    const { teacher: _t, kid: _k, open: _o, ...page } = wb;
    return { page };
  }
  if (!src.book) return { why: `这节课没有课本,翻不了「${name}」(能翻的:白纸、作业${l.pages.some((x) => x.kind === 'workbook') ? '、练习册' : ''})` };
  const page = bookPageOf(src.book, name === BOOK_TOC ? null : name);
  return page ? { page } : { why: `课本里没有「${name}」这一课` };
}

/** 一个动作落到页上;落不了回 why(给家长的一句) */
export function fitAct(l: Lesson, a: LineAct, src: LessonSource): { do: LessonAct; why?: string } | { why: string; do?: undefined } {
  let parts;
  try { parts = actParts(a); } catch (e) { return { why: e instanceof Error ? e.message : String(e) }; }
  if (parts.name === '翻') {
    // 作业本上翻到一天:作业本是连着滚的一整本,翻一天就是窗移到那一天
    const cur = lessonPage(l);
    if (cur?.kind === 'photo' && cur.day && homeworkDay(cur, parts.lesson)) {
      const hit = homeworkTarget(cur, pageText(cur, src), parts.lesson);
      if (hit) return { do: { k: '看', label: hit.label, box: hit.box } };
    }
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
      const hit = p.kind === 'photo' ? (p.day ? homeworkTarget(p, t, parts.target) : photoTarget(t, parts.target)) : p.kind === 'workbook' ? photoTarget(t, parts.target, '页') : bookTarget(t.pages, t.sheets, t.blocks, parts.target);
      return hit ? { do: { k: '看', label: hit.label, box: hit.box, ...(hit.rows?.length ? { rows: hit.rows.slice(0, LOOK_ROWS_MAX) } : {}) } } : { why: `「${parts.target}」在《${p.title}》里找不到${p.kind === 'photo' ? '(照片上认出的题没有它,或者还没认完)' : ''}` };
    }
    case '圈':
    case '划':
    case '加点':
    case '遮':
    case '盖': {
      if (p.kind === 'lecture') return { why: `小课堂上${parts.name}不了:请孩子停住了自己画` };
      const t = pageText(p, src);
      const within = l.look?.box ?? null;
      const name = parts.name;
      const spots = parts.spots.flatMap((text): { text: string; box: Box }[] => {
        if (name === '遮' || name === '盖') { const box = bookFind(t.pages, t.sheets, text, within); return box ? [{ text, box }] : []; }
        const hit = bookSpot(t.pages, t.sheets, text, within);
        if (!hit) return [];
        if (name === '划') return hit.rows.map((box) => ({ text, box }));
        const [x1, y1, x2, y2] = hit.box;
        // 拼音印在字的正上方,大约一个字高(同舞台的「遮」)
        return [{ text, box: name === '圈' && hit.py ? [x1, r1(y1 - (y2 - y1) * 0.95), x2, y2] : hit.box }];
      });
      const lost = parts.spots.filter((text) => !spots.some((s) => s.text === text));
      const why = [
        ...(lost.length ? [`${name}的「${lost.join('」「')}」在《${p.title}》里找不到`] : []),
        ...(parts.over?.length ? [`一句最多${name} ${parts.spots.length} 处,「${parts.over.join('」「')}」没做`] : []),
      ].join(';');
      if (!spots.length) return { why };
      return { do: { k: name, spots }, ...(why ? { why } : {}) };
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

/** 目录上能点的一项:课名、印在目录哪一行(场景坐标,目录那几页从上往下连着)、点了铺哪一页 */
export interface TocEntry { title: string; box: Box; page: Extract<PageSource, { kind: 'book' }> }

/** 目录这一页和它上面能点的那几项(读出了印在哪一行、翻得过去的);没有目录 = null */
export function tocEntries(book: LessonBook): { page: Extract<PageSource, { kind: 'book' }>; entries: TocEntry[] } | null {
  const page = bookPageOf(book, null);
  if (!page) return null;
  const sheets = bookSheets(book.index.pages.filter((p) => page.pages.includes(p.n)), undefined, page.cut);
  const entries: TocEntry[] = [];
  for (const l of book.index.lessons) {
    const sh = l.toc ? sheets.find((x) => x.n === l.toc!.n) : undefined;
    const name = lessonName(book.index.lessons, l);
    const to = sh ? bookPageOf(book, name) : null;
    if (!sh || !to || to.title !== name) continue;
    const [x1, y1, x2, y2] = l.toc!.box;
    entries.push({ title: name, box: [r1(x1 * sh.s), r1(sh.top + y1 * sh.s), r1(x2 * sh.s), r1(sh.top + y2 * sh.s)], page: to });
  }
  return { page, entries };
}
const r1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * 还没有页的一节课(课本做底):want = 家长在按钮上填的范围(找得到这一课就直接铺它),再是 last = 这本书上次翻到的那一课(直接铺它,窗摆回上次停的地方);
 * 都没有(或找不到)铺目录,窗停在目录上 last 那一行
 */
export function lessonOpen(l: Lesson, book: LessonBook, last?: string | { title: string; view?: Box } | null, want?: string | null): Lesson {
  if (l.at) return l;
  const spot = typeof last === 'string' ? { title: last } : (last ?? null);
  const asked = want ? bookPageOf(book, want) : null;
  if (asked && asked.title !== BOOK_TOC) return lessonStep(l, { t: 'act', act: { k: '翻', page: asked } });
  const back = spot ? bookPageOf(book, spot.title) : null;
  if (back && back.title !== BOOK_TOC) {
    const s = lessonStep(l, { t: 'act', act: { k: '翻', page: back } });
    return spot?.view ? lessonStep(s, { t: 'view', box: spot.view }) : s;
  }
  const page = bookPageOf(book, null);
  if (!page) return l;
  const s = lessonStep(l, { t: 'act', act: { k: '翻', page } });
  const at = spot ? tocEntries(book)?.entries.find((e) => e.title === spot.title) : undefined;
  return at ? lessonStep(s, { t: 'view', box: at.box }) : s;
}

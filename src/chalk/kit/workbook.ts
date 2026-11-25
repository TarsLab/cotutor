/**
 * 练习册的几页(src/schema/workbook.ts)换成课本的样子:行与字(BookPage)、每页的分块(ZonePage)、读回来的块(BookBlock),
 * 这样练习册页和课本页用同一份找框(看、圈)、点字、能写的格(bookCellsOf)、点读一块(bookSayZones)、给老师的(bookTeacherLines)、笔归作答区(bookRegions、bookZoneInk),都在 ./book.ts。
 * 一页当一张照片排:宽 1000(BOOK_W)、高 1000 × 页图的高宽比,几页从上往下连着;workbook.json 的千分比框横的照用、竖的乘高宽比(./photo.ts 的 photoBookPage)。
 * 文字层是排版时记下的,不用认;挑出的字词(terms)也当一行放在前面(点字、圈字先找到它),不归给哪一块。块不写 rows:框里的行归框住它的最里面那块;块都带自己的框(area),「看 第 3 题」框住题里的图和格。
 * 给老师的 <page>(workbookText)只列块:叫法和印着的字;练什么、答案在上下文包 board: 的「给老师的」,照窗现算(同课本)。
 */
import { workbookZonePage, type BookPage, type PageSource, type Workbook, type ZonePage } from '../../schema/index.ts';
import { zoneBlocks, type BookBlock } from './book.ts';
import { PHOTO_ITEM, photoBookPage } from './photo.ts';

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** 一节课里练习册那一页的 id */
export const workbookPageId = (name: string): string => `练习册#${name}`;

/** 一册铺成一节课的一页(几页从上往下连着);pick = 能不能点字看笔顺(数学的不弹,同课本) */
export function workbookPage(name: string, wb: Pick<Workbook, 'title' | 'pages'>, pick: boolean): Extract<PageSource, { kind: 'workbook' }> {
  return { id: workbookPageId(name), kind: 'workbook', src: name, title: wb.title, sheets: wb.pages.map((p) => ({ w: 1000, h: r1((1000 * p.image.h) / p.image.w) })), pick };
}

/** 一册的几页、每页的分块(page 是第几页,从 1 起)、读回来的块 */
export interface WorkbookLayer { pages: BookPage[]; zones: ZonePage[]; blocks: BookBlock[] }
export function workbookLayer(wb: Pick<Workbook, 'pages' | 'subject'>): WorkbookLayer {
  const pages = wb.pages.map((pg, i) => photoBookPage(i + 1, pg.image, { items: pg.terms.map((t) => ({ text: t.text, box: t.box })), lines: pg.lines, questions: [] }).page);
  const zones = wb.pages.map((pg, i) => workbookZonePage(pg, i + 1));
  const blocks = zoneBlocks(pages, zones, wb.subject === '数学' ? 'math' : 'prose', { area: true, skip: (l) => l.f === PHOTO_ITEM });
  return { pages, zones, blocks };
}

/**
 * 给老师的第 n 页(进 <page>,一页给一次):这一页的块一块一行,叫法在前、印着的字在后,小题缩进;没有字的块(一组算式、插图)只列叫法。
 * 练什么、卡住怎么引、答案不在这里(board: 的「给老师的」照窗给)
 */
export function workbookText(blocks: readonly BookBlock[], n: number): string[] {
  const out: string[] = [];
  const ends: number[] = [];
  const flat = (t: string): string => t.replace(/\s/g, '');
  blocks.forEach((b, k) => {
    while (ends.length && k > ends[ends.length - 1]) ends.pop();
    const pad = '  '.repeat(ends.length);
    if (b.kids) ends.push(k + b.kids);
    if (b.area?.n !== n) return;
    if (b.kind === 'group' || !b.text) { if (b.label) out.push(`${pad}〔${b.label}〕`); return; }
    const label = b.label && !flat(b.text).startsWith(flat(b.label)) ? `${b.label} ` : '';
    out.push(`${pad}${label}${b.text}`);
  });
  return out;
}

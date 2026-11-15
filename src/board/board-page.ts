/**
 * 板书一节落到板上之前,应用替老师把住的两件事(纯函数;runner 在流式与定稿时都过一遍):
 * 1. 照片板没写「图」:就是这块底(这个话题里孩子最近发的那张照片)。《画板为主设计》:「底不用再写,缺省就是当前这一块」。
 *    没有底(孩子还没发照片)的照片板画不出来,撤掉。
 * 1b. 照片板的「圈」「遮」写的是字词(圈: 蚕):照这块底上认出的字和行框找到它在哪(locate),换成框;找不到的那一处不画(unfound,给家长端记一行)。
 * 1c. 课本(activity 头上 base: textbook):课本卡没写「课」就是板上现在这一课(还没有就是目录);课名照目录换成这一册 PDF 的几页(书、页);
 *    「看」「圈」「遮」「盖」写的段、栏目、原话、字词照课本的索引换成框(src/chalk/kit/book.ts);找不到的那一处不画(unfound)。
 * 2. 以板为主的话题(activity 头上 board: page):板是页面,老师的卡只往板上画——一节只认最后一张板卡,别的卡不给孩子看。
 *    课本卡例外:一节里的几张都留着,按讲稿的先后一张一张落,就是窗一步一步移(「先看这一句……再看下面」)。
 * 撤掉的卡在讲稿里的引用(锚、敲黑板、[[cue]])跟着重排或撤掉;dropped 是撤掉的卡(给家长端记一行)。
 */
import { BOOK_KIT, BOOK_MAX_PAGES, BOOK_TOC, bookFind, bookOps, kitOf, kitOps, bookSheets, bookSpots, bookTarget, findLesson, lessonBlocks, photoFrame, photoRings } from '../chalk/index.ts';
import type { BoardCard, BoardSection, BookIndex, BookPage } from '../schema/index.ts';

/** 课本做底(activity 头上 base: textbook):这一册的索引、板上现在是哪一课(上一张课本卡的课;没有 = 还在目录) */
export interface BookBase {
  /** 册子的文件名(教材目录下) */
  file: string;
  index: BookIndex;
  lesson: string | null;
}

/** 一课(或目录)铺哪几页(最多 BOOK_MAX_PAGES 页,数学一个小节能有十几页);认不出 = null */
export function bookLesson(index: BookIndex, name: string | null): { title: string; pages: BookPage[] } | null {
  if (!name || name === BOOK_TOC) return index.toc.length ? { title: BOOK_TOC, pages: index.pages.filter((p) => index.toc.includes(p.n)) } : null;
  const l = findLesson(index.lessons, name);
  return l ? { title: l.title, pages: index.pages.filter((p) => p.n >= l.pages[0] && p.n <= l.pages[1]).slice(0, BOOK_MAX_PAGES) } : null;
}

export interface BoardPageOpts {
  /** 以板为主 */
  page: boolean;
  /** 这块底:孩子最近发的照片(相对 workspace 根);没有 = null */
  photo: string | null;
  /** 这块底上一个字词在哪(认出的字与行框,src/chalk/kit/photo.ts 的 photoLocate);还没认、没认成 = 不给 */
  locate?: (text: string, within?: readonly [number, number, number, number] | null) => [number, number, number, number] | null;
  /** 这块底上第几题在哪(认出的题号与框,分题);还没认、没认出题 = 不给 */
  question?: (no: string) => [number, number, number, number] | null;
  /** 底是课本(base: textbook);没有 = 课本卡画不出来,撤掉 */
  book?: BookBase;
}

const isBookBoard = (c: BoardCard): boolean => c.kind === 'kit' && c.props.kit === BOOK_KIT;
const paramsOf = (c: BoardCard): Record<string, unknown> => (c.props.params && typeof c.props.params === 'object' ? (c.props.params as Record<string, unknown>) : {});

/** 课本卡:填上书、页、课,看 / 圈 / 遮换成框;lesson 是这一张之前板上的那一课。回换好的卡与这一张之后板上是哪一课 */
function fitBook(c: BoardCard, book: BookBase, lesson: string | null, unfound: string[]): { card: BoardCard; lesson: string | null } {
  const p = paramsOf(c);
  const asked = typeof p['课'] === 'string' && p['课'].trim() ? p['课'].trim() : null;
  let at = bookLesson(book.index, asked ?? lesson);
  if (!at && asked) { unfound.push(asked); at = bookLesson(book.index, lesson); }
  if (!at) return { card: c, lesson };
  const pages = at.pages;
  const sheets = bookSheets(pages);
  const blocks = lessonBlocks(pages, book.index.layout);
  const out: Record<string, unknown> = { ...p, 课: at.title, 书: book.file, 页: pages.length > 1 ? `${pages[0].n}-${pages[pages.length - 1].n}` : String(pages[0]?.n ?? '') };
  const look = bookSpots(typeof p['看'] === 'string' ? p['看'] : '')[0];
  let within: [number, number, number, number] | null = look?.box ?? null;
  if (look && !look.box) {
    const t = bookTarget(pages, sheets, blocks, look.text);
    if (t) { within = t.box; out['看'] = `${t.label}|${t.box.join(' ')}`; } else { unfound.push(look.text); out['看'] = ''; }
  }
  for (const key of ['圈', '遮', '盖']) {
    const v = typeof p[key] === 'string' ? (p[key] as string) : '';
    if (!v) continue;
    out[key] = bookSpots(v).flatMap((x) => {
      if (x.box) return [`${x.text}|${x.box.join(' ')}`];
      const box = bookFind(pages, sheets, x.text, within);
      if (!box) { unfound.push(x.text); return []; }
      return [`${x.text}|${box.join(' ')}`];
    }).join(';');
  }
  const def = kitOf(BOOK_KIT);
  const ops = def ? bookOps(book.index.layout, kitOps(def, c.props.ops)) : c.props.ops;
  return { card: { ...c, props: { ...c.props, params: out, ...(ops ? { ops } : {}) } }, lesson: at.title };
}

/** 照片板的「圈」:写的字词换成框;找不到的那一处拿掉 */
function resolveRings(v: string, locate: BoardPageOpts['locate'], unfound: string[], within: readonly [number, number, number, number] | null = null): string {
  return photoRings(v).flatMap((r) => {
    if (r.box) return [r.text ? `${r.text}|${r.box.join(' ')}` : r.box.join(' ')];
    const box = r.text && locate ? locate(r.text, within) : null;
    if (!box) { if (r.text) unfound.push(r.text); return []; }
    return [`${r.text}|${box.join(' ')}`];
  }).join(';');
}

const isPhotoBoard = (c: BoardCard): boolean => c.kind === 'kit' && c.props.kit === '照片';
const photoOf = (c: BoardCard): string => {
  const p = c.props.params;
  return p && typeof p === 'object' && typeof (p as Record<string, unknown>)['图'] === 'string' ? String((p as Record<string, unknown>)['图']) : '';
};

export function boardPageSection(section: BoardSection, opts: BoardPageOpts): { section: BoardSection; dropped: BoardCard[]; unfound: string[] } {
  const unfound: string[] = [];
  const keep: number[] = [];
  const dropped: BoardCard[] = [];
  const cards: BoardCard[] = [];
  const lastKit = opts.page ? section.cards.map((c) => c.kind).lastIndexOf('kit') : -1;
  let lesson = opts.book?.lesson ?? null;
  section.cards.forEach((c, i) => {
    let card = c;
    if (isBookBoard(c)) {
      // 底不是课本(拍照的 activity)画不出来;是课本就填好、换框,一节里几张都留着(窗一步一步移)
      if (!opts.book) { dropped.push(c); return; }
      const fit = fitBook(c, opts.book, lesson, unfound);
      lesson = fit.lesson;
      keep.push(i);
      cards.push(fit.card);
      return;
    }
    if (isPhotoBoard(c) && !photoOf(c)) {
      if (!opts.photo) { dropped.push(c); return; }
      card = { ...c, props: { ...c.props, params: { ...(c.props.params as Record<string, unknown>), 图: opts.photo } } };
    }
    // 框写的是题号(框: 第 3 题):照认出的题换成框;找不到就是整张
    const fr = isPhotoBoard(card) ? photoFrame(String((card.props.params as Record<string, unknown>)['框'] ?? '') || undefined) : null;
    if (fr?.question && !fr.box) {
      const box = photoOf(card) === opts.photo && opts.question ? opts.question(fr.question.replace(/[^0-9]/g, '')) : null;
      if (!box) unfound.push(fr.question);
      card = { ...card, props: { ...card.props, params: { ...(card.props.params as Record<string, unknown>), 框: box ? `${fr.question}|${box.join(' ')}` : '' } } };
    }
    // 圈的、遮拼音的字词:照认出的字换成框
    for (const key of ['圈', '遮']) {
      const v = isPhotoBoard(card) ? (card.props.params as Record<string, unknown>)[key] : undefined;
      // 先找裁出来的那一块里的
      const within = isPhotoBoard(card) ? (photoFrame(String((card.props.params as Record<string, unknown>)['框'] ?? '') || undefined)?.box ?? null) : null;
      if (typeof v === 'string' && v && photoRings(v).some((r) => !r.box)) card = { ...card, props: { ...card.props, params: { ...(card.props.params as Record<string, unknown>), [key]: resolveRings(v, photoOf(card) === opts.photo ? opts.locate : undefined, unfound, within) } } };
    }
    if (opts.page && i !== lastKit) { dropped.push(c); return; }
    keep.push(i);
    cards.push(card);
  });
  if (!dropped.length && cards.every((c, i) => c === section.cards[i])) return { section, dropped, unfound };
  const to = new Map(keep.map((old, n) => [old, n]));
  const lines = section.lines.map((l) => ({
    ...l,
    anchor: l.anchor === null ? null : (to.get(l.anchor) ?? null),
    marks: l.marks.filter((m) => to.has(m.card)).map((m) => ({ ...m, card: to.get(m.card)! })),
    cues: l.cues.filter((q) => to.has(q.card)).map((q) => ({ ...q, card: to.get(q.card)! })),
  }));
  const { layout: _layout, ...rest } = section;
  return { section: { ...rest, ...(dropped.length ? {} : section.layout ? { layout: section.layout } : {}), cards, lines }, dropped, unfound };
}

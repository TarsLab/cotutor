/**
 * 板书一节落到板上之前,应用替老师把住的两件事(纯函数;runner 在流式与定稿时都过一遍):
 * 1. 照片板没写「图」:就是这块底(这个话题里孩子最近发的那张照片)。《画板为主设计》:「底不用再写,缺省就是当前这一块」。
 *    没有底(孩子还没发照片)的照片板画不出来,撤掉。
 * 1b. 照片板的「圈」写的是字词(圈: 蚕):照这块底上认出的字和行框找到它在哪(locate),换成框;找不到的那一处不画(unfound,给家长端记一行)。
 * 2. 以板为主的话题(activity 头上 board: page):板是页面,老师的卡只往板上画——一节只认最后一张板卡,别的卡不给孩子看。
 * 撤掉的卡在讲稿里的引用(锚、敲黑板、[[cue]])跟着重排或撤掉;dropped 是撤掉的卡(给家长端记一行)。
 */
import { photoRings } from '../chalk/index.ts';
import type { BoardCard, BoardSection } from '../schema/index.ts';

export interface BoardPageOpts {
  /** 以板为主 */
  page: boolean;
  /** 这块底:孩子最近发的照片(相对 workspace 根);没有 = null */
  photo: string | null;
  /** 这块底上一个字词在哪(认出的字与行框,src/chalk/kit/photo.ts 的 photoLocate);还没认、没认成 = 不给 */
  locate?: (text: string) => [number, number, number, number] | null;
}

/** 照片板的「圈」:写的字词换成框;找不到的那一处拿掉 */
function resolveRings(v: string, locate: BoardPageOpts['locate'], unfound: string[]): string {
  return photoRings(v).flatMap((r) => {
    if (r.box) return [r.text ? `${r.text}|${r.box.join(' ')}` : r.box.join(' ')];
    const box = r.text && locate ? locate(r.text) : null;
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
  section.cards.forEach((c, i) => {
    let card = c;
    if (isPhotoBoard(c) && !photoOf(c)) {
      if (!opts.photo) { dropped.push(c); return; }
      card = { ...c, props: { ...c.props, params: { ...(c.props.params as Record<string, unknown>), 图: opts.photo } } };
    }
    const rings = isPhotoBoard(card) ? (card.props.params as Record<string, unknown>)['圈'] : undefined;
    if (typeof rings === 'string' && rings && photoRings(rings).some((r) => !r.box)) {
      card = { ...card, props: { ...card.props, params: { ...(card.props.params as Record<string, unknown>), 圈: photoOf(card) === opts.photo ? resolveRings(rings, opts.locate, unfound) : resolveRings(rings, undefined, unfound) } } };
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

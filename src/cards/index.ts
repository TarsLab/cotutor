/**
 * 卡的注册表:加一种卡 = 加一个文件 + 这里一行;解析器、语法表、孩子端剥秘密都从这里走。
 * 页面那一半在 kid-page.ts(渲染)与 kid-board.ts(标注落点),按 kind 名对上。协议文档与结构样式在包根 cards/<kind>/(src/cards/docs.ts)。
 */
import { z } from 'zod';
import type { BoardCard, BoardSection } from '../lib/kid-board.ts';
import { canvas } from './canvas.ts';
import { choice } from './choice.ts';
import { code } from './code.ts';
import { fill } from './fill.ts';
import { tianzige } from './tianzige.ts';
import { image } from './image.ts';
import type { CardKind, CardPlace } from './kind.ts';
import { read } from './read.ts';
import { scene } from './scene.ts';
import { text } from './text.ts';
import { tutor } from './tutor.ts';

export type { CardKind, CardPlace } from './kind.ts';
export { text, TEXT_STYLES, type TextProps, type TextStyle } from './text.ts';
export { read, type ReadProps } from './read.ts';
export { choice, type ChoiceProps } from './choice.ts';
export { fill, type FillProps } from './fill.ts';
export { code, type CodeProps } from './code.ts';
export { image, IMAGE_EXT, type ImageProps } from './image.ts';
export { scene, BUNDLE_ID_RE, type SceneProps, type SceneState } from './scene.ts';
export { canvas, type CanvasProps, type CanvasState } from './canvas.ts';
export { tianzige, HAN, TIANZIGE_MAX, type TianzigeProps } from './tianzige.ts';
export { tutor, BUTTON_LABEL_MAX, TUTOR_BUTTONS_MAX, type TutorButton, type TutorProps } from './tutor.ts';

/** 全部种类:先板书的九种(注册表顺序即技能里的顺序),再首页专属的 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CARD_KINDS: readonly CardKind<any>[] = [text, read, choice, fill, image, tianzige, scene, canvas, code, tutor];

export function cardKind(name: string): CardKind | undefined {
  return CARD_KINDS.find((k) => k.name === name) as CardKind | undefined;
}

/** 这种卡能不能用在这里(没写 where 的只板书) */
export function usableIn(kind: Pick<CardKind, 'where'>, place: CardPlace): boolean {
  return (kind.where ?? ['board']).includes(place);
}

/** 能用在某处的种类(注册表顺序) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function kindsFor(place: CardPlace): readonly CardKind<any>[] {
  return CARD_KINDS.filter((k) => usableIn(k, place));
}

/** 正文是「字」的卡:老师把讲稿的 [词] 标注语法写进这些卡时,把括号剥掉(2026-09-11 真跑:孩子看到了「[直角边]」);choice 的 - [ ] / - [x] 不动 */
const TEXTUAL = new Set(['text', 'read', 'choice', 'fill', 'image']);
const MARK_IN_CARD = /\[([^\[\]\n]+)\]/g;
function unmark(body: string): { body: string; had: boolean } {
  let had = false;
  const out = body.replace(MARK_IN_CARD, (m, inner: string) => {
    if (/^[ xX]$/.test(inner)) return m;
    had = true;
    return inner;
  });
  return { body: out, had };
}

export interface ParsedCard {
  card: BoardCard;
  /** 没解析成时的一句(家长视图转录里显示);孩子端什么也不报 */
  warning?: string;
  /** 没照标签解析成(退成了文字卡 / 代码卡);首页检查据此判「要改」 */
  fallback?: boolean;
}

/**
 * 围栏 → 卡。标签第一个词是 kind,其余是修饰;不认识的标签:板书里当代码卡原样显示,首页里退文字卡;
 * 认识但正文解析不出、或这种卡不能用在这里(place)→ 文字卡显示原文 + warning。永不抛错。
 */
export function parseCard(tag: string, body: string, place: CardPlace = 'board'): ParsedCard {
  const [name, ...mods] = tag.trim().split(/\s+/).filter(Boolean);
  const asText = (why: string): ParsedCard => ({ card: { kind: 'text', props: { text: body.trim() || name || '…' } }, warning: why, fallback: true });
  if (!name) return place === 'board' ? { card: { kind: 'code', props: code.parse(body, []) } } : asText('围栏没写种类');
  const kind = cardKind(name.toLowerCase());
  if (!kind) return place === 'board' ? { card: { kind: 'code', props: code.parse(body, [name]) } } : asText(`不认识的卡:${name}`);
  if (!usableIn(kind, place)) return asText(place === 'board' ? `${name} 是首页的卡,板书里不能用` : `首页放不了 ${name} 卡(它要交给某位老师,只能在板书里)`);
  const um = TEXTUAL.has(kind.name) ? unmark(body) : { body, had: false };
  try {
    const props = kind.props.parse(kind.parse(um.body, mods)) as Record<string, unknown>;
    return { card: { kind: kind.name, props }, ...(um.had ? { warning: `卡里的方括号去掉了:${name} — [词] 标注只写在讲稿句里,不写在卡里` } : {}) };
  } catch (err) {
    const why = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(';') : err instanceof Error ? err.message : String(err);
    return asText(`卡片没解析成:${name} — ${why}`);
  }
}

/** 孩子端的一节:每张卡过本种卡的 strip(答案不下发);不认识的 kind 原样;孩子自己的状态与已生成的资产照给 */
export function stripSecrets(section: BoardSection): BoardSection {
  return {
    ...section,
    cards: section.cards.map((c) => {
      const k = cardKind(c.kind);
      return k?.strip ? { ...c, props: k.strip(c.props) } : c;
    }),
  };
}

/** 一张卡的标题(舞台顶栏、给老师的描述里用):文字卡的 title / text,选择题的问题,其余第一段有字的,田字格的字 */
export function cardLabel(card: BoardCard): string {
  const p = card.props;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const first = s(p.title) || s(p.question) || s(p.text) || s(p.caption) || s(p.prompt) || (Array.isArray(p.segments) ? s(p.segments[0]) : '') || s(p.chars);
  const cps = Array.from(first.replace(/\s+/g, ' '));
  return cps.length > 40 ? `${cps.slice(0, 40).join('')}…` : cps.join('');
}

/** 这张卡要后台预生成的配音(文件名相对它的资产目录);没有的种类 → [] */
export function cardAssets(card: BoardCard): { file: string; text: string }[] {
  const k = cardKind(card.kind);
  if (!k?.assets) return [];
  const r = k.props.safeParse(card.props);
  return r.success ? k.assets(r.data) : [];
}

export type CardStateResult = { ok: true; state: unknown } | { ok: false; why: string };

/** 孩子端 PUT 上来的状态过本种卡的契约;这种卡没有状态、或不认识的 kind → 不收 */
export function parseCardState(card: BoardCard, raw: unknown): CardStateResult {
  const k = cardKind(card.kind);
  if (!k?.state) return { ok: false, why: `${card.kind} 卡没有状态` };
  const r = k.state.safeParse(raw);
  if (!r.success) return { ok: false, why: r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(';') };
  return { ok: true, state: r.data };
}

/**
 * 给老师的一句:「choice「问题」 选了「B …」(答案:「…」)」。props 用索引里的(带答案),状态是孩子的;
 * 没有 describe 的种类把状态原样 JSON。id 由调用方拼在前面(<job>/<n>)。
 */
export function describeCard(card: BoardCard, state: unknown): string {
  const k = cardKind(card.kind);
  const head = `${card.kind}「${cardLabel(card)}」`;
  if (!k?.describe || !k.state) return `${head} ${JSON.stringify(state)}`;
  const r = k.state.safeParse(state);
  return `${head} ${r.success ? k.describe(card.props, r.data) : JSON.stringify(state)}`;
}

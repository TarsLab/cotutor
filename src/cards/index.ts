/**
 * 卡的注册表:加一种卡 = 加一个文件 + 这里一行;解析器、语法表、孩子端剥秘密都从这里走。
 * 页面那一半在 kid-page.ts(渲染)与 kid-board.ts(标注落点),按 kind 名对上。
 */
import { z } from 'zod';
import type { BoardCard, BoardSection } from '../lib/kid-board.ts';
import { canvas } from './canvas.ts';
import { choice } from './choice.ts';
import { code } from './code.ts';
import { fill } from './fill.ts';
import { image } from './image.ts';
import type { CardKind } from './kind.ts';
import { read } from './read.ts';
import { scene } from './scene.ts';
import { text } from './text.ts';

export type { CardKind } from './kind.ts';
export { text, TEXT_STYLES, type TextProps, type TextStyle } from './text.ts';
export { read, type ReadProps } from './read.ts';
export { choice, type ChoiceProps } from './choice.ts';
export { fill, type FillProps } from './fill.ts';
export { code, type CodeProps } from './code.ts';
export { image, IMAGE_EXT, type ImageProps } from './image.ts';
export { scene, BUNDLE_ID_RE, type SceneProps, type SceneState } from './scene.ts';
export { canvas, type CanvasProps, type CanvasState } from './canvas.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CARD_KINDS: readonly CardKind<any>[] = [text, read, choice, fill, image, scene, canvas, code];

export function cardKind(name: string): CardKind | undefined {
  return CARD_KINDS.find((k) => k.name === name) as CardKind | undefined;
}

export interface ParsedCard {
  card: BoardCard;
  /** 没解析成时的一句(家长视图转录里显示);孩子端什么也不报 */
  warning?: string;
}

/**
 * 围栏 → 卡。标签第一个词是 kind,其余是修饰;不认识的标签当代码卡原样显示;
 * 认识但正文解析不出 → 文字卡显示原文 + warning。永不抛错。
 */
export function parseCard(tag: string, body: string): ParsedCard {
  const [name, ...mods] = tag.trim().split(/\s+/).filter(Boolean);
  if (!name) return { card: { kind: 'code', props: code.parse(body, []) } };
  const kind = cardKind(name.toLowerCase());
  if (!kind) return { card: { kind: 'code', props: code.parse(body, [name]) } };
  try {
    const props = kind.props.parse(kind.parse(body, mods)) as Record<string, unknown>;
    return { card: { kind: kind.name, props } };
  } catch (err) {
    const why = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(';') : err instanceof Error ? err.message : String(err);
    return { card: { kind: 'text', props: { text: body.trim() || name } }, warning: `卡片没解析成:${name} — ${why}` };
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

/** 一张卡的标题(舞台顶栏、给老师的描述里用):文字卡的 title / text,选择题的问题,其余第一段有字的 */
export function cardLabel(card: BoardCard): string {
  const p = card.props;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const first = s(p.title) || s(p.question) || s(p.text) || s(p.caption) || s(p.prompt) || (Array.isArray(p.segments) ? s(p.segments[0]) : '');
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

/** 给老师看的语法表(出厂到 workspace 的 .cotutor/板书语法.md;从各种卡的 doc 拼出来,不手写) */
export function boardSyntaxDoc(): string {
  const kinds = CARD_KINDS.map((k) => k.doc.trim()).join('\n\n');
  return `# 板书怎么写

回复正文就是孩子看到的板书,只有两种东西:

- **普通段落 = 你说的话。** 一行一句,每句会被念出来、显示在字幕行,所以不要写标题、列表、粗体、括号注释。句子里用方括号标出要在板上敲的词,如「这叫[底]」,那个词要在某张卡上出现。末句写成问句就停下等孩子。
- **围栏 = 板上的卡。** 围栏的语言标签是卡的种类,后面的词是修饰;正文按各种卡的写法。卡写在讲它的那句话前面,卡与话交错。不认识的标签当代码卡原样显示;正文写得不对的卡退成一段文字,孩子端不会报错。

一节 4–8 张卡、6–12 句话;一次只讲一个想法,讲完就问。随口问答就一两句话,没有卡。**板书写完就停**:最后一个字是问孩子的那句,后面不要再补总结、不要再用工具——孩子看到的是你这轮最后一段话,再补一句板书就丢了。

孩子在卡上做的事(选了、填了)会在下一条消息的上下文包里以 \`cards:\` 段告诉你,一张卡一行(卡的编号、种类、标题、做了什么、答案);孩子只交答案没说话时消息正文是「(交了答案,没说话)」。孩子看到的卡上没有对错,对错由你口头说。上下文包里 \`focus.card\` 是孩子发消息时正开着的那张卡。

对家长说的话、要拍板的事、要转交的事,用「## 家长」「## 待裁量」(question: 一句话;options: 列表)「## 转交」三个段放在正文末尾,孩子看不到;板书到第一个「## 」为止。

## 卡的种类

${kinds}
`;
}

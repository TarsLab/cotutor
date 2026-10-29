/**
 * 板书(孩子端老师页)一节的契约:卡 {kind, props} + 讲稿句。类型在这里;src/board/presentation.ts 内联进页面,只 import type 这几样
 * (剥类型时一起没了)。下面的 zod 与类型对齐,文件底部用赋值断言锁住。每种卡的 props 契约在 src/board/cards/<kind>.ts。
 */
import { z } from 'zod';

/**
 * 一张卡:kind 是种类(text / read / choice / fill / image / code…),props 由那种卡自己定;state 是孩子在卡上做的事(存服务端,形状由那种卡定);
 * assets 是已经生成好的配音文件(相对 conversations/<老师>/,如 2026-09-10.1620-1.cards/2/1.mp3),点读段按 <段号>.mp3 找
 */
export interface BoardCard {
  kind: string;
  props: Record<string, unknown>;
  state?: unknown;
  assets?: string[];
  /** 交给老师过了(服务端按今天交答案那几条算,kid-view 的 submittedCards):锁住,不能改、不能再交 */
  submitted?: boolean;
  /** 样子(围栏行上写的 tint= / look= / emoji=;没有就走机械规则 tintFor / lookFor):底色槽、字形槽、emoji,名字来自主题清单 */
  look?: CardLook;
}

export interface CardLook {
  tint?: string;
  look?: string;
  emoji?: string;
}

/** 五支笔:面类 marker / tint 一下子涂上;线条类 underline / box / circle 是 SVG 路径,描出来 */
export type PenName = 'marker' | 'tint' | 'underline' | 'box' | 'circle';

/** 孩子端是什么端(发消息时带上;渲染器按它量卡、排行) */
export type Device = 'phone' | 'tablet-portrait' | 'tablet-landscape';

/** 一节明写的并排(课文件 / 老师的 same):为哪个端排的、每行哪几张卡(下标;顺序 = 讲的顺序);没有 = 全按宽度排(rowsFor) */
export interface BoardLayout {
  for: Device;
  rows: number[][];
}

/** 一处敲黑板:第几张卡上的哪个词;pen 没有就按 penFor 的机械规则 */
export interface BoardMark {
  card: number;
  phrase: string;
  pen?: PenName;
  /** 讲稿里念到它的那个词(卡上写「三个角」、讲稿说「几个角」时填);没有 = 用 phrase 在讲稿里找。只用来定时,不影响标在卡上哪个词 */
  said?: string;
}

/** 讲到这句时对某张卡做的事(讲稿里 [[名 参数]]):open / close / play… 页面按卡的种类执行,不认识的忽略 */
export interface BoardCue {
  card: number;
  name: string;
  arg?: string;
}

/** 讲稿的一句:配音文件(没有 = 不出声按字数计时,mock 里是浏览器合成)、这句念到时要画的标注、是不是问句(末句问句 → 停下等)、锚到上一张卡 */
export interface BoardLine {
  text: string;
  audio: string | null;
  marks: BoardMark[];
  ask: boolean;
  /** 这句上面最近的一张卡(没有 = null);播到这句就滚到它,不依赖老师打括号 */
  anchor: number | null;
  cues: BoardCue[];
  /** 热身(讲稿的 [[echo 词]] / [[say 词]]):念完等孩子说 word;say = 你先说(老师没说出来) */
  echo?: { word: string; say?: true };
  /** 讲稿的 [[call]]:念完进打电话 */
  call?: true;
}

/** 一节板书 = 一轮回复:卡整块铺,讲稿逐句播;partial = 还在流式生成 */
export interface BoardSection {
  cards: BoardCard[];
  lines: BoardLine[];
  partial?: boolean;
  /** 流式时:前几拍已经就绪(关了)——页面就绪一拍铺一拍卡;定稿的节没有这个字段(全部就绪) */
  ready?: number;
  layout?: BoardLayout;
}


export const BoardCardSchema = z.object({
  kind: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  /** 孩子在卡上做的事(形状由那种卡的 state 契约定);索引里不存,下发孩子端时从 .cards/ 文件并进来 */
  state: z.unknown().optional(),
  /** 已生成好的配音资产(相对 conversations/<老师>/);索引里不存,下发时从 .cards/<n>/ 目录并进来 */
  assets: z.array(z.string()).optional(),
  /** 样子(围栏行上写的):底色槽 / 字形槽 / emoji,名字来自主题清单;没有就走机械规则 */
  look: z.object({ tint: z.string().optional(), look: z.string().optional(), emoji: z.string().optional() }).optional(),
});
export const PenSchema = z.enum(['marker', 'tint', 'underline', 'box', 'circle']);
export const DeviceSchema = z.enum(['phone', 'tablet-portrait', 'tablet-landscape']);
export const BoardMarkSchema = z.object({ card: z.number().int().nonnegative(), phrase: z.string().min(1), pen: PenSchema.optional(), said: z.string().min(1).optional() });
export const BoardLayoutSchema = z.object({ for: DeviceSchema, rows: z.array(z.array(z.number().int().nonnegative())) });
export const BoardCueSchema = z.object({ card: z.number().int().nonnegative(), name: z.string().min(1), arg: z.string().optional() });
export const BoardLineSchema = z.object({
  text: z.string(),
  audio: z.string().nullable(),
  marks: z.array(BoardMarkSchema),
  ask: z.boolean(),
  anchor: z.number().int().nonnegative().nullable(),
  cues: z.array(BoardCueSchema),
  /** 热身的 [[echo 词]] / [[say 词]]:念完等孩子说 word(say = 你先说) */
  echo: z.object({ word: z.string(), say: z.literal(true).optional() }).optional(),
  /** [[call]]:念完进打电话 */
  call: z.literal(true).optional(),
});
export const BoardSectionSchema = z.object({
  cards: z.array(BoardCardSchema),
  lines: z.array(BoardLineSchema),
  partial: z.boolean().optional(),
  ready: z.number().int().nonnegative().optional(),
  /** 排版(围栏行上写的 same,为某个端排的行);没有 = 一行一张 */
  layout: BoardLayoutSchema.optional(),
});

const assertAligned = (s: z.infer<typeof BoardSectionSchema>): BoardSection => s;
void assertAligned;

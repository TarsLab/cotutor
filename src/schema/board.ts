/**
 * 板书(孩子端老师页)一节的契约:卡 {kind, props} + 讲稿句。类型的真相在 src/lib/kid-board.ts(它要内联进页面,不能 import),
 * 这里的 zod 与之对齐,文件底部用赋值断言锁住。每种卡的 props 契约在 src/cards/<kind>.ts。
 */
import { z } from 'zod';
import type { BoardSection } from '../lib/kid-board.ts';

export const BoardCardSchema = z.object({
  kind: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  /** 孩子在卡上做的事(形状由那种卡的 state 契约定);索引里不存,下发孩子端时从 .cards/ 文件并进来 */
  state: z.unknown().optional(),
  /** 已生成好的配音资产(相对 conversations/<老师>/);索引里不存,下发时从 .cards/<n>/ 目录并进来 */
  assets: z.array(z.string()).optional(),
  /** 样子(板书后期定的):底色槽 / 字形槽 / emoji,名字来自主题清单;没有就走机械规则 */
  look: z.object({ tint: z.string().optional(), look: z.string().optional(), emoji: z.string().optional() }).optional(),
});
export const PenSchema = z.enum(['marker', 'tint', 'underline', 'box', 'circle']);
export const DeviceSchema = z.enum(['phone', 'tablet-portrait', 'tablet-landscape']);
export const BoardMarkSchema = z.object({ card: z.number().int().nonnegative(), phrase: z.string().min(1), pen: PenSchema.optional() });
export const BoardLayoutSchema = z.object({ for: DeviceSchema, rows: z.array(z.array(z.number().int().nonnegative())) });
export const BoardCueSchema = z.object({ card: z.number().int().nonnegative(), name: z.string().min(1), arg: z.string().optional() });
export const BoardLineSchema = z.object({
  text: z.string(),
  audio: z.string().nullable(),
  marks: z.array(BoardMarkSchema),
  ask: z.boolean(),
  anchor: z.number().int().nonnegative().nullable(),
  cues: z.array(BoardCueSchema),
});
export const BoardSectionSchema = z.object({
  cards: z.array(BoardCardSchema),
  lines: z.array(BoardLineSchema),
  partial: z.boolean().optional(),
  /** 排版(板书后期为某个端排的行);没有 = 一行一张 */
  layout: BoardLayoutSchema.optional(),
});

const assertAligned = (s: z.infer<typeof BoardSectionSchema>): BoardSection => s;
void assertAligned;

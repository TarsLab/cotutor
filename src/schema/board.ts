/**
 * 一节讲稿(老师的一轮回复)的契约:讲稿一句一行,句子后面的动作念完生效;卡只剩首页的老师牌、听写牌(BoardCard,src/board/cards/)。
 * 类型在这里;src/board/presentation.ts 内联进页面,只 import type 这几样(剥类型时一起没了)。下面的 zod 与类型对齐,文件底部用赋值断言锁住。
 * 2026-11-17(《多模态教学harness-开发计划》阶段 5)起课里没有卡:以前记录里一节的 cards、layout、句子的 marks / anchor / cues 读进来就丢。
 */
import { z } from 'zod';
import { LineActSchema, type LineAct } from './lesson.ts';

/** 孩子端是什么端(发消息时带上,记在消息上) */
export type Device = 'phone' | 'tablet-portrait' | 'tablet-landscape';

/** 首页的一张卡(老师牌 tutor、听写牌 dictation):kind 是种类,props 由那种卡自己定(src/board/cards/<kind>.ts) */
export interface BoardCard {
  kind: string;
  props: Record<string, unknown>;
}

/** 讲稿的一句:是不是问句(末句问句 → 停下等)、请孩子说的、写在这句后面的动作 */
export interface BoardLine {
  text: string;
  ask: boolean;
  /** 请孩子说(讲稿的 [[请 说 词]]):念完等孩子说 word;say = 你先说(老师这句里没说出来) */
  echo?: { word: string; say?: true };
  /** 讲稿里写在这句后面的动作(`[[看 第 3 题]]`):这句念完才生效 */
  acts?: LineAct[];
}

/** 一节讲稿 = 一轮回复:讲稿逐句念;partial = 还在流式生成 */
export interface BoardSection {
  lines: BoardLine[];
  partial?: boolean;
  /** 写在第一句讲稿前面的动作:马上生效(没有讲稿的一节,动作都在这里) */
  acts?: LineAct[];
}

export const DeviceSchema = z.enum(['phone', 'tablet-portrait', 'tablet-landscape']);
export const BoardCardSchema = z.object({
  kind: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
});
export const BoardLineSchema = z.object({
  text: z.string(),
  ask: z.boolean(),
  /** 请孩子说的 [[请 说 词]]:念完等孩子说 word(say = 你先说) */
  echo: z.object({ word: z.string(), say: z.literal(true).optional() }).optional(),
  /** 写在这句后面的动作:念完才生效 */
  acts: z.array(LineActSchema).optional(),
});
export const BoardSectionSchema = z.object({
  lines: z.array(BoardLineSchema),
  partial: z.boolean().optional(),
  /** 写在第一句前面的动作:马上生效 */
  acts: z.array(LineActSchema).optional(),
});

const assertAligned = (s: z.infer<typeof BoardSectionSchema>): BoardSection => s;
void assertAligned;

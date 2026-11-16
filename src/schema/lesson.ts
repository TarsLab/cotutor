/**
 * 一节课(2026-11-16《多模态教学harness-底层设计》):孩子从首页点进一个 activity 到回首页。一节课铺着页,老师一边说一边在页上做动作,孩子在页上写、点、说。
 * 这里是契约:讲稿里的动作(老师写在句子后面的 `[[看 第 3 题]]`)。
 * 词:「动作」是老师对页做的事;解析在 src/board/acts.ts,落到页上(找到框)在 src/board/lesson-fit.ts,一节课的状态怎么变在 src/board/lesson.ts。
 */
import { z } from 'zod';

/**
 * 讲稿里的动作有哪些(《底层设计》第五节):
 * 看(窗移到哪)· 圈、遮(拼音)、盖(印好的答案)· 写(白纸条里写字)· 擦(自己上一样或整条白纸条)· 摆(白纸条里摆图形:点阵、方向盘)· 请(开放哪些作答)· 翻(换一课)
 */
export const ACT_NAMES = ['看', '圈', '遮', '盖', '写', '擦', '摆', '请', '翻'] as const;
export type ActName = (typeof ACT_NAMES)[number];

/** 请孩子做的(开放哪些作答):写、圈、点(点字)、涂、切、转、说、添(点阵上添一个) */
export const ASK_NAMES = ['写', '圈', '点', '涂', '切', '转', '说', '添'] as const;
export type AskName = (typeof ASK_NAMES)[number];

/** 白纸条里的东西多大:档,不写坐标(老师看不见图,位置由应用排) */
export const SIZES = ['大', '中', '小'] as const;
export type Size = (typeof SIZES)[number];

/** 讲稿里的一个动作:名字和老师写的原文(参数已经查过写法;落到页上的样子由 lesson-fit 另填) */
export interface LineAct {
  name: ActName;
  /** 动作后面写的原文(去掉了首尾空白;擦、请也可能是空的) */
  arg: string;
}

export const LineActSchema = z.object({ name: z.enum(ACT_NAMES), arg: z.string() });

const aligned = (a: z.infer<typeof LineActSchema>): LineAct => a;
void aligned;

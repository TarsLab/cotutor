/**
 * 上下文包:应用在每条消息前拼的固定 YAML 块(《cotutor契约草案.md》§2)。老师不用自己找上下文。
 * 孩子由 workspace 决定,不进包。
 */
import { z } from 'zod';

export const MESSAGE_FROM = ['kid', 'parent', 'system'] as const;
export type MessageFrom = (typeof MESSAGE_FROM)[number];

export const FocusSchema = z.object({
  /** 当前对象(产物 id) */
  artifact: z.string().optional(),
  /** 正在看的 step */
  step: z.number().int().nonnegative().optional(),
  /** 圈了什么 */
  circled: z.array(z.string()).optional(),
  /** 孩子发消息时正开着的那张卡(<job>/<n>) */
  card: z.string().optional(),
});
export type Focus = z.infer<typeof FocusSchema>;

export const ContextPackSchema = z.object({
  from: z.enum(MESSAGE_FROM),
  /** 本地时间,分钟精度,如 2026-09-08T16:20 */
  at: z.string().min(1),
  /** 课程表命中的时段,如「数学 16:00-17:00」 */
  slot: z.string().optional(),
  focus: FocusSchema.optional(),
  /** 本周计划里与本老师相关的行(已按 planLines 截) */
  plan: z.array(z.string()).default([]),
  /** 最近 N 条本学科观察(已按 recent 截) */
  recent: z.array(z.object({ date: z.string(), claim: z.string() })).default([]),
  /** 政策旋钮 board = off 时带上,老师只说话不出卡;auto 不写 */
  board: z.enum(['auto', 'off']).optional(),
  /** 上一轮之后孩子改过状态的卡,每张一句(「<job>/<n> choice「问题」 选了「B …」(答案:「…」)」) */
  cards: z.array(z.string()).optional(),
});
export type ContextPack = z.infer<typeof ContextPackSchema>;

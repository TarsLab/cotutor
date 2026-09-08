/**
 * 老师最终文本里的两种固定段(《cotutor契约草案.md》§4 / §6):
 *  - 「## 待裁量」需要家长拍板的问题 + 选项(HoldupAskV0,沿用 growth-apps 的形状);
 *  - 「## 转交」交给另一位老师(HandoffV0,第一期只允许一跳)。
 * 孩子视图剥掉它们;家长视图渲染成按钮;应用按转交 resume 目标老师。解析不出整段当正文——格式是增强不是门槛。
 */
import { z } from 'zod';
import { AGENT_NAME_RE } from './config.ts';

export const HoldupOptionSchema = z.object({
  label: z.string().min(1),
  note: z.string().optional(),
  recommended: z.boolean().optional(),
});
export type HoldupOption = z.infer<typeof HoldupOptionSchema>;

export const HoldupAskSchema = z.object({
  question: z.string().min(1),
  options: z.array(HoldupOptionSchema).default([]),
});
export type HoldupAsk = z.infer<typeof HoldupAskSchema>;

export const HandoffSchema = z.object({
  /** 目标老师(agent 名) */
  to: z.string().regex(AGENT_NAME_RE),
  why: z.string().optional(),
  /** 相关文件或产物引用 */
  refs: z.array(z.string()).default([]),
});
export type Handoff = z.infer<typeof HandoffSchema>;

export const HOLDUP_HEADING = '待裁量';
export const HANDOFF_HEADING = '转交';

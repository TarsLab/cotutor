/**
 * 老师最终文本里的三种固定段(《cotutor契约草案.md》§4 / §6;《obsidian仓库设计.md》§6):
 *  - 「## 待裁量」需要家长拍板的问题 + 选项(HoldupAskV0,沿用 growth-apps 的形状);
 *  - 「## 转交」交给另一位老师(HandoffV0,第一期只允许一跳);
 *  - 「## 记账」记账任务的回答:话题叫什么、属于哪册哪节、摘要、讲解骨架、观察——老师不直接写 vault,应用按它渲染日记。
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

/** 记账段里的一个话题(《obsidian仓库设计.md》§6):只有 thread 与 name 必需;summary / steps 只在话题打分够时才要 */
export const BookkeepingEntrySchema = z.object({
  /** 话题 id(记账任务的上下文包里给了) */
  thread: z.string().min(1),
  /** 话题名,≤ 12 字,日记里的 H2 = 学科 · 话题名 */
  name: z.string().min(1).max(24),
  /** 属于哪册哪节,写成 wikilink 的目标「册#节标题」(教材目录的 H2);认不出就不写 */
  textbook: z.string().optional(),
  /** 1–3 句:讲了什么、难点在哪 */
  summary: z.string().optional(),
  /** 讲解的骨架,一行,步骤用 → 连 */
  steps: z.string().optional(),
  /** 关于孩子、值得别的老师知道的,0–3 条;进日记的「- 观察:」行,是上下文包「最近观察」的来源 */
  observations: z.array(z.string().min(1)).default([]),
});
export type BookkeepingEntry = z.infer<typeof BookkeepingEntrySchema>;

export const BookkeepingSchema = z.object({ entries: z.array(BookkeepingEntrySchema).min(1) });
export type Bookkeeping = z.infer<typeof BookkeepingSchema>;

export const HOLDUP_HEADING = '待裁量';
export const HANDOFF_HEADING = '转交';
export const BOOKKEEPING_HEADING = '记账';

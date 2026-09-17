/**
 * 老师最终文本里的两种固定段(《cotutor契约草案.md》§4 / §6;《obsidian仓库设计.md》§6):
 *  - 「## 待裁量」需要家长拍板的问题 + 选项(HoldupAskV0,沿用 growth-apps 的形状);
 *  - 「## 记账」记账任务的回答:话题叫什么、属于哪册哪节、摘要、讲解骨架、观察——老师不直接写 vault,应用按它渲染日记。
 * 孩子视图剥掉它们;家长视图渲染成按钮。解析不出整段当正文——格式是增强不是门槛。
 * 「## 转交」段 2026-09-17 删了:画图作业由场景卡自己起(server/runner.ts),老师之间不再互相交活;旧回复里的这段落进家长尾巴。
 */
import { z } from 'zod';

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

/** 记账段里的一个话题(《obsidian仓库设计.md》§6):只有 thread 与 name 必需;summary / steps 只在话题打分够时才要 */
export const BookkeepingEntrySchema = z.object({
  thread: z.string().min(1).describe('话题 id;记账任务的消息里给了,原样抄'),
  name: z.string().min(1).max(24).describe('话题名,≤ 12 字;日记里的 H2 = 学科 · 话题名'),
  textbook: z.string().optional().describe('属于哪册哪节,写成 wikilink 的目标「册#节标题」(教材目录的 H2,记账消息里列了可选项,原样抄一条);认不出就不写这行'),
  summary: z.string().optional().describe('1–3 句:讲了什么、难点在哪、孩子哪里卡住;只在家长打分 ≥ keepScore 时才要(消息里要了才写),不够的应用会丢'),
  steps: z.string().optional().describe('讲解的骨架,一行,步骤用 → 连;只在打分够时才要'),
  observations: z.array(z.string().min(1)).default([]).describe('关于孩子、值得别的老师下次知道的,0–3 条;进日记的「- 观察:」行,是上下文包 recent 的来源;没有就不写'),
});
export type BookkeepingEntry = z.infer<typeof BookkeepingEntrySchema>;

export const BookkeepingSchema = z.object({ entries: z.array(BookkeepingEntrySchema).min(1) });
export type Bookkeeping = z.infer<typeof BookkeepingSchema>;

export const HOLDUP_HEADING = '待裁量';
export const BOOKKEEPING_HEADING = '记账';

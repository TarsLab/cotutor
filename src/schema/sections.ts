/**
 * 老师最终文本里的固定段(《obsidian仓库设计.md》§6):只剩「## 记账」——记账任务的回答:话题叫什么、属于哪册哪节、摘要、讲解骨架、观察;
 * 老师不直接写 vault,应用按它渲染日记。孩子视图剥掉它;解析不出整段当正文——格式是增强不是门槛。
 */
import { z } from 'zod';

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

export const BOOKKEEPING_HEADING = '记账';

/**
 * 「## 记忆」段(2026-09-17;2026-09-18 起能改能删):任何一轮都能写,一行一条 `- …`:缺省新增(应用加日期追加),
 * `- 改:原话 → 新的` 改一行,`- 删:原话` 删一行(按原话找,任何一行都能动);落进 vault 里这位 agent 的记忆文件(`cotutor: memory`),
 * 家长在 Obsidian 里读、改、删。讲课的轮每轮最多 MEMORY_MAX_PER_TURN 条,多的丢并提醒;记账后的整理轮不限,整理完不超过 MEMORY_TIDY_CAP 条。老师不直接写文件。
 */
export const MEMORY_HEADING = '记忆';
export const MEMORY_MAX_PER_TURN = 2;
export const MEMORY_TIDY_CAP = 30;

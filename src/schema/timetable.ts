/**
 * 课程表:一周的固定时段(星期 × 时间 × 学科 [× 孩子])。真相是 vault 里的 `课程表.md`(paths.timetable),
 * 家长在 Obsidian 里改一张 markdown 表;解析器在 lib/timetable.ts(抄自 growth-apps,错误即修复指南带行号)。
 * 一孩一 workspace 后「孩子」列可选(《产品规划.md》拍板 5),留着是给多孩共用一张表的家。
 * 课程表只做归类线索(今天有什么、现在是什么时段),不做逻辑约束——孩子任何时候都能找任何老师。
 */
import { z } from 'zod';

export const TIME_RE = /^\d{2}:\d{2}$/;

export const TimetableEntrySchema = z.object({
  /** 1–7 = 周一–周日 */
  day: z.number().int().min(1).max(7),
  start: z.string().regex(TIME_RE),
  end: z.string().regex(TIME_RE),
  /** 自由文本(语文 / 数学 / 英语……),与 tutors[].subject 对齐即归到那位老师 */
  subject: z.string().min(1),
  kid: z.string().optional(),
});
export type TimetableEntry = z.infer<typeof TimetableEntrySchema>;

export const TimetableSchema = z.object({ entries: z.array(TimetableEntrySchema) });
export type Timetable = z.infer<typeof TimetableSchema>;

/**
 * 计划文件 vault/计划/<周>.md(《cotutor契约草案.md》§8):frontmatter week / status / author,
 * 正文按老师分 H2(用显示名,2026-09-08 拍板),行内自由。家长改成 confirmed 即真相。
 */
import { z } from 'zod';

export const PLAN_STATUS = ['draft', 'confirmed'] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];

export const WEEK_RE = /^\d{4}-W\d{2}$/;

export const PlanSectionSchema = z.object({
  /** H2 标题原文(老师显示名,或「家长」等对不上老师的段) */
  title: z.string().min(1),
  /** 该段的非空行(去掉列表符号) */
  lines: z.array(z.string()),
});
export type PlanSection = z.infer<typeof PlanSectionSchema>;

export const PlanSchema = z.object({
  week: z.string().regex(WEEK_RE),
  status: z.enum(PLAN_STATUS),
  author: z.string().optional(),
  sections: z.array(PlanSectionSchema),
});
export type Plan = z.infer<typeof PlanSchema>;

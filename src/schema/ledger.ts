/**
 * 产物账本(《cotutor契约草案.md》§5):artifacts.jsonl,追加式、一行一条、id 唯一;改状态追加新行,同 id 后者为准,不改历史。
 * 观察不在这里(2026-09-14 拍板,《obsidian仓库设计.md》§1):观察的真相是 vault 的日记,老师记账时回「## 记账」段、应用写日记;
 * observations.jsonl 退役。
 */
import { z } from 'zod';

export const ARTIFACT_KINDS = ['课包', '其它'] as const;
export const ARTIFACT_STATUS = ['draft', 'ready', 'retired'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUS)[number];

/** 产物事件行:首行要带 kind / by / path,后续行只带变化的字段 */
export const ArtifactEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ARTIFACT_KINDS).optional(),
  by: z.string().optional(),
  at: z.string().min(1),
  status: z.enum(ARTIFACT_STATUS).optional(),
  path: z.string().optional(),
  source: z.object({ conversation: z.string().min(1), job: z.string().optional() }).optional(),
  /** 做这个产物花的钱与时长(应用在 scene-maker 那轮收尾时追加,老师自己不写) */
  costUsd: z.number().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ArtifactEvent = z.infer<typeof ArtifactEventSchema>;

/** 折叠后的产物 */
export interface Artifact {
  id: string;
  kind: (typeof ARTIFACT_KINDS)[number];
  by: string;
  at: string;
  status: ArtifactStatus;
  path?: string;
  source?: ArtifactEvent['source'];
  costUsd?: number;
  durationMs?: number;
  /** 最后一次事件时间 */
  updatedAt: string;
}

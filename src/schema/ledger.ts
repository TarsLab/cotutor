/**
 * 公共账本(《cotutor契约草案.md》§5):observations.jsonl 与 artifacts.jsonl,追加式、一行一条、id 唯一;
 * 改状态追加新行,同 id 后者为准,不改历史。retracted 用追加行(2026-09-08 拍板)。
 */
import { z } from 'zod';

export const EvidenceSchema = z.union([
  z.object({ conversation: z.string().min(1), job: z.string().optional() }),
  z.object({ artifact: z.string().min(1) }),
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

/** 完整观察行 */
export const ObservationSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  /** 写它的老师(agent 名)或 parent */
  author: z.string().min(1),
  subject: z.string().optional(),
  topic: z.string().optional(),
  /** 一句话 */
  claim: z.string().min(1),
  evidence: EvidenceSchema.optional(),
  retracted: z.boolean().default(false),
});
export type Observation = z.infer<typeof ObservationSchema>;

/** 纠错行:只带 id + retracted + 谁 + 何时 */
export const ObservationRetractSchema = z.object({
  id: z.string().min(1),
  retracted: z.literal(true),
  by: z.string().min(1),
  date: z.string().min(1),
});
export type ObservationRetract = z.infer<typeof ObservationRetractSchema>;

export const ObservationLineSchema = z.union([ObservationSchema, ObservationRetractSchema]);
export type ObservationLine = z.infer<typeof ObservationLineSchema>;

export const ARTIFACT_KINDS = ['课包', '补讲', '批改', '计划', '其它'] as const;
export const ARTIFACT_STATUS = ['draft', 'ready', 'accepted', 'retired'] as const;
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
  /** manifest 指纹,同内容重出验收延续;验收开关关掉时可以没有 accepted 行 */
  hash: z.string().optional(),
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
  hash?: string;
  /** 最后一次事件时间 */
  updatedAt: string;
}

/**
 * 老师回的「## 记忆」「## 记账」怎么进 vault(《vault重构方案》§3,2026-10-30):老师写的是建议,应用校验后提交。
 *  - 建议:「## 记忆」的一条。行首 `孩子:` 是关于孩子本人的(target: child;还没有那篇共用记忆之前照旧写进这位老师的),
 *    行末 `证据:「…」` 是孩子在这个话题里说过的原话。证据对不上孩子说过的就不提交;没写证据的照旧提交,记成 unverified。
 *  - 提交:先在这一轮的索引上记 pending(要写什么、写到哪、写之前的版本),再写 vault,写完把 pending 换成 memoryLines / diaryBlock / booked。
 *    写 vault 与写索引之间断了,下次记账、删话题之前先对照文件里的实际结果补记或丢掉,不重写一遍。
 * 证据只记在 workspace 的索引里,vault 的格式不变。
 */
import { z } from 'zod';

/** 一行记忆的改动:before = 改之前那行(新增为 null),after = 改之后那行(删掉为 null);删话题时按整行原文撤 */
export const MemoryLineSchema = z.object({ before: z.string().nullable(), after: z.string().nullable() });
export type MemoryLine = z.infer<typeof MemoryLineSchema>;

/** 证据对没对上:verified = 孩子说过这句;unverified = 没写证据;rejected = 孩子没说过(不提交) */
export const EVIDENCE_CHECKS = ['verified', 'unverified', 'rejected'] as const;
export type EvidenceCheck = (typeof EVIDENCE_CHECKS)[number];

export const MemoryProposalSchema = z.object({
  /** 去掉 `证据:「…」` 之后的那条,增 / 改 / 删的写法照旧(`孩子:` 前缀留着) */
  item: z.string(),
  /** tutor = 这位老师(或这个 activity)自己的记忆;child = 关于孩子本人的(行首 `孩子:`) */
  target: z.enum(['tutor', 'child']),
  /** 证据:老师抄的孩子原话 */
  quote: z.string().optional(),
  check: z.enum(EVIDENCE_CHECKS),
});
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;

/** 写 vault 之前记下的一笔;写完就换成 memoryLines / diaryBlock(没了这条 = 提交完了) */
export const PendingCommitSchema = z.object({
  memory: z.object({
    /** 记忆文件,相对 vault 根 */
    file: z.string().min(1),
    /** 写之前的版本(textHash);新建的文件为 null */
    base: z.string().nullable(),
    /** 写成之后的版本 */
    hash: z.string().min(1),
    changes: z.array(z.string()),
    lines: z.array(MemoryLineSchema),
  }).optional(),
  diary: z.object({
    /** 日记文件名(<日期>.md) */
    file: z.string().min(1),
    block: z.string().min(1),
    /** 记的是哪个话题的账(写成了就记进索引的 booked) */
    thread: z.string().min(1),
  }).optional(),
});
export type PendingCommit = z.infer<typeof PendingCommitSchema>;

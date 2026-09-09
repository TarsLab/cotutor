/**
 * 会话索引:一老师一天一份(《cotutor契约草案.md》§3)。每条消息 = 一次 -p 运行 = 一份 NDJSON 转录;
 * 索引里的 kidText / artifacts 是精简视图的物化结果,孩子端不解析日志。跨天自动新开(2026-09-08 拍板)。
 */
import { z } from 'zod';
import { FocusSchema, MESSAGE_FROM } from './context-pack.ts';
import { HandoffSchema, HoldupAskSchema } from './sections.ts';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ConversationMessageSchema = z.object({
  /** 任务 id,同时是转录文件名的一段:<date>.<job>.log */
  job: z.string().min(1),
  at: z.string().min(1),
  from: z.enum(MESSAGE_FROM),
  /** 消息原文(不含上下文包) */
  text: z.string(),
  focus: FocusSchema.optional(),
  result: z.enum(['running', 'ok', 'error']).default('running'),
  costUsd: z.number().optional(),
  /** 孩子视图文本;null = 这次运行没有给孩子的话(出错或空) */
  kidText: z.string().nullable().optional(),
  /** 本次运行新增的产物 id */
  artifacts: z.array(z.string()).default([]),
  /** 跑这条用的预设名(agents 里的键);换预设时新开会话 */
  agent: z.string().optional(),
  /** 最终文本里剥出来的「待裁量」段:家长视图渲染成选项按钮(R2 物化,免得页面再解析日志) */
  holdup: HoldupAskSchema.nullable().optional(),
  /** 最终文本里剥出来的「转交」段:R5 起应用据此 resume 目标老师 */
  handoff: HandoffSchema.nullable().optional(),
  /** 不 ok 时的原因(subtype / terminal_reason),家长视图红条 */
  error: z.string().nullable().optional(),
  /** kidText 的配音文件名(conversations/<老师>/ 下,如 2026-09-09.1620-1.mp3);null = 没合成(老师没配音色、tts 预设没配或失败) */
  audio: z.string().nullable().optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ConversationIndexSchema = z.object({
  teacher: z.string().min(1),
  date: z.string().regex(DATE_RE),
  /** 当天会话;首条消息跑完后写入,之后每条 --resume 它 */
  session: z.object({ id: z.string().min(1), agent: z.string().min(1) }).nullable().default(null),
  messages: z.array(ConversationMessageSchema).default([]),
  costUsd: z.number().default(0),
});
export type ConversationIndex = z.infer<typeof ConversationIndexSchema>;

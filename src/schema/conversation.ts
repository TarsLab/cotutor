/**
 * 对话索引:一老师一天一份(《cotutor契约草案.md》§3)。每条消息 = 一次 -p 运行 = 一份 NDJSON 转录;
 * 索引里的 kidText / artifacts 是孩子视图的物化结果,孩子端不解析日志。跨天自动新开(2026-09-08 拍板)。
 */
import { z } from 'zod';
import { FocusSchema, MESSAGE_FROM } from './context-pack.ts';
import { BoardSectionSchema } from './board.ts';
import { HandoffSchema, HoldupAskSchema } from './sections.ts';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TimingSchema = z.object({
  /** 进程起来的时刻(ISO,精确到毫秒;消息的 at 只到分钟) */
  startedAt: z.string().min(1),
  /** 流式时第一张卡闭合(孩子端第一次看到东西);整块出的运行时没有 */
  firstCardMs: z.number().int().nonnegative().optional(),
  /** 老师进程退出 */
  doneMs: z.number().int().nonnegative().optional(),
  /** 讲稿配音收尾(索引写好、孩子端能播的那一刻);没配音就没有 */
  dubbedMs: z.number().int().nonnegative().optional(),
});
export type Timing = z.infer<typeof TimingSchema>;

export const SessionSchema = z.object({ id: z.string().min(1), runtime: z.string().min(1) });
export type Session = z.infer<typeof SessionSchema>;

export const ConversationMessageSchema = z.object({
  /** 一轮的 id(job),也是转录文件名的一段:<date>.<job>.log */
  job: z.string().min(1),
  /** 话题 id = 话题第一条消息的 job(2026-09-11 拍板:一个话题 = 一段连续问答 = 老师的一个会话;一天可多个)。旧索引没有:读时按 threadOf 现算 */
  thread: z.string().optional(),
  at: z.string().min(1),
  from: z.enum(MESSAGE_FROM),
  /** 消息原文(不含上下文包) */
  text: z.string(),
  focus: FocusSchema.optional(),
  /** 孩子端的两个不打字的动作:继续(不计每日上限)/ 交给老师(把卡上的状态交出去) */
  action: z.enum(['continue', 'submit']).optional(),
  result: z.enum(['running', 'ok', 'error']).default('running'),
  costUsd: z.number().optional(),
  /** 孩子视图文本;null = 这次运行没有给孩子的话(出错或空) */
  kidText: z.string().nullable().optional(),
  /** 本次运行新增的产物 id */
  artifacts: z.array(z.string()).default([]),
  /** 跑这条用的运行时名(runtimes 里的键);换运行时时新开会话 */
  runtime: z.string().optional(),
  /** 最终文本里剥出来的「待裁量」段:家长视图渲染成选项按钮(R2 物化,免得页面再解析日志) */
  holdup: HoldupAskSchema.nullable().optional(),
  /** 最终文本里剥出来的「转交」段:应用据此自动起目标老师的一轮(from: system) */
  handoff: HandoffSchema.nullable().optional(),
  /** 自动转交起的那一轮:目标老师与 job;没起(上限、忙、老师不在)的原因在 warnings */
  handoffJob: z.object({ tutor: z.string(), job: z.string() }).nullable().optional(),
  /** 不 ok 时的原因(subtype / terminal_reason),家长视图红条 */
  error: z.string().nullable().optional(),
  /** 最终文本解析出的板书节(卡 + 讲稿;孩子端下发前剥答案);null = 这轮没有 */
  section: BoardSectionSchema.nullable().optional(),
  /** 最终文本里第一个 H2 起给家长的尾巴(「## 家长」等),孩子看不到 */
  parentText: z.string().optional(),
  /** 解析板书时的提醒(卡没解析成等),家长视图显示;孩子端不报 */
  warnings: z.array(z.string()).optional(),
  /** 这条消息带给老师的卡(上一轮之后孩子改过状态的):id 与 describe 出的那句;家长视图显示「孩子在板书上做的」 */
  cards: z.array(z.object({ card: z.string().min(1), text: z.string() })).optional(),
  /** kidText 的配音文件名(conversations/<老师>/ 下,如 2026-09-09.1620-1.mp3);null = 没合成(老师没配音色、tts 运行时没配或失败) */
  audio: z.string().nullable().optional(),
  /** 这轮的用时(埋点,2026-09-11):都是从 startedAt 起的毫秒数;家长视图每轮一行「首卡 10s · 整轮 23s」 */
  timing: TimingSchema.optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ConversationIndexSchema = z.object({
  tutor: z.string().min(1),
  date: z.string().regex(DATE_RE),
  /** 当前话题(末条消息所在)的会话;首条消息跑完后写入。每个话题自己的会话在 sessions 里,这里只是最新那条(旧索引只有它) */
  session: SessionSchema.nullable().default(null),
  /** 话题 id → 那个话题的会话;今天的旧话题接着聊就 resume 它(2026-09-11 拍板) */
  sessions: z.record(z.string(), SessionSchema).default({}),
  messages: z.array(ConversationMessageSchema).default([]),
  costUsd: z.number().default(0),
});
export type ConversationIndex = z.infer<typeof ConversationIndexSchema>;

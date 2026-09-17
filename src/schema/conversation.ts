/**
 * 对话索引:一老师一天一份(《cotutor契约草案.md》§3)。每条消息 = 一次 -p 运行 = 一份 NDJSON 转录;
 * 索引里的 kidText / artifacts 是孩子视图的物化结果,孩子端不解析日志。跨天自动新开(2026-09-08 拍板)。
 */
import { z } from 'zod';
import { FocusSchema, MESSAGE_FROM } from './context-pack.ts';
import { BoardSectionSchema, DeviceSchema } from './board.ts';
import { BookkeepingSchema } from './sections.ts';
import { MessageViaSchema } from './home.ts';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TimingSchema = z.object({
  /** 进程起来的时刻(ISO,精确到毫秒;消息的 at 只到分钟) */
  startedAt: z.string().min(1),
  /** 流式时第一张卡闭合(孩子端第一次看到东西);整块出的运行时没有 */
  firstCardMs: z.number().int().nonnegative().optional(),
  /** 首拍就绪:第一拍配音齐(以后加后期回),孩子端能开播的那一刻(2026-09-13,头号埋点) */
  firstReadyMs: z.number().int().nonnegative().optional(),
  /** 老师进程退出 */
  doneMs: z.number().int().nonnegative().optional(),
  /** 讲稿配音收尾(索引写好、孩子端能播的那一刻);没配音就没有 */
  dubbedMs: z.number().int().nonnegative().optional(),
  /** 板书后期收尾(标注 / 排版 / 样子回来);没起就没有 */
  postMs: z.number().int().nonnegative().optional(),
  /** 每拍(2026-09-13,从事件推):关、配音齐、后期回、就绪 */
  beats: z.array(z.object({ card: z.number().int().nonnegative().nullable(), closedMs: z.number().int().nonnegative().optional(), dubbedMs: z.number().int().nonnegative().optional(), postMs: z.number().int().nonnegative().optional(), readyMs: z.number().int().nonnegative().optional() })).optional(),
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
  /** 这条消息带的作业照片(R5,2026-09-14):相对 workspace 根的路径(captures/<日期>/<HHMM>-<n>.jpg),上下文包 photos: 段原样给老师 Read;日记永不引用它 */
  photos: z.array(z.string().min(1)).optional(),
  result: z.enum(['running', 'ok', 'error']).default('running'),
  costUsd: z.number().optional(),
  /** 孩子视图文本;null = 这次运行没有给孩子的话(出错或空) */
  kidText: z.string().nullable().optional(),
  /** 本次运行新增的产物 id */
  artifacts: z.array(z.string()).default([]),
  /** 跑这条用的运行时名(runtimes 里的键);换运行时时新开会话 */
  runtime: z.string().optional(),
  /** 这轮板书里的新场景卡起的画图作业(scene-maker 的 job;没起的 job 为 null,原因在 warnings) */
  scenes: z.array(z.object({ bundle: z.string().min(1), job: z.string().nullable() })).optional(),
  /** 不 ok 时的原因(subtype / terminal_reason),家长视图红条 */
  error: z.string().nullable().optional(),
  /** 最终文本解析出的板书节(卡 + 讲稿;孩子端下发前剥答案);null = 这轮没有 */
  section: BoardSectionSchema.nullable().optional(),
  /** 最终文本里第一个 H2 起给家长的尾巴(老师写的任何标题段),孩子看不到 */
  parentText: z.string().optional(),
  /** 解析板书时的提醒(卡没解析成等),家长视图显示;孩子端不报 */
  warnings: z.array(z.string()).optional(),
  /** 这轮「## 记忆」段真追加进 vault 记忆文件的行(带日期);家长视图显示 */
  remembered: z.array(z.string()).optional(),
  /** 这轮上下文包里家长笔记的版本:role(profile / entry)→ `路径@hash`;同一话题下一轮对得上就只写「未变」(2026-09-17) */
  notes: z.record(z.string(), z.string()).optional(),
  /** 这条消息带给老师的卡(上一轮之后孩子改过状态的):id 与 describe 出的那句;家长视图显示「孩子在板书上做的」 */
  cards: z.array(z.object({ card: z.string().min(1), text: z.string() })).optional(),
  /** 这轮的用时(埋点,2026-09-11):都是从 startedAt 起的毫秒数;家长视图每轮一行「首卡 10s · 整轮 23s」 */
  timing: TimingSchema.optional(),
  /** 发这条时孩子端是什么端(板书后期按它排版;缺省当平板横屏) */
  device: DeviceSchema.optional(),
  /** 板书后期的结果:收没收到、用时、费用、丢了几条提案;没起(关了 / 没卡)就没有。细节在 <日期>.<job>.post.json */
  post: z.object({ ok: z.boolean(), ms: z.number().int().nonnegative(), costUsd: z.number().optional(), dropped: z.number().int().nonnegative(), error: z.string().optional(), beats: z.number().int().nonnegative().optional(), failed: z.number().int().nonnegative().optional() }).optional(),
  /** 这轮是给某个话题记账的任务(from: system,resume 那个话题的会话);跑完老师回的「## 记账」段经应用落进日记 */
  bookkeep: z.object({ thread: z.string().min(1) }).optional(),
  /** 最终文本里剥出来的「## 记账」段(物化;日记已按它写好);null = 这轮没有 */
  bookkeeping: BookkeepingSchema.nullable().optional(),
  /** 这轮模型用了哪些工具、读了什么(2026-09-15,从 .log 抽,lib/transcript.ts toolCalls):名字、最要紧的参数、成没成、结果多少字。家长端「看原文」的「读了什么」站;cotutor show 也吐 */
  tools: z.array(z.object({ name: z.string().min(1), arg: z.string(), ok: z.boolean().nullable(), chars: z.number().int().nonnegative(), sub: z.boolean().optional() })).optional(),
  /** 这条是回放(cotutor replay,server/replay.ts):原轮的 job。回放落在 evals/ 里,不在 conversations/ */
  replayOf: z.string().min(1).optional(),
  /** 孩子从首页哪个按钮进来的(《首页设计.md》§5.2);开场按钮的 text 就是按钮上的字,不是孩子说的 */
  via: MessageViaSchema.optional(),
  /** 这个话题接着以前哪天的哪个话题(首页的「接着」按钮;新会话,上下文包带那个话题的尾巴) */
  continues: z.object({ date: z.string().regex(DATE_RE), thread: z.string().min(1) }).optional(),
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
  /** 话题 id → 家长打的星(1–5;《obsidian仓库设计.md》§4:打分的单位是话题;≥ vault.keepScore 记账时才沉淀摘要) */
  ratings: z.record(z.string(), z.number().int().min(1).max(5)).default({}),
  /** 话题 id → 记账那轮的 job(记过的不再记;日记里已有这个话题的一段) */
  booked: z.record(z.string(), z.string().min(1)).default({}),
});
export type ConversationIndex = z.infer<typeof ConversationIndexSchema>;

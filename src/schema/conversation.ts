/**
 * 对话索引:一老师一天一份。每条消息 = 一次 -p 运行 = 一份 NDJSON 转录;
 * 索引里的 kidText / artifacts 是孩子视图的物化结果,孩子端不解析日志。跨天自动新开。
 */
import { z } from 'zod';
import { FocusSchema, MESSAGE_FROM } from './context-pack.ts';
import { BoardSectionSchema, DeviceSchema } from './board.ts';
import { BookkeepingSchema } from './sections.ts';
import { MessageViaSchema } from './home.ts';
import { ActivityRunSchema } from './activity.ts';
import { MemoryLineSchema, MemoryProposalSchema, PendingCommitSchema } from './memory.ts';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 孩子端设备的编号:服务端种的 cookie,随机 12 位十六进制 */
export const DEVICE_ID_RE = /^[0-9a-f]{12}$/;

export const TimingSchema = z.object({
  /** 进程起来的时刻(ISO,精确到毫秒;消息的 at 只到分钟) */
  startedAt: z.string().min(1),
  /** 这轮用的是提前起好的老师进程(预热,2026-09-29);startedAt 仍是孩子开口那刻 */
  warm: z.literal(true).optional(),
  /** 流式时第一张卡闭合(孩子端第一次看到东西);整块出的运行时没有 */
  firstCardMs: z.number().int().nonnegative().optional(),
  /** 首句就绪:嘴能开口的那一刻(头号埋点),第一拍关了就算(讲稿不配音) */
  firstReadyMs: z.number().int().nonnegative().optional(),
  /** 老师进程退出 */
  doneMs: z.number().int().nonnegative().optional(),
  /** 每拍(2026-09-13,从事件推):关、就绪 */
  beats: z.array(z.object({ card: z.number().int().nonnegative().nullable(), closedMs: z.number().int().nonnegative().optional(), readyMs: z.number().int().nonnegative().optional() })).optional(),
});
export type Timing = z.infer<typeof TimingSchema>;

export const SessionSchema = z.object({ id: z.string().min(1), runtime: z.string().min(1) });
export type Session = z.infer<typeof SessionSchema>;

const MessageObjectSchema = z.object({
  /** 一轮的 id(job),也是转录文件名的一段:<date>.<job>.log */
  job: z.string().min(1),
  /** 话题 id = 话题第一条消息的 job(一个话题 = 一段连续问答 = 老师的一个会话;一天可多个)。旧索引没有:读时按 threadOf 现算 */
  thread: z.string().optional(),
  at: z.string().min(1),
  /** 谁发的:孩子(孩子端、工作台、cotutor send 都算)或应用派的任务 */
  from: z.enum(MESSAGE_FROM),
  /** 消息原文(不含上下文包) */
  text: z.string(),
  focus: FocusSchema.optional(),
  /** 孩子端不打字的动作:交给老师(把卡上的状态交出去) */
  action: z.enum(['submit']).optional(),
  /** 这条消息带的作业照片(R5,2026-09-14):相对 workspace 根的路径(captures/<日期>/<HHMM>-<n>.jpg),上下文包 photos: 段原样给老师 Read;日记永不引用它 */
  photos: z.array(z.string().min(1)).optional(),
  result: z.enum(['running', 'ok', 'error']).default('running'),
  /** 这一轮的 token:输入(含缓存读)与输出;记账、显示都按它(src/shared/tokens.ts)。运行时没报(出错没收尾)就没有 */
  /** cached = 输入里命中缓存的,context = 最后一次请求的输入(这一轮结束时上下文多大);这两样只有 API 运行时报 */
  tokens: z.object({ in: z.number().int().nonnegative(), out: z.number().int().nonnegative(), cached: z.number().int().nonnegative().optional(), context: z.number().int().nonnegative().optional() }).optional(),
  /** 老数据:2026-10-28 之前 claude 那几轮记的美元。不再写、不显示,留在这里免得改写索引时丢掉 */
  costUsd: z.number().optional(),
  /** 孩子视图文本;null = 这次运行没有给孩子的话(出错或空) */
  kidText: z.string().nullable().optional(),
  /** 本次运行新增的产物 id */
  artifacts: z.array(z.string()).default([]),
  /** 跑这条用的运行时名(runtimes 里的键);换运行时时新开会话 */
  runtime: z.string().optional(),
  /** 不 ok 时的原因(subtype / terminal_reason),家长视图红条 */
  error: z.string().nullable().optional(),
  /** 最终文本解析出的板书节(卡 + 讲稿;孩子端下发前剥答案);null = 这轮没有 */
  section: BoardSectionSchema.nullable().optional(),
  /** 最终文本里第一个 H2 起给家长的尾巴(老师写的任何标题段),孩子看不到 */
  parentText: z.string().optional(),
  /** 解析板书时的提醒(卡没解析成等),家长视图显示;孩子端不报 */
  warnings: z.array(z.string()).optional(),
  /** 这轮「## 记忆」段真落进 vault 记忆文件的改动:新增的行(带日期)、「改:旧 → 新」、「删:旧」;进孩子的记忆的前面加「孩子的记忆:」;家长视图显示 */
  remembered: z.array(z.string()).optional(),
  /** 同一批改动的整行原文(删话题时按它撤销,2026-10-05):before = 改之前那行(新增的为 null),after = 改之后那行(删掉的为 null) */
  memoryLines: z.array(MemoryLineSchema).optional(),
  /** 同上,写进孩子的记忆(`agent: all`)的那几行(2026-10-30) */
  childLines: z.array(MemoryLineSchema).optional(),
  /** 记账那轮追加进日记的那一段原文(删话题时从日记里摘掉,2026-10-05) */
  diaryBlock: z.string().optional(),
  /** 这轮「## 记忆」段的每一条建议与证据对没对上(2026-10-30,schema/memory.ts);家长视图看哪些没证据、哪些对不上没记 */
  memoryProposals: z.array(MemoryProposalSchema).optional(),
  /** 写 vault 之前记的一笔,写完就没了;还在 = 写到一半断了,下次记账、删话题之前对照文件补记或丢掉(schema/memory.ts) */
  pending: PendingCommitSchema.optional(),
  /** 这轮上下文包里家长笔记的版本:role(profile / entry)→ `路径@hash`;同一话题下一轮对得上就只写「未变」(2026-09-17) */
  notes: z.record(z.string(), z.string()).optional(),
  /** 这条消息带给老师的卡(上一轮之后孩子改过状态的):id 与 describe 出的那句;家长视图显示「孩子在板书上做的」 */
  cards: z.array(z.object({ card: z.string().min(1), text: z.string() })).optional(),
  /** 这轮的用时(埋点,2026-09-11):都是从 startedAt 起的毫秒数;家长视图每轮一行「首卡 10s · 整轮 23s」 */
  timing: TimingSchema.optional(),
  /** 发这条时孩子端是什么端(缺省当平板横屏) */
  device: DeviceSchema.optional(),
  /** 哪一台设备:服务端种的 cookie 编号;工作台、cotutor send 发的没有 */
  deviceId: z.string().regex(DEVICE_ID_RE).optional(),
  /** 这轮是给某个话题记账的任务(from: system,resume 那个话题的会话);跑完老师回的「## 记账」段经应用落进日记 */
  bookkeep: z.object({ thread: z.string().min(1) }).optional(),
  /** 这轮是记账后整理记忆的任务(from: system,新会话;2026-09-18):老师回「## 记忆」段的一串增 / 改 / 删,不受每轮条数上限;孩子端看不到 */
  tidy: z.literal(true).optional(),
  /** 这一轮整段压缩过(API 运行时,上一轮结束时上下文过了 32k):之前的模型历史不再发,前情由应用照索引拼(src/runtime/context/thread-digest.ts) */
  compacted: z.literal(true).optional(),
  /** 最终文本里剥出来的「## 记账」段(物化;日记已按它写好);null = 这轮没有 */
  bookkeeping: BookkeepingSchema.nullable().optional(),
  /** 这轮模型用了哪些工具、读了什么(2026-09-15,从 .log 抽,brain/transcript.ts toolCalls):名字、最要紧的参数、成没成、结果多少字。家长端「看原文」的「读了什么」站;cotutor show 也吐 */
  tools: z.array(z.object({ name: z.string().min(1), arg: z.string(), ok: z.boolean().nullable(), chars: z.number().int().nonnegative(), sub: z.boolean().optional() })).optional(),
  /** 这条是回放(cotutor replay,app/replay.ts):原轮的 job。回放落在 evals/ 里,不在 conversations/ */
  replayOf: z.string().min(1).optional(),
  /** 这条是 cotutor activity eval 跑的(落在 evals/,模拟孩子):同回放,不写记忆、不预热 */
  eval: z.literal(true).optional(),
  /** 这一轮走实时:讲稿没配音,由 realtime 模型(嘴)照念;孩子端放的是嘴的声音,以前的话题里这几句不出声 */
  live: z.literal(true).optional(),
  /**
   * 这条是孩子看完小课堂后的第一条:哪份课包、课名、看了多久、看完没、停过几次、画过的几处;节前的小课堂卡与画的卡从这里画。
   * again = 问过以后「再看一遍」又画了,这条只为带上新画的(节前只画画的卡)。一处画:时刻、SVG 停在哪(缩略图)、几笔(课包坐标)、给老师的那段话、截图
   */
  lecture: z
    .object({
      bundle: z.string().min(1),
      title: z.string(),
      watchedMs: z.number().nonnegative(),
      finished: z.boolean(),
      pauses: z.number().int().nonnegative(),
      again: z.literal(true).optional(),
      /** 视频小课堂(lectures/<id>/);没有 = 课包 */
      video: z.literal(true).optional(),
      /** 一处 = 停在同一刻画的几笔;截图在 captures/ 里(画面叠上那几笔;路径相对 workspace 根)。2026-10-19 以前一笔一处(path),读成一笔的 strokes */
      marks: z.array(z.object({ atMs: z.number().nonnegative(), svgMs: z.number().nonnegative(), strokes: z.array(z.array(z.tuple([z.number(), z.number()]))), text: z.string().optional(), image: z.string().optional(), t: z.number().optional() })).optional(),
      /**
       * 看的过程(录像用第 5 步):放 / 停 / 拖到哪 / 放完,一次一条。t = 离这条消息发出去多少毫秒(≤ 0,孩子端自己的钟算,
       * 不用对钟);pos = 那时停在课里的哪一刻;play = 那之后在放。画的 t 同理(这一处第一笔画下去的那一刻)
       */
      log: z.array(z.object({ t: z.number(), pos: z.number().nonnegative(), play: z.boolean() })).optional(),
    })
    .optional(),
  /**
   * 孩子从左栏的纸「给老师看」交的画:图在 captures/(相对 workspace 根)、几笔、各颜色几笔(「黑 12、红 40」)、
   * 画了多久(第一笔到最后一笔,算上清空前那几版)、清空前存的那几版的图。板上节前一张孩子的画卡从这里画;图和清掉的那几版进上下文包 photos 给老师 Read
   */
  drawing: z
    .object({
      image: z.string().min(1),
      strokes: z.number().int().nonnegative(),
      colors: z.string().optional(),
      ms: z.number().nonnegative().optional(),
      cleared: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  /** 孩子从首页哪个按钮进来的;开场按钮的 text 就是按钮上的字,不是孩子说的 */
  via: MessageViaSchema.optional(),
  /** 这个话题是从哪个 activity 起的(只记在话题第一条):名字与点的那一刻的参数,话题后面每条都照它带 */
  activity: ActivityRunSchema.optional(),
  /** 口语课页的哪份口语单起的这个话题(talk/<id>/ 4,只记在话题第一条) */
  talk: z.string().optional(),
  /** 这个话题接着以前哪天的哪个话题(首页的「接着」按钮;新会话,上下文包带那个话题的尾巴) */
  continues: z.object({ date: z.string().regex(DATE_RE), thread: z.string().min(1) }).optional(),
});

export const ConversationMessageSchema = MessageObjectSchema;
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ConversationIndexSchema = z.object({
  tutor: z.string().min(1),
  date: z.string().regex(DATE_RE),
  /** 当前话题(末条消息所在)的会话;首条消息跑完后写入。每个话题自己的会话在 sessions 里,这里只是最新那条(旧索引只有它) */
  session: SessionSchema.nullable().default(null),
  /** 话题 id → 那个话题的会话;今天的旧话题接着聊就 resume 它 */
  sessions: z.record(z.string(), SessionSchema).default({}),
  messages: z.array(ConversationMessageSchema).default([]),
  /** 话题 id → 家长打的星(1–5;《obsidian仓库设计.md》§4:打分的单位是话题;≥ vault.keepScore 记账时才沉淀摘要) */
  ratings: z.record(z.string(), z.number().int().min(1).max(5)).default({}),
  /** 话题 id → 记账那轮的 job(记过的不再记;日记里已有这个话题的一段) */
  booked: z.record(z.string(), z.string().min(1)).default({}),
});
export type ConversationIndex = z.infer<typeof ConversationIndexSchema>;

/**
 * 每条消息的话题 id(与 messages 对齐)。有 thread 字段照它;没有(旧索引)按规则现算:第一条 = 自己的 job,
 * from: system 的(记账、整理记忆这类)永远开新话题,其余跟前一条。写新消息时 runner 已经填了 thread,这里只是兜底。
 */
export function threads(messages: readonly Pick<ConversationMessage, 'job' | 'from' | 'thread'>[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => out.push(m.thread ?? (i === 0 || m.from === 'system' ? m.job : out[i - 1])));
  return out;
}

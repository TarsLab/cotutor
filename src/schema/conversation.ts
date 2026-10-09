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
  /** 这轮用的是提前起好的老师进程(预热,2026-09-29);startedAt 仍是孩子开口那刻 */
  warm: z.literal(true).optional(),
  /** 流式时第一张卡闭合(孩子端第一次看到东西);整块出的运行时没有 */
  firstCardMs: z.number().int().nonnegative().optional(),
  /** 首句就绪:孩子端能开口的那一刻(头号埋点)。2026-10-08 起是第一句配好(《工作流程.md》拍板 15),之前是第一拍配音齐 */
  firstReadyMs: z.number().int().nonnegative().optional(),
  /** 老师进程退出 */
  doneMs: z.number().int().nonnegative().optional(),
  /** 讲稿配音收尾(索引写好、孩子端能播的那一刻);没配音就没有 */
  dubbedMs: z.number().int().nonnegative().optional(),
  /** 每拍(2026-09-13,从事件推):关、配音齐、就绪 */
  beats: z.array(z.object({ card: z.number().int().nonnegative().nullable(), closedMs: z.number().int().nonnegative().optional(), dubbedMs: z.number().int().nonnegative().optional(), readyMs: z.number().int().nonnegative().optional() })).optional(),
});
export type Timing = z.infer<typeof TimingSchema>;

export const SessionSchema = z.object({ id: z.string().min(1), runtime: z.string().min(1) });
export type Session = z.infer<typeof SessionSchema>;

const MessageObjectSchema = z.object({
  /** 一轮的 id(job),也是转录文件名的一段:<date>.<job>.log */
  job: z.string().min(1),
  /** 话题 id = 话题第一条消息的 job(2026-09-11 拍板:一个话题 = 一段连续问答 = 老师的一个会话;一天可多个)。旧索引没有:读时按 threadOf 现算 */
  thread: z.string().optional(),
  at: z.string().min(1),
  /** 谁发的:孩子(孩子端、工作台、cotutor send 都算)或应用派的任务。旧索引的 parent 读时改过来(legacyFrom) */
  from: z.enum(MESSAGE_FROM),
  /** 消息原文(不含上下文包) */
  text: z.string(),
  focus: FocusSchema.optional(),
  /** 孩子端的两个不打字的动作:继续(不计每日上限)/ 交给老师(把卡上的状态交出去) */
  action: z.enum(['continue', 'submit']).optional(),
  /** 按住说话时的原声(2026-09-29,《家长录像设计.md》拍板 4):audio = 相对 conversations/<老师>/ 的 <日期>.<job>.voice.<ext>,seconds = 按住多久。
   *  只给家长端(录像里在开口那一刻放、旁注上能听,看识别认得对不对);孩子端、老师、上下文包都不给 */
  voice: z.object({ audio: z.string().min(1), seconds: z.number().positive() }).optional(),
  /** 按住说话是怎么听成字的(2026-10-09 起试 omni):kid.listen 是 omni 时记两份——browser 是浏览器识别边听边出的字(没有识别就没有),
   *  omni 是原声交给 qwen omni 听写出来的(没听出字 = 空串;没成就不写、记 error),ms 是听写那一下花了多久;text 用的是 omni 的,没成退回浏览器的。只给家长端对照 */
  listened: z.object({ browser: z.string().optional(), omni: z.string().optional(), model: z.string().optional(), ms: z.number().nonnegative().optional(), error: z.string().optional() }).optional(),
  /** 这条消息带的作业照片(R5,2026-09-14):相对 workspace 根的路径(captures/<日期>/<HHMM>-<n>.jpg),上下文包 photos: 段原样给老师 Read;日记永不引用它 */
  photos: z.array(z.string().min(1)).optional(),
  result: z.enum(['running', 'ok', 'error']).default('running'),
  /** 这一轮花了多少(美元)。claude 接着会话跑(--resume)报的是整个会话的累计,这里记的是减掉同一话题上一轮的累计之后的 */
  costUsd: z.number().optional(),
  /** 运行时不报钱数时(qwen,《agent层设计.md》§6)这一轮的 token:输入(含缓存读)与输出;报钱数的运行时不记 */
  tokens: z.object({ in: z.number().int().nonnegative(), out: z.number().int().nonnegative() }).optional(),
  /** 运行时报的花费原数(新版 claude 续会话时是累计)与那时的累计输出 token;下一轮拿它们判断、算自己花了多少。没有 = 老数据 */
  sessionUsd: z.number().optional(),
  sessionOut: z.number().optional(),
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
  /** 这轮「## 记忆」段真落进 vault 记忆文件的改动:新增的行(带日期)、「改:旧 → 新」、「删:旧」;家长视图显示 */
  remembered: z.array(z.string()).optional(),
  /** 同一批改动的整行原文(删话题时按它撤销,2026-10-05):before = 改之前那行(新增的为 null),after = 改之后那行(删掉的为 null) */
  memoryLines: z.array(z.object({ before: z.string().nullable(), after: z.string().nullable() })).optional(),
  /** 记账那轮追加进日记的那一段原文(删话题时从日记里摘掉,2026-10-05) */
  diaryBlock: z.string().optional(),
  /** 这轮上下文包里家长笔记的版本:role(profile / entry)→ `路径@hash`;同一话题下一轮对得上就只写「未变」(2026-09-17) */
  notes: z.record(z.string(), z.string()).optional(),
  /** 这条消息带给老师的卡(上一轮之后孩子改过状态的):id 与 describe 出的那句;家长视图显示「孩子在板书上做的」 */
  cards: z.array(z.object({ card: z.string().min(1), text: z.string() })).optional(),
  /** 这轮的用时(埋点,2026-09-11):都是从 startedAt 起的毫秒数;家长视图每轮一行「首卡 10s · 整轮 23s」 */
  timing: TimingSchema.optional(),
  /** 发这条时孩子端是什么端(缺省当平板横屏) */
  device: DeviceSchema.optional(),
  /** 这轮是给某个话题记账的任务(from: system,resume 那个话题的会话);跑完老师回的「## 记账」段经应用落进日记 */
  bookkeep: z.object({ thread: z.string().min(1) }).optional(),
  /** 这轮是记账后整理记忆的任务(from: system,新会话;2026-09-18):老师回「## 记忆」段的一串增 / 改 / 删,不受每轮条数上限;孩子端看不到 */
  tidy: z.literal(true).optional(),
  /** 最终文本里剥出来的「## 记账」段(物化;日记已按它写好);null = 这轮没有 */
  bookkeeping: BookkeepingSchema.nullable().optional(),
  /** 这轮模型用了哪些工具、读了什么(2026-09-15,从 .log 抽,lib/transcript.ts toolCalls):名字、最要紧的参数、成没成、结果多少字。家长端「看原文」的「读了什么」站;cotutor show 也吐 */
  tools: z.array(z.object({ name: z.string().min(1), arg: z.string(), ok: z.boolean().nullable(), chars: z.number().int().nonnegative(), sub: z.boolean().optional() })).optional(),
  /** 这条是回放(cotutor replay,server/replay.ts):原轮的 job。回放落在 evals/ 里,不在 conversations/ */
  replayOf: z.string().min(1).optional(),
  /**
   * 这条是孩子看完小课堂后的第一条(《小课堂设计.md》§七):哪份课包、课名、看了多久、看完没、停过几次、圈过的几处;节前的小课堂卡与圈的卡从这里画。
   * again = 问过以后「再看一遍」又圈了,这条只为带上新圈的(节前只画圈的卡)。圈:时刻、SVG 停在哪(缩略图)、路径(课包坐标)、算出来的那段话
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
      /** 视频的圈带一张截图(captures/ 里,已叠上圈;路径相对 workspace 根) */
      marks: z.array(z.object({ atMs: z.number().nonnegative(), svgMs: z.number().nonnegative(), path: z.array(z.tuple([z.number(), z.number()])), text: z.string().optional(), image: z.string().optional(), t: z.number().optional() })).optional(),
      /**
       * 看的过程(录像用,《小课堂设计.md》§八第 5 步):放 / 停 / 拖到哪 / 放完,一次一条。t = 离这条消息发出去多少毫秒(≤ 0,孩子端自己的钟算,
       * 不用对钟);pos = 那时停在课里的哪一刻;play = 那之后在放。圈的 t 同理(圈下去的那一刻)
       */
      log: z.array(z.object({ t: z.number(), pos: z.number().nonnegative(), play: z.boolean() })).optional(),
    })
    .optional(),
  /** 孩子从首页哪个按钮进来的(《首页设计.md》§5.2);开场按钮的 text 就是按钮上的字,不是孩子说的 */
  via: MessageViaSchema.optional(),
  /** 这个话题接着以前哪天的哪个话题(首页的「接着」按钮;新会话,上下文包带那个话题的尾巴) */
  continues: z.object({ date: z.string().regex(DATE_RE), thread: z.string().min(1) }).optional(),
});

/**
 * 旧索引(2026-10-05 前)的 from: parent:从课文件建的那几轮(带 lessonSection)不是谁说的话,当系统消息(孩子端只出老师的话、不算上限、录像从孩子第一次开口往前倒推);
 * 其余是家长端 / 工作台发的,当孩子说的。备课、试用、课文件那几个字段不在契约里,读时丢掉
 */
function legacyFrom(v: unknown): unknown {
  if (!v || typeof v !== 'object' || (v as { from?: unknown }).from !== 'parent') return v;
  return { ...v, from: typeof (v as { lessonSection?: unknown }).lessonSection === 'number' ? 'system' : 'kid' };
}
export const ConversationMessageSchema = z.preprocess(legacyFrom, MessageObjectSchema);
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

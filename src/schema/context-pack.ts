/**
 * 上下文包:应用在每条消息前拼的固定 YAML 块(《cotutor契约草案.md》§2),后面接家长笔记的原文段。老师不用自己找上下文。
 * 孩子由 workspace 决定,不进包。
 */
import { z } from 'zod';
import { ActivityValueSchema } from './activity.ts';

/** 消息是谁发的:孩子(孩子端、工作台、cotutor send),或应用派的任务(记账、整理记忆、画图作业)。上下文包里不写,老师面前只有孩子;系统任务的消息正文自己说明是什么活 */
export const MESSAGE_FROM = ['kid', 'system'] as const;
export type MessageFrom = (typeof MESSAGE_FROM)[number];

export const FocusSchema = z.object({
  /** 孩子发消息时正开着的那张卡(<job>/<n>) */
  card: z.string().optional(),
});
export type Focus = z.infer<typeof FocusSchema>;

export const ContextPackSchema = z.object({
  /** 本地时间,分钟精度,如 2026-09-08T16:20 */
  at: z.string().min(1),
  /** 课程表命中的时段,如「数学 16:00-17:00」 */
  slot: z.string().optional(),
  focus: FocusSchema.optional(),
  /** 老师守则(机器技能 cotutor-tutor 的 SKILL.md,有脸的老师才带):相对 workspace 根的路径 + 状态(未变 / 缺);原文在 notes */
  rules: z.string().optional(),
  /** 当前学期(档案的 school_start 按日期算,或档案 semester 覆盖),如「二年级上」;算不出不写 */
  semester: z.string().optional(),
  /** 板书写法(机器技能 cotutor-board)在哪:「已在系统提示里」,或相对 workspace 根的路径 + 状态(未变 / 缺),原文在 notes(<cotutor-board>);board: off 时不带 */
  boardGuide: z.string().optional(),
  /** 档案(vault 里 `cotutor: profile` 的那篇):相对 vault 根的路径 + 状态(未变 / 截断 / 缺);原文在 notes */
  profile: z.string().optional(),
  /** 这位老师的入口文件(`cotutor: subject`,subject 与学期对上的那篇):路径 + 状态;原文在 notes(《obsidian仓库设计.md》2026-09-17) */
  entry: z.string().optional(),
  /** 这位 agent 的记忆文件(`cotutor: memory`、`agent: <名>`):路径 + 状态,或「还没有」;原文在 notes */
  memory: z.string().optional(),
  /** 参考资料的绝对路径:这科这学期的教材 + 档案与入口文件里的 [[链接]];只给路径,老师要用自己 Read(这轮带工具才给) */
  refs: z.array(z.string()).optional(),
  /** 整篇带进来的原文(话题第一条、或话题里改过了才带):老师守则(rules)与家长笔记;接在 YAML 块后面,不进 YAML */
  notes: z.array(z.object({ role: z.enum(['rules', 'boardGuide', 'activityGuide', 'profile', 'entry', 'memory']), path: z.string().min(1), text: z.string() })).optional(),
  /** 这个话题的 activity 文件(「老师怎么带」那节,按参数裁过,后面接这个 activity 多带的卡的写法):相对 workspace 根的路径 + 状态(未变 / 缺);原文在 notes(<cotutor-activity>) */
  activityGuide: z.string().optional(),
  /** 本周计划里与本老师相关的行(已按 planLines 截) */
  plan: z.array(z.string()).default([]),
  /** 最近 N 条本学科观察(从日记的「- 观察:」行抽,最近 14 天,已按 recent 截) */
  recent: z.array(z.object({ date: z.string(), claim: z.string() })).default([]),
  /** 政策旋钮 board = off 时带上,老师只说话不出卡;auto 不写 */
  board: z.enum(['auto', 'off']).optional(),
  /** 上一轮之后孩子改过状态的卡,每张一句(「<job>/<n> choice「问题」 选了「B …」(答案:「…」)」) */
  cards: z.array(z.string()).optional(),
  /** 孩子刚看完小课堂(《小课堂设计.md》§六):课名、哪份课包、课长、每句的起点与原话、看的情况、画过的几处;看完后的第一条,和问过以后再看一遍又画了的那条 */
  lecture: z
    .object({
      title: z.string().min(1),
      source: z.string().min(1),
      length: z.string().min(1),
      lines: z.array(z.string()).default([]),
      watched: z.string().min(1),
      /** 孩子画过的几处,每处一段话(storedMarks):时刻、那时在讲哪句、截图是 photos 第几张、课包的再说画的地方盖着什么 */
      marks: z.array(z.string()).default([]),
    })
    .optional(),
  /** 孩子从首页的按钮进来(《首页设计.md》§六):按钮上的字与家长备好的讲法;只在带按钮的那条 */
  home: z.object({ button: z.string().min(1), brief: z.string().optional() }).optional(),
  /** 接着以前的话题:那个话题是哪天哪个、叫什么、最后一节的讲稿与卡、索引在哪;只在新话题的第一条 */
  continue: z
    .object({
      from: z.string().min(1),
      title: z.string().optional(),
      said: z.array(z.string()).default([]),
      cards: z.array(z.string()).default([]),
      index: z.string().min(1),
    })
    .optional(),
  /**
   * 这一轮走实时(《wip/实时老师设想.md》):嘴(realtime 模型)已经替老师接住了孩子,讲稿交给嘴照念、不配音。caught = 嘴接住时说的那句;cut = 上一轮的讲稿念到第几句被孩子打断(1 起,没打断不写)。
   * 口语课(《wip/口语课改实时老师设计.md》):warmup = 热身的摸底,一拍一行(应用按转写记);phone = 打电话打了几分钟(0 起,还没打不写);
   * app = 这一轮不是孩子说的:call = 你念了 [[call]],现在开始打电话;quiet = 热身里孩子连着两拍没开口
   */
  live: z
    .object({
      caught: z.string().optional(),
      cut: z.number().int().positive().optional(),
      warmup: z.array(z.string()).optional(),
      phone: z.number().int().nonnegative().optional(),
      app: z.enum(['call', 'quiet']).optional(),
    })
    .optional(),
  /**
   * 孩子从首页的 activity 进来的话题(《wip/activity设计.md》):哪个 activity、家长填的参数(点的那一刻,补了缺省)、应用算的值。
   * 话题里每条都带;放在 YAML 块最后,键序固定(name、params、state;参数照文件「家长填的」的顺序)
   */
  activity: z.object({ name: z.string().min(1), params: z.record(z.string(), ActivityValueSchema).default({}), state: z.record(z.string(), ActivityValueSchema).default({}) }).optional(),
  /** 这条消息带的作业照片(相对 workspace 根,一行一张;老师先 Read 再答;R5) */
  photos: z.array(z.string()).optional(),
  /** photos 里同一批照片的绝对路径,顺序一一对应:Read 工具只认绝对路径,老师的 cwd 在 agents/<名>/,不给就得先 find 一轮(2026-09-18 真跑) */
  photoFiles: z.array(z.string()).optional(),
  /** 家长的 Obsidian 仓库在哪(《obsidian仓库设计.md》§7;cotutor-vault 技能按它拼路径):root 绝对路径,其余角色相对 root(在 root 外面就是绝对路径) */
  vault: z
    .object({
      root: z.string().min(1),
      diary: z.string().optional(),
      plans: z.string().optional(),
      timetable: z.string().optional(),
      reference: z.string().optional(),
    })
    .optional(),
});
export const VAULT_PACK_ROLES = ['diary', 'plans', 'timetable', 'reference'] as const;
export type ContextPack = z.infer<typeof ContextPackSchema>;

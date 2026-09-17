/**
 * 首页(《首页设计.md》):家长批准后发布的那页卡。草稿 home/draft.md 是板书同一套围栏语法(src/lib/home.ts 解析),
 * `cotutor home publish` 校验后写 home/published.json,孩子端只读它。卡的 props 契约在 src/cards/<kind>.ts(老师卡的讲法留在这里,下发孩子前剥掉)。
 */
import { z } from 'zod';
import { BoardCardSchema } from './board.ts';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 发布的 id:发布时刻 YYYY-MM-DD-HHMM,同一分钟再发加 -2、-3 */
export const HOME_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?$/;

export const PublishedHomeSchema = z.object({
  id: z.string().regex(HOME_ID_RE),
  publishedAt: z.string().min(1),
  /** 草稿 frontmatter 的 for:给哪天用的 */
  for: z.string().regex(DAY_RE).optional(),
  /** 这份的原文(相对 workspace 根,home/history/<id>.md) */
  source: z.string().min(1),
  /** 解析后的卡,文件顺序;老师卡带讲法(brief),孩子端下发前剥 */
  cards: z.array(BoardCardSchema),
  /** 家长段(第一个 H2 起),孩子看不到 */
  note: z.string().default(''),
  /** 发布时还在的提醒(家长端「首页」页显示) */
  warnings: z.array(z.string()).default([]),
});
export type PublishedHome = z.infer<typeof PublishedHomeSchema>;

/** 孩子从首页哪个按钮进来的:home = 发布的 id(没发布过的缺省首页是 null),button = 老师卡上文件里的第几个按钮,或应用加的 new / recent */
export const HomeViaSchema = z.object({
  home: z.string().regex(HOME_ID_RE).nullable(),
  button: z.union([z.number().int().nonnegative(), z.enum(['new', 'recent'])]),
});
export type HomeVia = z.infer<typeof HomeViaSchema>;

/** 消息里记的 via:再带上按钮上的字(发布的首页以后会换,记下来 home show 才说得清) */
export const MessageViaSchema = HomeViaSchema.extend({ label: z.string() });
export type MessageVia = z.infer<typeof MessageViaSchema>;

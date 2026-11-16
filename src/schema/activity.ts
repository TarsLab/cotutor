/**
 * activity 文件:孩子从首页一个按钮进去的一种做法。一个 activity 一个文件,归一位老师,
 * 放在老师的家 `agents/<老师>/activities/<名>.md`(仓里在 grades/grade-<n>/ 下同一个相对位置,init 拷进去,hash 记 shipped.json)。
 *
 * 头上平铺 `name` / `description` / `cards`(这个 activity 要用的卡,空格隔开)/ `base`(铺哪种页)/ `listen`(一直听)/ `page`(不起老师、进一页);正文按 `## ` 节分读者,标题就是读者:
 *   ## 家长填的       ```参数    一行一个:`名: 类型[,可空][,缺省 X][,A 到 B] —— 说明`
 *   ## 老师怎么带     给有脸的老师;参数不插值,只用 `{{有 名}}` … `{{/有}}` 裁段
 *   ## <工具人>收到什么  ```<工具人> 一段模板,`{{插槽}}` 由应用填;```<工具人>不要 可选
 * 别的节只给人看,应用不读。这里是解析出来的形状;解析与检查在 src/runtime/activity.ts。
 */
import { z } from 'zod';

/** 家长填的参数能是哪几种 */
export const ACTIVITY_PARAM_TYPES = ['字', '词表', '数', '日期', '课包'] as const;
export type ActivityParamType = (typeof ACTIVITY_PARAM_TYPES)[number];

/** 工具人模板里的插槽 `{{名}}` */
export const ACTIVITY_SLOT = /\{\{([^{}\s]+)\}\}/g;

/** 工具人的模板填插槽;没给的插槽填空,填完连续空行并成一行 */
export function fillSlots(template: string, values: Readonly<Record<string, string>>): string {
  return template
    .replace(ACTIVITY_SLOT, (_, name: string) => values[name] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 工具人与它认得的插槽(都要在模板里出现) */
export const ACTIVITY_TOOLS: Readonly<Record<string, { slots: readonly string[] }>> = {
  /** 听写的拍照认词(src/scenes/photo-words/recognize.ts):格式 = 回什么格式,应用接(FORMAT / FORMAT_EN) */
  认字: { slots: ['格式'] },
};

/**
 * 不起老师的会话、按钮进一页的 activity(头上 `page:`):名字、音色、牌还是那位老师的。
 * dictation = 中文听写页,dictation-en = 英文单词听写页(四线三格)
 */
export const ACTIVITY_PAGES: Readonly<Record<string, string>> = {
  dictation: '中文听写页 /dictation',
  'dictation-en': '英文单词听写页 /dictation?lang=en',
};

/**
 * 头上的 `base:`:这一节课铺哪种页(2026-11-16《多模态教学harness-开发计划》阶段 3;以前要和 `board: page` 一起写)。不写 = 不铺页(小课堂、看图说话、口语课还是卡片流,阶段 4、5 搬)。
 * textbook = vault 里的教材 PDF(《语文预习:PDF 课本与镜头交互》):不拍照,进来铺这一册的目录,老师照孩子说的课翻到那一课。
 * photo = 孩子拍的作业:进来先拍照(或不拍,用白纸),照片一发就铺;老师照认出的题看、圈、在题下面的白纸条上摆、写。
 * 两种页上老师都能 [[翻 白纸]] 加一张白纸页。
 */
export const ACTIVITY_BASES: Readonly<Record<string, string>> = {
  textbook: '课本:vault 的教材/ 下这一科的 PDF,不拍照',
  photo: '孩子拍的作业:进来先拍照,不拍就是白纸',
};
export type ActivityBase = 'textbook' | 'photo';

/**
 * 头上的 `listen:`:孩子怎么说话(2026-11-17 阶段 4 任务 1,原来只有口语课一直听)。open = 一直听:不用按,孩子开口就听(一问一答多的、请他说的多的);
 * 没写 = 照 cotutor.json 这位老师的 listen(缺省按住说)
 */
export const ACTIVITY_LISTENS: Readonly<Record<string, string>> = {
  open: '一直听:不用按,孩子开口就听',
};

/**
 * 旧的头(2026-11-16 以前的出厂件、家长改过的):`board: page` 不再有意义(铺页的都铺页),还认一段时间——没写 base 的当 base: photo;
 * cards 里的 kit(教具卡,删了)读进来就丢。activity check、doctor 提一句;refresh 换掉没改过的。
 */
export const ACTIVITY_OLD_BOARD = 'page';

/** 应用认的节标题;工具人那节是 `<工具人>收到什么` */
export const ACTIVITY_SECTIONS = { params: '家长填的', tutor: '老师怎么带' } as const;
export const ACTIVITY_TOOL_SECTION_RE = /^(.+?)收到什么$/;
/** 首页按钮下面已经占用的行名,参数不能叫这些 */
export const ACTIVITY_RESERVED_PARAMS = ['讲法', '留到'] as const;

/** 小课堂按钮没写 `activity:` 时,看完照这位老师的这个 activity 聊 */
export const LECTURE_ACTIVITY = '小课堂';

export const ActivityParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(ACTIVITY_PARAM_TYPES),
  /** 可空:首页按钮可以不填 */
  optional: z.boolean(),
  /** 缺省值(原文) */
  default: z.string().optional(),
  /** 数的范围(含两头) */
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  note: z.string().optional(),
  line: z.number().int(),
});
export type ActivityParam = z.infer<typeof ActivityParamSchema>;

export const ActivityToolSchema = z.object({
  tool: z.string().min(1),
  /** ```<工具人> 围栏里的模板,原样(插槽没填) */
  prompt: z.string(),
  /** ```<工具人>不要 围栏,一行或几行拼成一段 */
  negative: z.string().optional(),
  /** 那节标题的行号 */
  line: z.number().int(),
  /** 模板第一行的行号 */
  promptLine: z.number().int(),
});
export type ActivityTool = z.infer<typeof ActivityToolSchema>;

export const ActivitySchema = z.object({
  name: z.string(),
  description: z.string(),
  /** 头上 `cards:` 写的卡(原文,检查时对注册表) */
  cards: z.array(z.string()),
  params: z.array(ActivityParamSchema),
  /** 头上的 `page:`:不起老师、进这一页(见 ACTIVITY_PAGES);没写 = 起老师 */
  page: z.string().optional(),
  /** 头上的 `base:`:铺哪种页(见 ACTIVITY_BASES);没写 = 不铺页(卡片流) */
  base: z.string().optional(),
  /** 头上的 `listen:`:孩子怎么说话(见 ACTIVITY_LISTENS);没写 = 照老师的 */
  listen: z.string().optional(),
  /** 头上还写着旧的东西(board: page、cards 里的 kit):照新的读了,check 提一句 */
  old: z.array(z.string()).optional(),
  /** 「老师怎么带」那节的原文(没剥注释、没裁);没有这节就是 null(这个 activity 不起老师,如听写) */
  tutor: z.object({ text: z.string(), line: z.number().int() }).nullable(),
  tools: z.array(ActivityToolSchema),
});
export type Activity = z.infer<typeof ActivitySchema>;

/** 参数的值:词表是一串词,数是整数,别的是一段字 */
export const ActivityValueSchema = z.union([z.string(), z.number(), z.array(z.string())]);
export type ActivityValue = z.infer<typeof ActivityValueSchema>;

/** 一个话题是从哪个 activity 起的:名字与孩子点的那一刻的参数(补了缺省);记在话题第一条消息上,整个话题都用这一份 */
export const ActivityRunSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.string(), ActivityValueSchema),
});
export type ActivityRun = z.infer<typeof ActivityRunSchema>;

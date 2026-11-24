/**
 * activity 文件:孩子从首页一个按钮进去的一种做法。一个 activity 一个文件,归一位老师,
 * 放在老师的家 `agents/<老师>/activities/<名>.md`(仓里在 grades/grade-<n>/ 下同一个相对位置,init 拷进去,hash 记 shipped.json)。
 *
 * 头上平铺 `name` / `description` / `base`(铺哪种页)/ `listen`(一直听)/ `reply`(谁先答)/ `start`(谁起头);正文按 `## ` 节分读者,标题就是读者:
 *   ## 家长填的       ```参数    一行一个:`名: 类型[,可空][,缺省 X][,A 到 B] —— 说明`
 *   ## 老师怎么带     给老师;参数不插值,只用 `{{有 名}}` … `{{/有}}` 裁段
 *   ## <工具人>收到什么  ```<工具人> 一段模板,`{{插槽}}` 由应用填;```<工具人>不要 可选
 * 别的节只给人看,应用不读。这里是解析出来的形状;解析与检查在 src/runtime/activity.ts。
 */
import { z } from 'zod';

/** 家长填的参数能是哪几种 */
/** 练习册 = vault 练习册/ 下的一册(目录名;src/schema/workbook.ts),base: workbook 的 activity 用它说做哪一册 */
export const ACTIVITY_PARAM_TYPES = ['字', '词表', '数', '日期', '课包', '练习册'] as const;
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
  /** 照片上认字(src/scenes/photo-words/recognize.ts;照片页、听写的拍照认词):格式 = 回什么格式,应用接(FORMAT / FORMAT_EN) */
  认字: { slots: ['格式'] },
};

/**
 * 头上的 `base:`:这一节课铺哪种页。
 * textbook = vault 里的教材 PDF:不拍照,进来铺这一册的目录,老师照孩子说的课翻到那一课。
 * photo = 孩子拍的作业:进来先拍照(或不拍,用白纸),照片一发就铺;老师照认出的题看、圈、在题下面的白纸条上摆、写。
 * lecture = 小课堂:从首页的小课堂按钮进来,页上铺那堂课,孩子先看完再问;老师 [[看 0:19–0:30]] 放课里那一段。
 *   小课堂按钮没写 `activity:` 时,看完照这位老师 base: lecture 的那个 activity 聊;按钮挂了别的 activity(如看图说话),页上也先铺这堂课。
 * workbook = vault 练习册/ 下的一册(参数「练习册」说哪一册;首页按钮挂上):进来就铺那一册,每页一张图,孩子用笔直接在页上做;
 *   题框、能写的格子、给老师的答案都在那一册的 workbook.json 里,不认字。
 * homework = 作业本:进来就铺一整本(不到拍照屏):检查作业拍的照片另抄一份进 vault 的 作业本/<学科>/<日期>/,按天攒成一本(跨话题),
 *   老的在上、新拍的接在后面,最后一张白纸上拍照;以前几天的照片上留着那时最后的记号(只看不改;src/runtime/homework.ts)。
 * 哪种页上老师都能 [[翻 白纸]] 加一张白纸页。
 */
export const ACTIVITY_BASES: Readonly<Record<string, string>> = {
  textbook: '课本:vault 的教材/ 下这一科的 PDF,不拍照',
  photo: '孩子拍的作业:进来先拍照,不拍就是白纸',
  lecture: '小课堂:首页小课堂按钮给的那堂课(课包或视频),先看完再问',
  workbook: '练习册:vault 的练习册/ 下的一册(参数「练习册」),孩子用笔在页上做',
  homework: '作业本:进来铺一整本,在最后那张白纸上拍照,照片按天攒进 vault 的作业本/<学科>/,往上滚看以前几天',
};
export type ActivityBase = 'textbook' | 'photo' | 'lecture' | 'workbook' | 'homework';

/**
 * 头上的 `listen:`:孩子怎么说话。open = 一直听:不用按,孩子开口就听(一问一答多的、请他说的多的);
 * 没写 = 照 cotutor.json 这位老师的 listen(缺省按住说)
 */
export const ACTIVITY_LISTENS: Readonly<Record<string, string>> = {
  open: '一直听:不用按,孩子开口就听',
};

/**
 * 头上的 `reply:`:孩子作答以后谁先答(英语里简单、要快的先嘴,数学都用脑;代码不照学科分,照这里写的走)。
 * mouth = 嘴先答:老师这一轮最后一句请他说一句([[请 说 …]]),他答了嘴先在那个范围里接(说中了接一句、脑接着写;没说中提示一下再等他,连着两次交给脑);
 * 没写 = 脑先答(嘴只接住、照念)
 */
export const ACTIVITY_REPLIES: Readonly<Record<string, string>> = {
  mouth: '嘴先答:最后一句请他说的,他答了嘴先接(说中了接一句,没说中提示一下)',
};

/**
 * 头上的 `start:`:点进来以后谁起头。tutor = 老师先说:进门(或拍照屏上按「用白纸」)就起一轮,老师照「老师怎么带」开场(口语课);
 * 没写 = 孩子先说:进门只铺页、不叫老师,孩子说了话、拍照交上来、按「给老师看」才起第一轮(src/runtime/runner.ts 的 enter)
 */
export const ACTIVITY_STARTS: Readonly<Record<string, string>> = {
  tutor: '老师先说:点进来就起一轮,老师开场',
};

/**
 * 旧的头(以前的出厂件、家长改过的):`board: page` 不再有意义(铺页的都铺页),还认一段时间——没写 base 的当 base: photo;
 * cards 里的 kit(教具卡,删了)读进来就丢。activity check、doctor 提一句;refresh 换掉没改过的。
 */
export const ACTIVITY_OLD_BOARD = 'page';

/** 应用认的节标题;工具人那节是 `<工具人>收到什么` */
export const ACTIVITY_SECTIONS = { params: '家长填的', tutor: '老师怎么带' } as const;
export const ACTIVITY_TOOL_SECTION_RE = /^(.+?)收到什么$/;
/** 首页按钮下面已经占用的行名,参数不能叫这些 */
export const ACTIVITY_RESERVED_PARAMS = ['讲法', '留到'] as const;

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
  params: z.array(ActivityParamSchema),
  /** 头上的 `base:`:铺哪种页(见 ACTIVITY_BASES);没写当 photo(src/runtime/activity.ts 的 activityBase) */
  base: z.string().optional(),
  /** 头上的 `listen:`:孩子怎么说话(见 ACTIVITY_LISTENS);没写 = 照老师的 */
  listen: z.string().optional(),
  /** 头上的 `reply:`:孩子作答以后谁先答(见 ACTIVITY_REPLIES);没写 = 脑 */
  reply: z.string().optional(),
  /** 头上的 `start:`:谁起头(见 ACTIVITY_STARTS);没写 = 孩子先说 */
  start: z.string().optional(),
  /** 头上还写着旧的东西(board: page、cards):照新的读了,check 提一句 */
  old: z.array(z.string()).optional(),
  /** 「老师怎么带」那节的原文(没剥注释、没裁);没有这节就是 null(要改:activity 都起老师。听写不是 activity,读的也是这个形状,只用认字那节) */
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

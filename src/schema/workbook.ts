/**
 * 练习册:照教材一个单元编的几页习题,孩子在 iPad 上用 Apple Pencil 直接在页上做。一册一个目录:
 *   workbook.json   这里的形状(`WorkbookSchema`)
 *   01.png 02.png … 每页一张图,和 workbook.json 由同一份排版生成,所以框是准的,不用认字
 *   <名>.pdf        打印版(可选,同一份排版)
 *
 * 坐标:每页自己的千分比,框 `[左, 上, 右, 下]`、点 `[x, y]`,x 按页图的宽、y 按页图的高(都是 0–1000,不是正方形的)。
 * 几页连成一条铺时,换算到舞台坐标由铺的那层做(每页的纵向偏移),这里不管。
 *
 * 一页分三层,下发的只有第一层:
 *   孩子端   页图、文字层 `lines`、能点能圈的字词 `terms`(照片页认字的 `.words.json` 由它们生成)
 *   服务端   每道题的作答区 `regions` 与区里的东西 `objects`:孩子落的笔照它们归到哪一格、圈住了哪几个,换成给老师的句子
 *   老师     每道题的 `teacher`:目标、提示、答案(进上下文包,只给脑)
 * 物件也不下发:圈画区里的 `objects` 常常就是答案的位置。
 *
 * 答案挂在作答区上(`at` 列这一条答案占的区,按书写的顺序):一个词写在两个田字格里、一个算式跨三格、一句话跨两行,都是一条。
 * `ok` 是几种都算对的写法(每种是 `at` 那几格连起来写的样子);连线用 `links`;没有固定答案的(编题、写话、圈法不唯一)用 `note` 写怎么看。
 * 答案只给老师参考,孩子端永远不判对错。
 *
 * 读进来先过 `WorkbookSchema`(形状),再过 `workbookProblems`(题号、id、框、引用对不对得上)。
 */
import { z } from 'zod';

const permille = z.number().min(0).max(1000);
/** 框 [左, 上, 右, 下],页图的千分比 */
export const WorkbookBoxSchema = z.tuple([permille, permille, permille, permille]);
/** 点 [x, y],页图的千分比 */
export const WorkbookPointSchema = z.tuple([permille, permille]);
export type WorkbookBox = z.infer<typeof WorkbookBoxSchema>;
export type WorkbookPoint = z.infer<typeof WorkbookPointSchema>;

/** id:字母、数字、汉字、连字符,一册里不重复(作答区和物件共用一个空间) */
const id = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u);

/**
 * 作答区是哪一种,孩子在里面怎么作答、服务端怎么读他的笔:
 *   write     写:填空格、横线、田字格、四线三格。读成「这一格写了几笔」,写的是什么看那一格的图
 *   circle    圈:在 objects 里圈一个(选读音、选字母)或圈几组(每 4 个圈一组)。读成每一圈围住了哪几个
 *   draw      画:照题画几个圆、三角形、示意图。读成框里画了几个闭合的形状
 *   link      连线:左右两列的 objects 带 side,读成哪个连到了哪个
 *   underline 画线:在短文里画出一句。读成画在哪几行、哪一段字下面
 *   trace     描写:描灰色的字母,带四线和参考笔画 model
 */
export const WORKBOOK_REGION_KINDS = ['write', 'circle', 'draw', 'link', 'underline', 'trace'] as const;
export type WorkbookRegionKind = (typeof WORKBOOK_REGION_KINDS)[number];

export const WorkbookRegionSchema = z.object({
  id,
  kind: z.enum(WORKBOOK_REGION_KINDS),
  /** 给老师看的名字:「乘号左边」「第 2 小题口诀」「法的第 1 个临写格」 */
  label: z.string().min(1),
  box: WorkbookBoxSchema,
  /** 田字格(一格一个字) */
  tian: z.literal(true).optional(),
  /** 四线三格的四条线,从上往下的 y */
  fourLine: z.tuple([permille, permille, permille, permille]).optional(),
  /** 照着写的字母与参考笔画(一笔一串点,照 src/chalk/glyphs/ 的笔顺):描写区必有,临写的格子可以带 */
  model: z.object({ glyph: z.string().min(1), strokes: z.array(z.array(WorkbookPointSchema).min(2)).min(1) }).optional(),
  /** 这一格写起来太长(编题、写话),可以说着答:老师请他说,不强求写 */
  say: z.literal(true).optional(),
});
export type WorkbookRegion = z.infer<typeof WorkbookRegionSchema>;

/** 题里能指的东西:一个积木、一个读音选项、短文里的一个词、连线的一个端点、只用来数的风车 */
export const WorkbookObjectSchema = z.object({
  id,
  /** 是什么:「积木」「zhí」「蒲公英」「豆荚裂开，种子蹦出去」 */
  label: z.string().min(1),
  box: WorkbookBoxSchema,
  /** 画出来的中心(立体积木的中心不在框的正中) */
  center: WorkbookPointSchema,
  /** 在这道题的哪个作答区里被圈、被连;只是图(数一数的风车)不写 */
  region: id.optional(),
  /** 连线的哪一头 */
  side: z.enum(['left', 'right']).optional(),
  /** 画面上本来就分好的组(第几盘草莓) */
  group: z.number().int().min(1).optional(),
});
export type WorkbookObject = z.infer<typeof WorkbookObjectSchema>;

export const WorkbookAnswerSchema = z.object({
  /** 这条答案占的作答区,按书写顺序 */
  at: z.array(id).min(1),
  /** 都算对的写法;跨几格的照格子顺序连着写(「3×4=12」占乘号左、右、等号右三格) */
  ok: z.array(z.string().min(1)).min(1).optional(),
  /** 连线:[左端物件, 右端物件] */
  links: z.array(z.tuple([id, id])).min(1).optional(),
  /** 没有唯一答案时怎么看:「每个积木只圈一次,每组 4 个,圈法可以不同」 */
  note: z.string().min(1).optional(),
}).refine((a) => a.ok || a.links || a.note, { message: '答案要有 ok、links、note 之一' });
export type WorkbookAnswer = z.infer<typeof WorkbookAnswerSchema>;

/** 只给老师(脑)的:这道题练什么、孩子卡住怎么引、答案 */
export const WorkbookTeacherSchema = z.object({
  goal: z.string().min(1),
  hint: z.string().min(1).optional(),
  answers: z.array(WorkbookAnswerSchema),
});
export type WorkbookTeacher = z.infer<typeof WorkbookTeacherSchema>;

export const WorkbookQuestionSchema = z.object({
  /** 题号,一册里贯穿、不重复;老师写 [[看 第 3 题]] 照它找 */
  no: z.string().regex(/^\d+$/),
  box: WorkbookBoxSchema,
  /** 题面,几行的连起来、中英两行的都写:「每个风车有 4 片叶片。5 个这样的风车一共有多少片叶片？」 */
  prompt: z.string().min(1),
  regions: z.array(WorkbookRegionSchema).min(1),
  objects: z.array(WorkbookObjectSchema),
  teacher: WorkbookTeacherSchema,
});
export type WorkbookQuestion = z.infer<typeof WorkbookQuestionSchema>;

/** 文字层的一行:印的字照原样,点字和老师的「看」照它 */
export const WorkbookLineSchema = z.object({ text: z.string().min(1), box: WorkbookBoxSchema });
/** 老师能圈、孩子能点的字词;char、word 点了弹田字格或念,other 只给老师圈 */
export const WorkbookTermSchema = z.object({
  text: z.string().min(1),
  box: WorkbookBoxSchema,
  kind: z.enum(['char', 'word', 'other']),
  /** 老师怎么念(和字面不同时才写) */
  say: z.string().min(1).optional(),
});

export const WorkbookPageSchema = z.object({
  image: z.object({
    /** 相对 workbook.json */
    file: z.string().regex(/^[^/\\]+\.png$/),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  lines: z.array(WorkbookLineSchema),
  terms: z.array(WorkbookTermSchema),
  questions: z.array(WorkbookQuestionSchema).min(1),
});
export type WorkbookPage = z.infer<typeof WorkbookPageSchema>;

export const WorkbookSchema = z.object({
  version: z.literal(1),
  id,
  title: z.string().min(1),
  subject: z.enum(['语文', '数学', '英语']),
  grade: z.number().int().min(1).max(6),
  term: z.enum(['上', '下']),
  /** 照教材哪儿编的:页码是 [从, 到],printed 印的页码,pdf 是课本 PDF 的第几页 */
  source: z.object({
    edition: z.string().min(1),
    unit: z.string().min(1),
    lesson: z.string().min(1).optional(),
    printed: z.tuple([z.number().int(), z.number().int()]),
    pdf: z.tuple([z.number().int(), z.number().int()]).optional(),
    note: z.string().min(1).optional(),
  }),
  /** 打印版 PDF,相对 workbook.json */
  print: z.string().regex(/^[^/\\]+\.pdf$/).optional(),
  pages: z.array(WorkbookPageSchema).min(1),
});
export type Workbook = z.infer<typeof WorkbookSchema>;

/** 框里外:a 在 b 里面(容 slack 千分的出界,画框时的描边) */
const within = (a: WorkbookBox, b: WorkbookBox, slack = 4): boolean =>
  a[0] >= b[0] - slack && a[1] >= b[1] - slack && a[2] <= b[2] + slack && a[3] <= b[3] + slack;
const inBox = ([x, y]: WorkbookPoint, b: WorkbookBox): boolean => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/**
 * 形状对了以后再查的:题号、id 不重复,框是正的、在题框里,物件、答案引的作答区与物件都在这道题里,
 * 连线的两头各有 side,描写区带 model。回要改的那几条(一条一句,带页和题号);空 = 能用。
 */
export function workbookProblems(wb: Workbook): string[] {
  const out: string[] = [];
  const nos = new Set<string>();
  const ids = new Set<string>();
  const seen = (where: string, key: string): void => {
    if (ids.has(key)) out.push(`${where}:id「${key}」重复`);
    ids.add(key);
  };
  const flat = (where: string, b: WorkbookBox): void => {
    if (!(b[0] < b[2] && b[1] < b[3])) out.push(`${where}:框 [${b.join(', ')}] 不是左上到右下`);
  };
  wb.pages.forEach((page, pi) => {
    const p = `第 ${pi + 1} 页`;
    for (const l of page.lines) flat(`${p}「${l.text}」`, l.box);
    for (const t of page.terms) flat(`${p}「${t.text}」`, t.box);
    for (const q of page.questions) {
      const w = `${p}第 ${q.no} 题`;
      if (nos.has(q.no)) out.push(`${w}:题号重复`);
      nos.add(q.no);
      flat(w, q.box);
      const regions = new Map(q.regions.map((r) => [r.id, r]));
      for (const r of q.regions) {
        const at = `${w}「${r.label}」`;
        seen(at, r.id);
        flat(at, r.box);
        if (!within(r.box, q.box)) out.push(`${at}:作答区出了题框`);
        if (r.kind === 'trace' && !r.model) out.push(`${at}:描写区要带 model`);
        if (r.model && r.kind !== 'trace' && r.kind !== 'write') out.push(`${at}:只有描写、书写的格子带 model`);
        if (r.fourLine && !r.fourLine.every((y, i) => i === 0 || y > r.fourLine![i - 1]!)) out.push(`${at}:四线要从上往下`);
      }
      const objects = new Map(q.objects.map((o) => [o.id, o]));
      for (const o of q.objects) {
        const at = `${w}「${o.label}」`;
        seen(at, o.id);
        flat(at, o.box);
        if (!inBox(o.center, o.box)) out.push(`${at}:中心不在框里`);
        const r = o.region === undefined ? undefined : regions.get(o.region);
        if (o.region !== undefined && !r) out.push(`${at}:作答区「${o.region}」不在这道题里`);
        if (o.side && r?.kind !== 'link') out.push(`${at}:只有连线的端点写 side`);
        else if (r?.kind === 'link' && !o.side) out.push(`${at}:连线的端点要写 side`);
      }
      for (const r of q.regions.filter((x) => x.kind === 'link')) {
        const ends = q.objects.filter((o) => o.region === r.id);
        if (!ends.some((o) => o.side === 'left') || !ends.some((o) => o.side === 'right')) out.push(`${w}「${r.label}」:连线区左右两头都要有端点`);
      }
      for (const a of q.teacher.answers) {
        for (const rid of a.at) if (!regions.has(rid)) out.push(`${w}答案:作答区「${rid}」不在这道题里`);
        for (const [l, r] of a.links ?? []) {
          if (objects.get(l)?.side !== 'left') out.push(`${w}答案:「${l}」不是连线的左端`);
          if (objects.get(r)?.side !== 'right') out.push(`${w}答案:「${r}」不是连线的右端`);
        }
        if (a.links && !a.at.every((rid) => regions.get(rid)?.kind === 'link')) out.push(`${w}答案:links 只挂在连线区上`);
      }
    }
  });
  return out;
}

/** 给孩子端的一页:页图和文字层;作答区、物件、老师的都不下发 */
export function workbookKidPage(page: WorkbookPage): Pick<WorkbookPage, 'image' | 'lines' | 'terms'> {
  return { image: page.image, lines: page.lines, terms: page.terms };
}

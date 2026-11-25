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
import { AnswerSchema, PermilleBoxSchema, PermillePointSchema, RegionObjectSchema, RegionSchema, TeacherSchema, regionId as id, regionProblems, type Answer, type PermilleBox, type PermillePoint, type Region, type RegionObject, type TeacherNote } from './regions.ts';

/** 作答区、物件、答案、给老师的和课本的分块共用一套(./regions.ts);这里的名字是练习册那边一直用的 */
export const WorkbookBoxSchema = PermilleBoxSchema;
export const WorkbookPointSchema = PermillePointSchema;
export type WorkbookBox = PermilleBox;
export type WorkbookPoint = PermillePoint;
export const WorkbookRegionSchema = RegionSchema;
export type WorkbookRegion = Region;
export const WorkbookObjectSchema = RegionObjectSchema;
export type WorkbookObject = RegionObject;
export const WorkbookAnswerSchema = AnswerSchema;
export type WorkbookAnswer = Answer;
export const WorkbookTeacherSchema = TeacherSchema;
export type WorkbookTeacher = TeacherNote;

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

/**
 * 形状对了以后再查的:题号、id 不重复,框是正的、在题框里,物件、答案引的作答区与物件都在这道题里,
 * 连线的两头各有 side,描写区带 model。回要改的那几条(一条一句,带页和题号);空 = 能用。
 */
export function workbookProblems(wb: Workbook): string[] {
  const out: string[] = [];
  const nos = new Set<string>();
  const ids = new Set<string>();
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
      out.push(...regionProblems(w, '题', q.regions, q.objects, q.teacher.answers, ids, q.box));
    }
  });
  return out;
}

/** 给孩子端的一页:页图和文字层;作答区、物件、老师的都不下发 */
export function workbookKidPage(page: WorkbookPage): Pick<WorkbookPage, 'image' | 'lines' | 'terms'> {
  return { image: page.image, lines: page.lines, terms: page.terms };
}

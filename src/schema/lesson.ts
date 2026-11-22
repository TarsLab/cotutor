/**
 * 一节课:孩子从首页点进一个 activity 到回首页。一节课铺着页,老师一边说一边在页上做动作,孩子在页上写、点、说。
 * 这里是契约:讲稿里的动作(老师写在句子后面的 `[[看 第 3 题]]`)、动作落到页上以后的样子(LessonAct)、一节课的状态(Lesson)和改它的事(LessonEvent)。
 * 一节课的状态落在 conversations/<老师>/<date>.<话题>.lesson.json(src/runtime/journal/lesson-store.ts),旁边还是板的日志(board-log)。
 * 词:「动作」是老师对页做的事;解析在 src/board/acts.ts,落到页上(找到框)在 src/board/lesson-fit.ts,一节课的状态怎么变在 src/board/lesson.ts。
 */
import { z } from 'zod';
import type { BookLayout } from './textbook.ts';

/**
 * 讲稿里的动作有哪些(《底层设计》第五节):
 * 看(窗移到哪)· 圈、划(横线)、加点(字下一个点)· 遮(拼音)、盖(印好的答案)· 写(白纸条里写字)· 擦(自己上一样或整条白纸条)· 摆(白纸条里摆图形:点阵、方向盘)· 请(开放哪些作答)· 翻(换一课、回到照片页、加一张白纸页)
 */
export const ACT_NAMES = ['看', '圈', '划', '加点', '遮', '盖', '写', '擦', '摆', '请', '翻'] as const;
export type ActName = (typeof ACT_NAMES)[number];

/** 请孩子做的(开放哪些作答):写、圈、点(点字)、涂、切、转、说、添(点阵上添一个) */
export const ASK_NAMES = ['写', '圈', '点', '涂', '切', '转', '说', '添'] as const;
export type AskName = (typeof ASK_NAMES)[number];
/** 用笔的请(点是点字,转、说不用笔):请着这些时孩子抬笔停一会儿,应用替他交给老师(收笔);课本页上没请也能画,只是不替他交 */
export const PEN_ASKS: readonly AskName[] = ['写', '圈', '涂', '切', '添'];

/** 白纸条里的东西多大:档,不写坐标(老师看不见图,位置由应用排) */
export const SIZES = ['大', '中', '小'] as const;
export type Size = (typeof SIZES)[number];

/** 讲稿里的一个动作:名字和老师写的原文(参数已经查过写法;落到页上的样子由 lesson-fit 另填) */
export interface LineAct {
  name: ActName;
  /** 动作后面写的原文(去掉了首尾空白;擦、请也可能是空的) */
  arg: string;
  /** 落到页上的样子(应用照课本找到框、填好页;src/board/lesson-fit.ts);没有 = 还没落,或落不了(找不到、这一页上做不了) */
  do?: LessonAct;
}

// ——— 一节课的状态 ———

/** 场景坐标的一块:[左, 上, 右, 下](课本:一页宽 1000,几页从上往下连着;src/chalk/kit/book.ts) */
export type Box = [number, number, number, number];
/** 一节课最多留几页(课本的几课、照片页、白纸页)、孩子的笔最多几笔、一笔最多几个点、点过的最多记几个、老师的记号最多几个、一条白纸条最多几样 */
export const LESSON_PAGES_MAX = 8;
export const LESSON_INK_MAX = 160;
export const LESSON_INK_POINTS = 120;
export const LESSON_PICK_MAX = 30;
export const LESSON_MARKS_MAX = 24;
export const STRIP_ITEMS_MAX = 8;
/** 孩子在课本的田字格里写字:一页最多写多少格、一格最多几笔;笔画的坐标是格里的,0–CELL_UNIT(左上角起) */
export const LESSON_CELLS_MAX = 120;
export const LESSON_CELL_STROKES = 40;
export const CELL_UNIT = 1000;

/**
 * 指着字的记号(圈、划、加点)跟着话走:属于说它的那一句,话过去了就退下(docs/dev/一节课.md)。
 * 遮、盖是故意挡住的,留到孩子揭开。
 */
export const LINE_MARKS = ['圈', '划', '加点'] as const;
export type LineMarkName = (typeof LINE_MARKS)[number];
export type MarkName = LineMarkName | '遮' | '盖';
/** 一句话后面最多几处新的指着字的记号;舞台上同时新的也最多这么多(多的画成旧的) */
export const MARKS_NEW_MAX = 3;
/** 指着字的记号念过几句以后变旧(淡):画它的那一句算第 1 句,念完下一句还是新的 */
export const MARK_FRESH_LINES = 2;

/**
 * 老师在页上的一个记号:圈(把字和头上的拼音一起圈住)、划(字下一道横线;一句跨行就一行一条)、加点(每个字下一个点)、
 * 遮(盖住字头上的拼音)、盖(整个盖住印好的字);text 是课本上印的字,box 是应用找到的位置。
 * at:画它时这节课已经念完几句(Lesson.said);只有圈、划、加点有。舞台照 said − at 画新的、旧的
 */
export interface TeacherMark { k: MarkName; text: string; box: Box; at?: number }

/** 白纸条里的一样:写的一行字,或摆的一个图形(src/chalk/kit/ 的画法与参数) */
export type StripItem =
  | { kind: 'write'; text: string; size: Size }
  | { kind: 'shape'; kit: string; params: Record<string, string>; size: Size };

/**
 * 白纸条(2026-11-16 Jack 定的「要讲才盖一块白板」):题目在窗口最顶部,下面的内容盖成白纸条,老师在上面摆图形、写字。
 * key 是那一道题(老师「看」的那一处的名字),box 是题在页上的框:白纸条紧贴它的下沿、跟着页滚。一道题一条,讲下一道收起来,回来时原来的还在
 */
export interface Strip { key: string; box: Box; items: StripItem[] }

/** 照片页上的一张:孩子拍的(相对 workspace 根,captures/ 下)和它的像素宽高(场景里一张宽 1000,高照宽高比) */
export interface PagePhoto { src: string; w: number; h: number }
/** 一节课的照片页最多几张(孩子连拍几页、拍错了再拍一张都接在后面;多了不收) */
export const PAGE_PHOTOS_MAX = 6;
/** 照片页、白纸页、小课堂页的 id(一节课各只有一页;课本的一课是「册子#课名」) */
export const PHOTO_PAGE = '作业';
export const WHITE_PAGE = '白纸';
export const LECTURE_PAGE = '小课堂';
/** 一册练习册最多铺几页(几页从上往下连着,同课本一课最多铺的页数) */
export const BOOK_MAX_SHEETS = 12;

/**
 * 一页铺的是什么:
 *  book  课本的一课:几页 PDF 竖着连成一条。id = 「册子#课名」(同板的日志里的 base)
 *  photo 孩子拍的作业:几张照片竖着连成一条(先拍的在上),文字层是认字认出的行和题(src/scenes/photo-words/)
 *  white 白纸:什么都没印,老师在上面摆图形、写字(整页就是一条白纸条)
 *  lecture 小课堂:一堂做好的课(课包 bundles/<id>/ 或视频 lectures/<id>/),按时刻编号的页——放就是窗自己往前走;
 *          文字层是每一句的起点与原话(src/board/lecture.ts 的时钟),老师 [[看 0:19–0:30]] 就是放那一段
 */
export type PageSource =
  | {
    id: string;
    kind: 'book';
    /** 册子的文件名(教材目录下) */
    src: string;
    /** 课名;还没翻到哪一课是「目录」 */
    title: string;
    /** 铺 PDF 的哪几页 */
    pages: number[];
    /** 每页底下裁掉多少(场景坐标;src/chalk/kit/book.ts 的 bookCut) */
    cut: number;
    layout: BookLayout;
    /** 孩子能不能点字看笔顺(语文能,数学的课本上点的是数和算式,不弹) */
    pick: boolean;
  }
  | { id: string; kind: 'photo'; title: string; photos: PagePhoto[]; pick: boolean }
  | {
    /** 练习册#<目录名> */
    id: string;
    kind: 'workbook';
    /** 练习册的目录名(vault 练习册/ 下;src/schema/workbook.ts) */
    src: string;
    /** 册名(workbook.json 的 title) */
    title: string;
    /** 每页的宽高:宽 1000、高照页图的宽高比;题框、文字层、能写的格子都在这套坐标里(src/chalk/kit/workbook.ts) */
    sheets: { w: number; h: number }[];
    pick: boolean;
  }
  | { id: string; kind: 'white'; title: string; pick: boolean }
  | {
    id: string;
    kind: 'lecture';
    /** 课名 */
    title: string;
    /** 课包或视频的 id(bundles/<id>/、lectures/<id>/) */
    bundle: string;
    /** 视频;false = 课包 */
    video: boolean;
    /** 课长(毫秒) */
    ms: number;
    pick: boolean;
  };

/** 一页:铺的是什么,加三层 */
export type LessonPage = PageSource & {
  /** 老师的那一层 */
  teacher: { marks: TeacherMark[]; strips: Strip[] };
  /**
   * 孩子的那一层:笔画(场景坐标,原样不归整)、写在白纸条上的笔画(键:白纸条;收起来就跟着收,回到那道题还在)、
   * 揭开了哪些、点开看过哪些字词(先后)、白纸条里的图形转到多少度(键:<白纸条>#<第几样>)、
   * 在课本的田字格里写的字(键:<PDF 第几页>.<这一页第几格>,src/chalk/kit/book.ts 的 bookCellsOf;笔画是格里的坐标 0–CELL_UNIT;以前的状态没有)
   */
  kid: { ink: [number, number][][]; stripInk: Record<string, [number, number][][]>; revealed: string[]; picked: string[]; turns: Record<string, number>; cells?: Record<string, [number, number][][]> };
  /** 开放的:这一步请孩子做的(老师的「请」);没请就只能看和点字(课本页上也能画,抬笔不替他交) */
  open: AskName[];
};

export interface Lesson {
  v: 1;
  pages: LessonPage[];
  /** 现在铺的是哪一页(id);还没有页 = null */
  at: string | null;
  /** 老师最后让看的那一处;n 每「看」一次加一(同一处再看一遍,窗也再移过去);at = 小课堂上放的那一段(课里的毫秒,起止);
   *  rows = 这一块的字行各自的框(课本、照片上找到的;舞台照它一行一行刷荧光,没有就照框里的字行) */
  look: { label: string; box: Box; n: number; at?: [number, number]; rows?: Box[] } | null;
  /** 孩子的窗最后停在哪(场景坐标) */
  view: Box | null;
  /** 开着的白纸条(Strip.key);没开 = null */
  strip: string | null;
  /** 落进来过的那几轮(老师那一节的 job,最近的 LESSON_JOBS_MAX 个):孩子端回到这节课时照它知道哪几节已经在里面,不再落一遍 */
  jobs: string[];
  /** 老师念完了几句(带动作的那几轮里的句子;一句念完、它的动作落完加一):指着字的记号照它变旧。没有 = 0 */
  said?: number;
}
export const LESSON_JOBS_MAX = 60;
/** 「看」的那一块最多带几行的框(一整页课本二三十行;再多的不刷,只滚过去) */
export const LOOK_ROWS_MAX = 60;

/** 动作落到页上以后的样子(src/board/lesson-fit.ts 照课本找到框、填好页):lessonStep 只认它,不再查课本 */
export type LessonAct =
  | { k: '翻'; page: PageSource }
  /** at:小课堂上放哪一段(课里的毫秒,对齐到句) */
  | { k: '看'; label: string; box: Box; at?: [number, number]; rows?: Box[] }
  | { k: MarkName; spots: { text: string; box: Box }[] }
  | { k: '写'; text: string; size: Size }
  | { k: '摆'; kit: string; params: Record<string, string>; size: Size }
  | { k: '擦'; all: boolean }
  | { k: '请'; ops: AskName[] };

/** 改一节课的事:老师的动作,或孩子在页上做的(实时那条连接报来的) */
export type LessonEvent =
  | { t: 'act'; act: LessonAct }
  /** 孩子落了一笔(场景坐标);strip = 落在开着的那条白纸条上 */
  | { t: 'stroke'; pts: [number, number][]; strip?: string }
  /** 孩子擦掉自己画的(这一页上的,和开着的白纸条上的) */
  | { t: 'wipe' }
  /** 揭开了一处盖住的(遮、盖) */
  | { t: 'reveal'; text: string }
  /** 点开看了一个字词(弹了田字格) */
  | { t: 'pick'; text: string }
  /** 窗停在了哪 */
  | { t: 'view'; box: Box }
  /** 白纸条里的图形转到了多少度 */
  | { t: 'turn'; item: string; deg: number }
  /** 在课本的一个田字格里写好了(放好):这一格的笔画整个换成这些;空的 = 这一格擦干净了 */
  | { t: 'cell'; id: string; strokes: [number, number][][] }
  /** 孩子拍来了几张(应用收下就铺,不等老师):接在照片页后面,没有照片页就开一页;pick = 这一页能不能点字 */
  | { t: 'photo'; photos: PagePhoto[]; pick: boolean }
  /** 老师念完了一句(这一句的动作已经落了):said 加一 */
  | { t: 'said' }
  /** 老师开始说新的一轮:上一轮指着字的记号(圈、划、加点)都收 */
  | { t: 'round' };

const num = z.number().finite();
export const BoxSchema = z.tuple([num, num, num, num]);
const SizeSchema = z.enum(SIZES);
const AskSchema = z.enum(ASK_NAMES);
const StripItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('write'), text: z.string().min(1).max(40), size: SizeSchema }),
  z.object({ kind: z.literal('shape'), kit: z.string().min(1), params: z.record(z.string(), z.string()), size: SizeSchema }),
]);
const PhotoSchema = z.object({ src: z.string().min(1), w: z.number().int().positive(), h: z.number().int().positive() });
const BookSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('book'),
  src: z.string().min(1),
  title: z.string().min(1),
  pages: z.array(z.number().int().positive()).min(1),
  cut: z.number().finite().min(0),
  layout: z.enum(['prose', 'math']),
  pick: z.boolean(),
});
const PhotoSourceSchema = z.object({ id: z.string().min(1), kind: z.literal('photo'), title: z.string().min(1), photos: z.array(PhotoSchema).min(1).max(PAGE_PHOTOS_MAX), pick: z.boolean() });
const WorkbookSourceSchema = z.object({ id: z.string().min(1), kind: z.literal('workbook'), src: z.string().min(1), title: z.string().min(1), sheets: z.array(z.object({ w: z.number().positive(), h: z.number().positive() })).min(1).max(BOOK_MAX_SHEETS), pick: z.boolean() });
const WhiteSourceSchema = z.object({ id: z.string().min(1), kind: z.literal('white'), title: z.string().min(1), pick: z.boolean() });
const LectureSourceSchema = z.object({ id: z.string().min(1), kind: z.literal('lecture'), title: z.string().min(1), bundle: z.string().min(1), video: z.boolean(), ms: z.number().nonnegative(), pick: z.boolean() });
export const PageSourceSchema = z.discriminatedUnion('kind', [BookSourceSchema, PhotoSourceSchema, WorkbookSourceSchema, WhiteSourceSchema, LectureSourceSchema]);
const RangeSchema = z.tuple([z.number().nonnegative(), z.number().nonnegative()]);
const Layers = {
  teacher: z.object({
    marks: z.array(z.object({ k: z.enum(['圈', '划', '加点', '遮', '盖']), text: z.string().min(1), box: BoxSchema, at: z.number().int().nonnegative().optional() })).max(LESSON_MARKS_MAX),
    strips: z.array(z.object({ key: z.string().min(1), box: BoxSchema, items: z.array(StripItemSchema).max(STRIP_ITEMS_MAX) })),
  }),
  kid: z.object({
    ink: z.array(z.array(z.tuple([num, num])).min(1).max(LESSON_INK_POINTS)).max(LESSON_INK_MAX),
    stripInk: z.record(z.string(), z.array(z.array(z.tuple([num, num])).min(1).max(LESSON_INK_POINTS)).max(LESSON_INK_MAX)).default({}),
    revealed: z.array(z.string()),
    picked: z.array(z.string()).max(LESSON_PICK_MAX),
    turns: z.record(z.string(), num),
    cells: z.record(z.string(), z.array(z.array(z.tuple([num, num])).min(1).max(LESSON_INK_POINTS)).min(1).max(LESSON_CELL_STROKES)).optional(),
  }),
  open: z.array(AskSchema),
};
export const LessonPageSchema = z.discriminatedUnion('kind', [BookSourceSchema.extend(Layers), PhotoSourceSchema.extend(Layers), WorkbookSourceSchema.extend(Layers), WhiteSourceSchema.extend(Layers), LectureSourceSchema.extend(Layers)]);
export const LessonSchema = z.object({
  v: z.literal(1),
  pages: z.array(LessonPageSchema).max(LESSON_PAGES_MAX),
  at: z.string().nullable(),
  look: z.object({ label: z.string(), box: BoxSchema, n: z.number().int().nonnegative(), at: RangeSchema.optional(), rows: z.array(BoxSchema).max(LOOK_ROWS_MAX).optional() }).nullable(),
  view: BoxSchema.nullable(),
  strip: z.string().nullable(),
  jobs: z.array(z.string()).max(LESSON_JOBS_MAX).default([]),
  said: z.number().int().nonnegative().optional(),
});
export const LessonActSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('翻'), page: PageSourceSchema }),
  z.object({ k: z.literal('看'), label: z.string(), box: BoxSchema, at: RangeSchema.optional(), rows: z.array(BoxSchema).max(LOOK_ROWS_MAX).optional() }),
  z.object({ k: z.enum(['圈', '划', '加点', '遮', '盖']), spots: z.array(z.object({ text: z.string().min(1), box: BoxSchema })) }),
  z.object({ k: z.literal('写'), text: z.string().min(1), size: SizeSchema }),
  z.object({ k: z.literal('摆'), kit: z.string().min(1), params: z.record(z.string(), z.string()), size: SizeSchema }),
  z.object({ k: z.literal('擦'), all: z.boolean() }),
  z.object({ k: z.literal('请'), ops: z.array(AskSchema) }),
]);

export const LineActSchema = z.object({ name: z.enum(ACT_NAMES), arg: z.string(), do: LessonActSchema.optional() });

const aligned = (a: z.infer<typeof LineActSchema>): LineAct => a;
const alignedLesson = (l: z.infer<typeof LessonSchema>): Lesson => l;
const alignedAct = (a: z.infer<typeof LessonActSchema>): LessonAct => a;
const alignedPage = (p: z.infer<typeof LessonPageSchema>): LessonPage => p;
void aligned; void alignedLesson; void alignedAct; void alignedPage;

/**
 * 一节课(2026-11-16《多模态教学harness-底层设计》):孩子从首页点进一个 activity 到回首页。一节课铺着页,老师一边说一边在页上做动作,孩子在页上写、点、说。
 * 这里是契约:讲稿里的动作(老师写在句子后面的 `[[看 第 3 题]]`)、动作落到页上以后的样子(LessonAct)、一节课的状态(Lesson)和改它的事(LessonEvent)。
 * 一节课的状态落在 conversations/<老师>/<date>.<话题>.lesson.json(src/runtime/journal/lesson-store.ts),旁边还是板的日志(board-log)。
 * 词:「动作」是老师对页做的事;解析在 src/board/acts.ts,落到页上(找到框)在 src/board/lesson-fit.ts,一节课的状态怎么变在 src/board/lesson.ts。
 */
import { z } from 'zod';
import type { BookLayout } from './textbook.ts';

/**
 * 讲稿里的动作有哪些(《底层设计》第五节):
 * 看(窗移到哪)· 圈、遮(拼音)、盖(印好的答案)· 写(白纸条里写字)· 擦(自己上一样或整条白纸条)· 摆(白纸条里摆图形:点阵、方向盘)· 请(开放哪些作答)· 翻(换一课、回到照片页、加一张白纸页)
 */
export const ACT_NAMES = ['看', '圈', '遮', '盖', '写', '擦', '摆', '请', '翻'] as const;
export type ActName = (typeof ACT_NAMES)[number];

/** 请孩子做的(开放哪些作答):写、圈、点(点字)、涂、切、转、说、添(点阵上添一个) */
export const ASK_NAMES = ['写', '圈', '点', '涂', '切', '转', '说', '添'] as const;
export type AskName = (typeof ASK_NAMES)[number];

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
export const STRIP_ITEMS_MAX = 6;

/** 老师在页上的一个记号:圈(红圈)、遮(盖住字头上的拼音)、盖(整个盖住印好的字);text 是课本上印的字,box 是应用找到的位置 */
export interface TeacherMark { k: '圈' | '遮' | '盖'; text: string; box: Box }

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
/** 照片页、白纸页的 id(一节课各只有一页;课本的一课是「册子#课名」) */
export const PHOTO_PAGE = '作业';
export const WHITE_PAGE = '白纸';

/**
 * 一页铺的是什么(2026-11-16 阶段 3 起不只课本):
 *  book  课本的一课:几页 PDF 竖着连成一条。id = 「册子#课名」(同板的日志里的 base)
 *  photo 孩子拍的作业:几张照片竖着连成一条(先拍的在上),文字层是认字认出的行和题(src/scenes/photo-words/)
 *  white 白纸:什么都没印,老师在上面摆图形、写字(整页就是一条白纸条)
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
  | { id: string; kind: 'white'; title: string; pick: boolean };

/** 一页:铺的是什么,加三层 */
export type LessonPage = PageSource & {
  /** 老师的那一层 */
  teacher: { marks: TeacherMark[]; strips: Strip[] };
  /**
   * 孩子的那一层:笔画(场景坐标,原样不归整)、写在白纸条上的笔画(键:白纸条;收起来就跟着收,回到那道题还在)、
   * 揭开了哪些、点开看过哪些字词(先后)、白纸条里的图形转到多少度(键:<白纸条>#<第几样>)
   */
  kid: { ink: [number, number][][]; stripInk: Record<string, [number, number][][]>; revealed: string[]; picked: string[]; turns: Record<string, number> };
  /** 开放的:这一步请孩子做的(老师的「请」);没请就只能看(和点字) */
  open: AskName[];
};

export interface Lesson {
  v: 1;
  pages: LessonPage[];
  /** 现在铺的是哪一页(id);还没有页 = null */
  at: string | null;
  /** 老师最后让看的那一处;n 每「看」一次加一(同一处再看一遍,窗也再移过去) */
  look: { label: string; box: Box; n: number } | null;
  /** 孩子的窗最后停在哪(场景坐标) */
  view: Box | null;
  /** 开着的白纸条(Strip.key);没开 = null */
  strip: string | null;
  /** 落进来过的那几轮(老师那一节的 job,最近的 LESSON_JOBS_MAX 个):孩子端回到这节课时照它知道哪几节已经在里面,不再落一遍 */
  jobs: string[];
}
export const LESSON_JOBS_MAX = 60;

/** 动作落到页上以后的样子(src/board/lesson-fit.ts 照课本找到框、填好页):lessonStep 只认它,不再查课本 */
export type LessonAct =
  | { k: '翻'; page: PageSource }
  | { k: '看'; label: string; box: Box }
  | { k: '圈' | '遮' | '盖'; spots: { text: string; box: Box }[] }
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
  /** 孩子拍来了几张(应用收下就铺,不等老师):接在照片页后面,没有照片页就开一页;pick = 这一页能不能点字 */
  | { t: 'photo'; photos: PagePhoto[]; pick: boolean };

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
const WhiteSourceSchema = z.object({ id: z.string().min(1), kind: z.literal('white'), title: z.string().min(1), pick: z.boolean() });
export const PageSourceSchema = z.discriminatedUnion('kind', [BookSourceSchema, PhotoSourceSchema, WhiteSourceSchema]);
const Layers = {
  teacher: z.object({
    marks: z.array(z.object({ k: z.enum(['圈', '遮', '盖']), text: z.string().min(1), box: BoxSchema })).max(LESSON_MARKS_MAX),
    strips: z.array(z.object({ key: z.string().min(1), box: BoxSchema, items: z.array(StripItemSchema).max(STRIP_ITEMS_MAX) })),
  }),
  kid: z.object({
    ink: z.array(z.array(z.tuple([num, num])).min(1).max(LESSON_INK_POINTS)).max(LESSON_INK_MAX),
    stripInk: z.record(z.string(), z.array(z.array(z.tuple([num, num])).min(1).max(LESSON_INK_POINTS)).max(LESSON_INK_MAX)).default({}),
    revealed: z.array(z.string()),
    picked: z.array(z.string()).max(LESSON_PICK_MAX),
    turns: z.record(z.string(), num),
  }),
  open: z.array(AskSchema),
};
export const LessonPageSchema = z.discriminatedUnion('kind', [BookSourceSchema.extend(Layers), PhotoSourceSchema.extend(Layers), WhiteSourceSchema.extend(Layers)]);
export const LessonSchema = z.object({
  v: z.literal(1),
  pages: z.array(LessonPageSchema).max(LESSON_PAGES_MAX),
  at: z.string().nullable(),
  look: z.object({ label: z.string(), box: BoxSchema, n: z.number().int().nonnegative() }).nullable(),
  view: BoxSchema.nullable(),
  strip: z.string().nullable(),
  jobs: z.array(z.string()).max(LESSON_JOBS_MAX).default([]),
});
export const LessonActSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('翻'), page: PageSourceSchema }),
  z.object({ k: z.literal('看'), label: z.string(), box: BoxSchema }),
  z.object({ k: z.enum(['圈', '遮', '盖']), spots: z.array(z.object({ text: z.string().min(1), box: BoxSchema })) }),
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

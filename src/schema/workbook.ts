/**
 * 练习册:照教材一个单元编的几页习题,孩子在 iPad 上用 Apple Pencil 直接在页上做。一册一个目录:
 *   workbook.json   这里的形状(`WorkbookSchema`)
 *   01.png 02.png … 每页一张图,和 workbook.json 由同一份排版生成,所以框是准的,不用认字
 *   <名>.pdf        打印版(可选,同一份排版)
 *
 * 坐标:每页自己的千分比,框 `[左, 上, 右, 下]`、点 `[x, y]`,x 按页图的宽、y 按页图的高(都是 0–1000,不是正方形的)。
 * 几页连成一条铺时,换算到舞台坐标由铺的那层做(每页的纵向偏移),这里不管。
 *
 * 一页的题和课本的一页一样是分块(`zones`,./zones.ts):一道题一块(kind problem,label「第 3 题」),题里的小题、一组算式套在里面;
 * 块里孩子写、圈、连的地方是作答区,能指的东西是物件,只给老师的练什么、答案挂在块的 teacher 上(./regions.ts),所以运行时和课本走同一套:
 * 看、能写的格、点读一块(写了 say 的)、给老师的、笔归作答区(src/chalk/kit/workbook.ts 换好交给 src/chalk/kit/book.ts)。
 * 和课本的分块不同的:字和行不从 PDF 来,一页自己带文字层 `lines`(块不写 rows,框里的行归框住它的最里面那块);格就是作答区本身(不带 cell、src)。
 *
 * 一页分三层,下发的只有第一层:
 *   孩子端   页图、文字层 `lines`、能点能圈的字词 `terms`;块的框、kind、label、say,作答区的框和种类(zonesKidPage)
 *   服务端   作答区的名字与区里的东西 `objects`:孩子落的笔照它们归到哪一格、圈住了哪几个,换成给老师的句子
 *   老师     块的 `teacher`:练什么、卡住怎么引、答案(上下文包的「给老师的」,只给脑)
 * 物件也不下发:圈画区里的 `objects` 常常就是答案的位置。答案只给老师参考,孩子端永远不判对错。
 *
 * 读进来先过 `WorkbookSchema`(形状),再过 `workbookProblems`(每页的块和作答区对不对得上、叫法不重名、题写了练什么)。
 */
import { z } from 'zod';
import { PermilleBoxSchema, RegionObjectSchema, RegionSchema, regionId, type Region, type RegionObject } from './regions.ts';
import { ZONE_KINDS, ZoneTeacherSchema, walkZones, zonePageProblems, zonesKidPage, type ZoneKind, type ZonePage, type ZoneTeacher } from './zones.ts';

/** 练习册的一块:同课本的块(./zones.ts 的 Zone),不写 rows(字行就是这一页的 lines),作答区不带课本格子的 cell、src */
export interface WorkbookZone {
  id: string;
  kind: ZoneKind;
  label: string;
  box: z.infer<typeof PermilleBoxSchema>;
  say?: string;
  regions?: Region[];
  objects?: RegionObject[];
  teacher?: ZoneTeacher;
  children?: WorkbookZone[];
}
export const WorkbookZoneSchema: z.ZodType<WorkbookZone> = z.lazy(() => z.object({
  id: regionId,
  kind: z.enum(ZONE_KINDS),
  label: z.string().min(1),
  box: PermilleBoxSchema,
  say: z.string().min(1).optional(),
  regions: z.array(RegionSchema).optional(),
  objects: z.array(RegionObjectSchema).optional(),
  teacher: ZoneTeacherSchema.optional(),
  children: z.array(WorkbookZoneSchema).optional(),
}));

/** 文字层的一行:印的字照原样,点字和老师的「看」照它 */
export const WorkbookLineSchema = z.object({ text: z.string().min(1), box: PermilleBoxSchema });
/** 老师能圈、孩子能点的字词;char、word 点了弹田字格或念,other 只给老师圈 */
export const WorkbookTermSchema = z.object({
  text: z.string().min(1),
  box: PermilleBoxSchema,
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
  /** 这一页的块:一道题一块,题里的小题套在里面(./zones.ts 的写法) */
  zones: z.array(WorkbookZoneSchema).min(1),
});
export type WorkbookPage = z.infer<typeof WorkbookPageSchema>;

export const WorkbookSchema = z.object({
  version: z.literal(2),
  id: regionId,
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

/** 第 n 页(从 1 起)当课本的一页分块(./zones.ts 的 ZonePage):page 就是第几页 */
export const workbookZonePage = (page: Pick<WorkbookPage, 'zones'>, n: number): ZonePage => ({ page: n, zones: page.zones });

/**
 * 形状对了以后再查的:每页照课本的分块查(./zones.ts 的 zonePageProblems:id 不重复、框是正的、小块在大块里、作答区和物件、答案的引用),
 * 叫法一册里不重名(老师 [[看 第 3 题]] 照它找;小题只在同一道题、同一组里不重名,同课本),题(kind problem)写了练什么。
 * 回要改的那几条(一条一句,带第几页);空 = 能用
 */
export function workbookProblems(wb: Workbook): string[] {
  const out: string[] = [];
  const flat = (where: string, b: readonly number[]): void => {
    if (!(b[0]! < b[2]! && b[1]! < b[3]!)) out.push(`${where}:框 [${b.join(', ')}] 不是左上到右下`);
  };
  const names = new Map<string, Set<string>>();
  wb.pages.forEach((page, pi) => {
    const p = `第 ${pi + 1} 页`;
    for (const l of page.lines) flat(`${p}「${l.text}」`, l.box);
    for (const t of page.terms) flat(`${p}「${t.text}」`, t.box);
    out.push(...zonePageProblems(workbookZonePage(page, pi + 1)));
    walkZones(page.zones, (z, _d, parent) => {
      if (z.kind === 'problem' && !parent && !z.teacher?.goal) out.push(`${p}「${z.label}」:题要写 teacher.goal(这道题练什么)`);
      const key = z.kind === 'sub' ? `${parent?.id ?? ''}\u0000${z.label}` : z.label;
      names.set(key, (names.get(key) ?? new Set()).add(z.id));
    });
  });
  for (const [key, ids] of names) {
    if (ids.size < 2) continue;
    const [owner, label] = key.includes('\u0000') ? key.split('\u0000') : ['', key];
    out.push(owner ? `同一块(${owner})下面有 ${ids.size} 个小题都叫「${label}」(${[...ids].join('、')}):同一道题里的小题不重名` : `有 ${ids.size} 块都叫「${label}」(${[...ids].join('、')}):老师说「看 ${label}」会找错,题号一册里连着编`);
  }
  return out;
}

/** 给孩子端的一页:页图、文字层,块的框、kind、label、say 与作答区的框和种类(同课本的 zonesKidPage);作答区的名字、物件、老师的都不下发 */
export function workbookKidPage(page: WorkbookPage, n: number): Pick<WorkbookPage, 'image' | 'lines' | 'terms'> & { zones: ZonePage } {
  return { image: page.image, lines: page.lines, terms: page.terms, zones: zonesKidPage(workbookZonePage(page, n)) };
}

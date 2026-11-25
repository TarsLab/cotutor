/**
 * 课本的分块(zones):课本一页上哪一块是课题、自然段、栏目、例题、题、小题、表格、插图,块里孩子在哪写(作答区),老师怎么叫它、点了念什么、给老师的话。
 * 一页一份 JSON(`p078.json`,PDF 的第几页补成三位),外加一份 `book.json`;按课本 PDF 的指纹分目录(sha1 前 16 位,同索引):
 *   规则出的(不用大模型,建索引后自动出,能重做)  `<workspace>/.cotutor/textbooks/zones/<指纹>/`
 *   编程助手、工作台写的(要备份)                `<vault>/教材/.zones/<指纹>/`
 * 运行时一课挑一份:这一课的页在 vault 里都有就用 vault 的,不然用规则出的,一课里不混(src/memory/textbook-zones.ts)。
 *
 * 坐标:这一页的千分比 `[左, 上, 右, 下]`,x 按页宽、y 按页高(同练习册);读进来换成 PDF 的点。字和行不存,照旧从文字层的索引来(./textbook.ts):
 * 块的 `rows` 只记它那几行字的框(规则出的都写;不写就是框里没被别的块占的行),读回来照框对上索引里的行——框不会因为取字的规则改了就错位,行号会。
 *
 * 一块能套小块(`children`),孩子点的时候落到最里面那一块;作答区、物件、答案照练习册的写法(./regions.ts)。
 * 一段、一道题跨两页:两页上各一块,用同一个 id,读回来照 id 连成一块(段号、题号是一课里数的)。
 * 孩子端只拿块的框、kind、label(书上印的号)、rows、作答区的框和种类;teacher、物件、答案不下发(zonesKidPage)。
 */
import { z } from 'zod';
import { PermilleBoxSchema, RegionObjectSchema, RegionSchema, TeacherSchema, regionId, regionProblems, type PermilleBox } from './regions.ts';

/** 规则出分块的版本:规则改了就加一,旧的重出(同 BOOK_INDEX_VERSION) */
export const ZONES_RULES_VERSION = 1;

/**
 * 块是哪一种:title 课题(单元页上的大字也算)、column 栏目(日积月累、做一做、探索与实践 1)、example 例题、problem 题、sub 小题、
 * group 一组(一排算式、一组口诀)、para 自然段(诗的一节)、table 表格、figure 插图、other 别的字(认字栏、写字栏、课后题、图里的字)
 */
export const ZONE_KINDS = ['title', 'column', 'example', 'problem', 'sub', 'group', 'para', 'table', 'figure', 'other'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** 课本页上画的格(src/schema/textbook.ts 的 BookCell):model 范字、trace 描红、empty 空格、blank 填空;ch 格里印的字,m 照着写的那个字 */
export const ZoneRegionSchema = RegionSchema.extend({
  cell: z.enum(['model', 'trace', 'empty', 'blank']).optional(),
  ch: z.string().min(1).optional(),
  m: z.string().min(1).optional(),
});
export type ZoneRegion = z.infer<typeof ZoneRegionSchema>;

export interface Zone {
  id: string;
  kind: ZoneKind;
  /** 老师和孩子怎么叫它:书上印的号(「例 1」「练一练第 3 题」「第 3 段」),没号的从上往下数;一课里不重名 */
  label: string;
  box: PermilleBox;
  /** 这一块的字行(照读的先后,每行一个框);不写 = 框里没被别的块占的行 */
  rows?: PermilleBox[];
  /** 点它念什么(照印的念) */
  say?: string;
  regions?: ZoneRegion[];
  objects?: z.infer<typeof RegionObjectSchema>[];
  /** 只给老师:练什么、卡住怎么引、答案 */
  teacher?: z.infer<typeof ZoneTeacherSchema>;
  children?: Zone[];
}

/** 给老师的:分块里的块不一定有固定目标(规则出的没有),答案可以没有 */
export const ZoneTeacherSchema = TeacherSchema.partial({ goal: true, answers: true }).extend({ note: z.string().min(1).optional() });

export const ZoneSchema: z.ZodType<Zone> = z.lazy(() => z.object({
  id: regionId,
  kind: z.enum(ZONE_KINDS),
  label: z.string().min(1),
  box: PermilleBoxSchema,
  rows: z.array(PermilleBoxSchema).optional(),
  say: z.string().min(1).optional(),
  regions: z.array(ZoneRegionSchema).optional(),
  objects: z.array(RegionObjectSchema).optional(),
  teacher: ZoneTeacherSchema.optional(),
  children: z.array(ZoneSchema).optional(),
}));

export const ZonePageSchema = z.object({
  /** PDF 的第几页(不是印的页码) */
  page: z.number().int().min(1),
  zones: z.array(ZoneSchema),
  /** 不在哪一块里的作答区(块外面的田字格) */
  regions: z.array(ZoneRegionSchema).optional(),
});
export type ZonePage = z.infer<typeof ZonePageSchema>;

/** 每页最后是谁写的:rules 规则出的、agent 编程助手经 cotutor textbook push、workbench 工作台 */
export const ZONE_WRITERS = ['rules', 'agent', 'workbench'] as const;
export type ZoneWriter = (typeof ZONE_WRITERS)[number];

export const ZoneBookSchema = z.object({
  /** 册名(文件名去掉 .pdf) */
  title: z.string().min(1),
  /** PDF 的指纹 */
  sha: z.string().regex(/^[0-9a-f]{16}$/),
  /** 规则出的:规则的版本(ZONES_RULES_VERSION)、照哪一版索引出的(BOOK_INDEX_VERSION) */
  rules: z.object({ v: z.number().int(), index: z.number().int() }).optional(),
  /** 每页(`p078`)最后是谁写的、什么时候 */
  pages: z.record(z.string().regex(/^p\d{3,4}$/), z.object({ by: z.enum(ZONE_WRITERS), at: z.string().min(1) })),
});
export type ZoneBook = z.infer<typeof ZoneBookSchema>;

/** 一页的文件名:PDF 第 78 页 → p078.json */
export const zoneFile = (n: number): string => `p${String(n).padStart(3, '0')}.json`;
export const zoneKey = (n: number): string => `p${String(n).padStart(3, '0')}`;

/** 一页上的块按树走一遍(先自己后小块),depth 从 0 起 */
export function walkZones(zones: readonly Zone[], f: (z: Zone, depth: number, parent: Zone | null) => void, depth = 0, parent: Zone | null = null): void {
  for (const z of zones) {
    f(z, depth, parent);
    if (z.children) walkZones(z.children, f, depth + 1, z);
  }
}

/**
 * 形状对了以后再查的(一页):id 不重复(块、作答区、物件共用一个空间;跨页的同一块在两页上用同一个 id 不算)、框是正的、小块在大块里、
 * 作答区和物件对得上(./regions.ts 的 regionProblems)、答案引的作答区在这一块里。回要改的那几条;空 = 能用
 */
export function zonePageProblems(p: ZonePage): string[] {
  const out: string[] = [];
  const at = `第 ${p.page} 页`;
  const ids = new Set<string>();
  const flat = (where: string, b: PermilleBox): void => {
    if (!(b[0] < b[2] && b[1] < b[3])) out.push(`${where}:框 [${b.join(', ')}] 不是左上到右下`);
  };
  const inside = (a: PermilleBox, b: PermilleBox, slack = 4): boolean => a[0] >= b[0] - slack && a[1] >= b[1] - slack && a[2] <= b[2] + slack && a[3] <= b[3] + slack;
  walkZones(p.zones, (z, _d, parent) => {
    const w = `${at}「${z.label}」`;
    if (ids.has(z.id)) out.push(`${w}:id「${z.id}」重复`);
    ids.add(z.id);
    flat(w, z.box);
    if (parent && !inside(z.box, parent.box)) out.push(`${w}:出了「${parent.label}」的框`);
    // 字行可以没有宽(取出来宽是 0 的乱码行),不能倒过来
    for (const r of z.rows ?? []) if (!(r[0] <= r[2] && r[1] <= r[3])) out.push(`${w}的一行:框 [${r.join(', ')}] 不是左上到右下`);
    out.push(...regionProblems(w, '块', z.regions ?? [], z.objects ?? [], z.teacher?.answers ?? [], ids, z.box));
  });
  out.push(...regionProblems(at, '块', p.regions ?? [], [], [], ids));
  return out;
}

/** 给孩子端的一页:块的框、kind、label、rows,作答区的框和种类(格子的字照旧给,舞台开写字卡要);teacher、物件、答案、say 以外的都不下发 */
export function zonesKidPage(p: ZonePage): ZonePage {
  const region = (r: ZoneRegion): ZoneRegion => ({ id: r.id, kind: r.kind, label: '格', box: r.box, ...(r.tian ? { tian: true as const } : {}), ...(r.cell ? { cell: r.cell } : {}), ...(r.ch ? { ch: r.ch } : {}), ...(r.m ? { m: r.m } : {}) });
  const zone = (z: Zone): Zone => ({
    id: z.id, kind: z.kind, label: z.label, box: z.box,
    ...(z.rows ? { rows: z.rows } : {}), ...(z.say ? { say: z.say } : {}),
    ...(z.regions?.length ? { regions: z.regions.map(region) } : {}),
    ...(z.children?.length ? { children: z.children.map(zone) } : {}),
  });
  return { page: p.page, zones: p.zones.map(zone), ...(p.regions?.length ? { regions: p.regions.map(region) } : {}) };
}

/** 一册的分块:规则出的、vault 里改好的(页号 → 那一页) */
export interface BookZones {
  rules: Readonly<Record<number, ZonePage>>;
  vault: Readonly<Record<number, ZonePage>>;
}

/** 一课挑一份:这几页在 vault 里都有就用 vault 的,不然都用规则出的(一课里不混:一半有题号一半没有,老师会糊涂);which 说用的是哪份 */
export function pickZones(z: BookZones, pages: readonly number[]): { which: 'vault' | 'rules'; pages: ZonePage[] } {
  const vault = pages.length > 0 && pages.every((n) => z.vault[n]);
  const from = vault ? z.vault : z.rules;
  return { which: vault ? 'vault' : 'rules', pages: pages.flatMap((n) => (from[n] ? [from[n]] : [])) };
}

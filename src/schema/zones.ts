/**
 * 课本的分块(zones):课本一页上哪一块是课题、自然段、栏目、例题、题、小题、表格、插图,块里孩子在哪写(作答区),老师怎么叫它、点了念什么、给老师的话。
 * 协议版本 3(ZONE_FORMAT;设计稿 docs/artifact/分块初始化/)。一页一份 JSON,文件名照页名(印的页码补成三位 `004.json`,没印页码的照页的种类 `封面.json`、`目录-1.json`;
 * 页名怎么起在 src/memory/textbook-page-names.ts),外加一份 `book.json`;按课本 PDF 的指纹分目录(sha1 前 16 位,同索引):
 *   规则出的(不用大模型,建索引后自动出,能重做)  `<workspace>/.cotutor/textbooks/zones/<指纹>/`
 *   编程助手、工作台写的(要备份)                `<vault>/教材/.zones/<指纹>/`
 * 运行时一课挑一份:这一课的页在 vault 里都有就用 vault 的,不然用规则出的,一课里不混(src/memory/textbook-zones.ts)。
 *
 * 坐标:这一页的千分比 `[左, 上, 右, 下]`,x 按页宽、y 按页高(同练习册);读进来换成 PDF 的点。字和行不存,照旧从文字层的索引来(./textbook.ts):
 * 块的 `rows` 只记它那几行字的框(规则出的都写;不写就是框里没被别的块占的行),读回来照框对上索引里的行——框不会因为取字的规则改了就错位,行号会。
 *
 * 一块能套小块(`children`),孩子点的时候落到最里面那一块;作答区、物件、答案照练习册的写法(./regions.ts)。
 * id 整册不重:块 `<页名>-<第几块>`(一页里最外一层从上往下数),小块 `<外面那块>.<第几>`(`4-3.2`),作答区 `<页名>-格<第几>`(这一页第几个候选的格)。
 * 一段、一道题跨两页:下一页那一截写 `cont: <上一页那块的 id>`,读回来连成一块(段号、题号是一课里数的)。旧版(没写 v、照 PDF 页起名的 p078.json)读进来就丢。
 * 孩子端只拿块的框、kind、label(书上印的号)、rows、作答区的框和种类;teacher、物件、答案不下发(zonesKidPage)。
 */
import { z } from 'zod';
import type { BookIndex } from './textbook.ts';
import { PermilleBoxSchema, RegionObjectSchema, RegionSchema, TeacherSchema, regionProblems, type PermilleBox } from './regions.ts';

/** 规则出分块的版本:规则改了就加一,旧的重出(同 BOOK_INDEX_VERSION) */
export const ZONES_RULES_VERSION = 4;

/** 分块文件的协议版本:课本的一页、book.json 都写着(练习册的分块跟着 workbook.json,不写) */
export const ZONE_FORMAT = 3;

/** 页的种类:只有正文、单元页、附录分块;封面这些只记种类(zones 空着) */
export const PAGE_KINDS = ['封面', '扉页', '版权', '目录', '单元页', '正文', '附录', '后记', '封底', '空白'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** 页名:印的页码(`4`;重了的第二页 `4之2`)或页的种类(`封面`、`目录-1`、`无页码-3`) */
export const pageName = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u);
/** 块的 id:同作答区,外加小块的点(`4-3.2`) */
export const zoneId = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}.-]*$/u);

/**
 * 块是哪一种:title 课题(单元页上的大字也算)、column 栏目(日积月累、做一做、探索与实践 1)、example 例题、problem 题、sub 小题、
 * group 一组(一排算式、一组口诀、一行词)、para 自然段(诗的一节、一句)、table 表格、figure 插图、note 注释(页下注、题注,点了不念)、
 * bubble 泡泡(学习伙伴的话、数学里人物说的话)、other 别的字(兜底)。习题(problem)的 rows 只放指令句,内容是它的小块
 */
export const ZONE_KINDS = ['title', 'column', 'example', 'problem', 'sub', 'group', 'para', 'table', 'figure', 'note', 'bubble', 'other'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** 课本页上画的格(src/schema/textbook.ts 的 BookCell):model 范字、trace 描红、empty 空格、blank 填空、table 表格的空格;ch 格里印的字,m 照着写的那个字。打勾的小方框是 kind: tick,不写 cell */
export const ZoneRegionSchema = RegionSchema.extend({
  cell: z.enum(['model', 'trace', 'empty', 'blank', 'table']).optional(),
  ch: z.string().min(1).optional(),
  m: z.string().min(1).optional(),
  /** 框不是 PDF 量出来的候选(横线、圈画区、插图里的空):编程助手写脚本量图量的 */
  src: z.literal('measured').optional(),
});
export type ZoneRegion = z.infer<typeof ZoneRegionSchema>;

export interface Zone {
  id: string;
  kind: ZoneKind;
  /** 老师和孩子怎么叫它:书上印的号(「例 1」「练一练第 3 题」「第 3 段」),没号的从上往下数;一课里不重名 */
  label: string;
  box: PermilleBox;
  /** 接着上一页的哪一块(那一块的 id):读回来连成一块 */
  cont?: string;
  /** 这一块字最多的样式(字体 × 字号,「宋 16」;src/schema/textbook.ts 的 styleOf),存的时候算 */
  style?: string;
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
export type ZoneTeacher = z.infer<typeof ZoneTeacherSchema>;

export const ZoneSchema: z.ZodType<Zone> = z.lazy(() => z.object({
  id: zoneId,
  kind: z.enum(ZONE_KINDS),
  label: z.string().min(1),
  box: PermilleBoxSchema,
  cont: zoneId.optional(),
  style: z.string().min(1).optional(),
  rows: z.array(PermilleBoxSchema).optional(),
  say: z.string().min(1).optional(),
  regions: z.array(ZoneRegionSchema).optional(),
  objects: z.array(RegionObjectSchema).optional(),
  teacher: ZoneTeacherSchema.optional(),
  children: z.array(ZoneSchema).optional(),
}));

export const ZonePageSchema = z.object({
  /** 协议版本(课本的写 ZONE_FORMAT;练习册的不写) */
  v: z.literal(ZONE_FORMAT).optional(),
  /** PDF 的第几页(不是印的页码) */
  page: z.number().int().min(1),
  /** 页名(课本的写):印的页码,或页的种类 */
  name: pageName.optional(),
  /** 页的种类(课本的写) */
  kind: z.enum(PAGE_KINDS).optional(),
  zones: z.array(ZoneSchema),
  /** 不在哪一块里的作答区(块外面的田字格) */
  regions: z.array(ZoneRegionSchema).optional(),
  /** 候选里不是孩子要写的格(装饰的框、图里的格):列它们的 id,cotutor textbook check 不再说漏了 */
  ignore: z.array(z.string().min(1)).optional(),
});
export type ZonePage = z.infer<typeof ZonePageSchema>;

/** 课本目录里的一页:协议版本、页名、种类都要写 */
export const ZoneFileSchema = ZonePageSchema.extend({ v: z.literal(ZONE_FORMAT), name: pageName, kind: z.enum(PAGE_KINDS) });

/** 每页最后是谁写的:rules 规则出的、agent 编程助手经 cotutor textbook push、workbench 工作台 */
export const ZONE_WRITERS = ['rules', 'agent', 'workbench'] as const;
export type ZoneWriter = (typeof ZONE_WRITERS)[number];

export const ZoneBookSchema = z.object({
  v: z.literal(ZONE_FORMAT),
  /** 册名(文件名去掉 .pdf) */
  title: z.string().min(1),
  /** PDF 的指纹 */
  sha: z.string().regex(/^[0-9a-f]{16}$/),
  /** 规则出的:规则的版本(ZONES_RULES_VERSION)、照哪一版索引出的(BOOK_INDEX_VERSION) */
  rules: z.object({ v: z.number().int(), index: z.number().int() }).optional(),
  /** 每页(页名)是 PDF 第几页、最后是谁写的、什么时候 */
  pages: z.record(pageName, z.object({ pdf: z.number().int().min(1), by: z.enum(ZONE_WRITERS), at: z.string().min(1) })),
  /** 样式表:每种样式(「宋 16」)在这本书里是什么(「习题的指令」),编程助手写 */
  styles: z.record(z.string().min(1), z.string()).optional(),
});
export type ZoneBook = z.infer<typeof ZoneBookSchema>;

/** 一页的文件名(不带 .json):印的页码补成三位(`004`、`012之2`),别的照页名(`封面`) */
export const zoneStem = (name: string): string => (/^\d/.test(name) ? name.replace(/^\d+/, (d) => d.padStart(3, '0')) : name);
export const zoneFile = (name: string): string => `${zoneStem(name)}.json`;

/** 一页上的块按树走一遍(先自己后小块),depth 从 0 起 */
export function walkZones(zones: readonly Zone[], f: (z: Zone, depth: number, parent: Zone | null) => void, depth = 0, parent: Zone | null = null): void {
  for (const z of zones) {
    f(z, depth, parent);
    if (z.children) walkZones(z.children, f, depth + 1, z);
  }
}

/**
 * 形状对了以后再查的(一页):id 不重复(块、作答区、物件共用一个空间)、框是正的、小块在大块里、
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

/**
 * 铺着的几页挑分块:照目录上最里一层的课分开挑(每一课 pickZones,一课里不混),不在课里的页(目录、封面)一页一挑。
 * 数学一个单元铺开时,编程助手改好的那一课用 vault 的,没改的课用规则出的。which:都是 vault 的、都是规则出的,还是 mixed
 */
export function pickBookZones(index: Pick<BookIndex, 'lessons'>, z: BookZones, pages: readonly number[]): { which: 'vault' | 'rules' | 'mixed'; pages: ZonePage[] } {
  const leaf = (n: number): string => {
    const l = index.lessons.filter((x) => n >= x.pages[0] && n <= x.pages[1]).sort((a, b) => a.pages[1] - a.pages[0] - (b.pages[1] - b.pages[0]))[0];
    return l ? `${l.title}@${l.pages[0]}` : `p${n}`;
  };
  const groups = new Map<string, number[]>();
  for (const n of pages) groups.set(leaf(n), [...(groups.get(leaf(n)) ?? []), n]);
  const got = new Map<number, ZonePage>();
  const whiches = new Set<'vault' | 'rules'>();
  for (const ns of groups.values()) {
    const r = pickZones(z, ns);
    whiches.add(r.which);
    for (const p of r.pages) got.set(p.page, p);
  }
  return { which: whiches.size > 1 ? 'mixed' : whiches.has('vault') ? 'vault' : 'rules', pages: pages.flatMap((n) => (got.has(n) ? [got.get(n)!] : [])) };
}

/** 编程助手在草稿里写的行号:一行「L4」,一行里隔开的第二截「L4.2」(cotutor textbook prep 的页面数据) */
export const LINE_REF = /^L(\d+)(?:\.(\d+))?$/;

/**
 * 编程助手写的一页(草稿)换成存的样子:rows 里的行号换成框(lineBox 认不出的记一条、去掉),没写 box 的块照它的字行、小块、作答区、物件撑出来
 * (先小块后自己;什么都没有的记一条)。raw 是读进来还没过形状的一页,拷一份再改,回改好的(还要过 ZoneFileSchema)
 */
export function resolveDraft(raw: unknown, lineBox: (ref: string) => PermilleBox | null, at: string, problems: string[]): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const page = structuredClone(raw) as { zones?: unknown };
  type Raw = { label?: unknown; box?: unknown; rows?: unknown; children?: unknown; regions?: unknown; objects?: unknown };
  const boxOf = (x: unknown): PermilleBox | null => (Array.isArray(x) && x.length === 4 && x.every((v) => typeof v === 'number') ? (x as PermilleBox) : null);
  const visit = (zs: unknown): void => {
    if (!Array.isArray(zs)) return;
    for (const z of zs as Raw[]) {
      if (!z || typeof z !== 'object') continue;
      visit(z.children);
      if (Array.isArray(z.rows)) z.rows = z.rows.flatMap((r: unknown) => {
        if (typeof r !== 'string') return [r];
        const box = LINE_REF.test(r) ? lineBox(r) : null;
        if (!box) problems.push(`${at}「${String(z.label ?? '')}」的字行「${r}」:这一页没有这一行(照页面数据的行号写,隔开的一截写 L4.2)`);
        return box ? [box] : [];
      });
      if (z.box === undefined) {
        const parts = [z.rows, z.regions, z.objects, z.children].flatMap((xs) => (Array.isArray(xs) ? xs : [])).map((x: unknown) => boxOf(x) ?? boxOf((x as { box?: unknown } | null)?.box)).filter((b): b is PermilleBox => b !== null);
        if (parts.length) z.box = [Math.min(...parts.map((b) => b[0])), Math.min(...parts.map((b) => b[1])), Math.max(...parts.map((b) => b[2])), Math.max(...parts.map((b) => b[3]))];
        else problems.push(`${at}「${String(z.label ?? '')}」:没有 box,也没有字行、小块、作答区能撑出框(插图这种写脚本量好写 box)`);
      }
    }
  };
  visit(page.zones);
  return page;
}

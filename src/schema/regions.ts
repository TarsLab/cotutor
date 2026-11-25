/**
 * 孩子在页上作答的地方,练习册(./workbook.ts)和课本的分块(./zones.ts)共用一套:作答区、区里能指的东西、只给老师的答案。
 *
 * 坐标:一页自己的千分比,框 `[左, 上, 右, 下]`、点 `[x, y]`,x 按页宽、y 按页高(都是 0–1000,不是正方形的)。
 *
 * 答案挂在作答区上(`at` 列这一条答案占的区,按书写的顺序):一个词写在两个田字格里、一个算式跨三格、一句话跨两行,都是一条。
 * `ok` 是几种都算对的写法(每种是 `at` 那几格连起来写的样子);连线用 `links`;没有固定答案的(编题、写话、圈法不唯一)用 `note` 写怎么看。
 * 答案只给老师参考,孩子端永远不判对错;作答区的名字、物件、答案都不下发(物件常常就是答案的位置)。
 */
import { z } from 'zod';

export const permille = z.number().min(0).max(1000);
/** 框 [左, 上, 右, 下],页的千分比 */
export const PermilleBoxSchema = z.tuple([permille, permille, permille, permille]);
/** 点 [x, y],页的千分比 */
export const PermillePointSchema = z.tuple([permille, permille]);
export type PermilleBox = z.infer<typeof PermilleBoxSchema>;
export type PermillePoint = z.infer<typeof PermillePointSchema>;

/** id:字母、数字、汉字、连字符,一页(练习册是一册)里不重复(作答区和物件共用一个空间) */
export const regionId = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u);

/**
 * 作答区是哪一种,孩子在里面怎么作答、服务端怎么读他的笔:
 *   write     写:填空格、横线、田字格、四线三格。读成「这一格写了几笔」,写的是什么看那一格的图
 *   circle    圈:在 objects 里圈一个(选读音、选字母)或圈几组(每 4 个圈一组)。读成每一圈围住了哪几个
 *   draw      画:照题画几个圆、三角形、示意图。读成框里画了几个闭合的形状
 *   link      连线:左右两列的 objects 带 side,读成哪个连到了哪个
 *   underline 画线:在短文里画出一句。读成画在哪几行、哪一段字下面
 *   trace     描写:描灰色的字母,带四线和参考笔画 model
 *   tick      打勾:课本记录表、思考与练习里的小方框(用笔画勾,手指点只回应)
 */
export const REGION_KINDS = ['write', 'circle', 'draw', 'link', 'underline', 'trace', 'tick'] as const;
export type RegionKind = (typeof REGION_KINDS)[number];

export const RegionSchema = z.object({
  id: regionId,
  kind: z.enum(REGION_KINDS),
  /** 给老师看的名字:「乘号左边」「第 2 小题口诀」「法的第 1 个临写格」 */
  label: z.string().min(1),
  box: PermilleBoxSchema,
  /** 田字格(一格一个字) */
  tian: z.literal(true).optional(),
  /** 四线三格的四条线,从上往下的 y */
  fourLine: z.tuple([permille, permille, permille, permille]).optional(),
  /** 照着写的字母与参考笔画(一笔一串点,照 src/chalk/glyphs/ 的笔顺):描写区必有,临写的格子可以带 */
  model: z.object({ glyph: z.string().min(1), strokes: z.array(z.array(PermillePointSchema).min(2)).min(1) }).optional(),
  /** 这一格写起来太长(编题、写话),可以说着答:老师请他说,不强求写 */
  say: z.literal(true).optional(),
});
export type Region = z.infer<typeof RegionSchema>;

/** 题里能指的东西:一个积木、一个读音选项、短文里的一个词、连线的一个端点、只用来数的风车 */
export const RegionObjectSchema = z.object({
  id: regionId,
  /** 是什么:「积木」「zhí」「蒲公英」「豆荚裂开，种子蹦出去」 */
  label: z.string().min(1),
  box: PermilleBoxSchema,
  /** 画出来的中心(立体积木的中心不在框的正中) */
  center: PermillePointSchema,
  /** 在这道题的哪个作答区里被圈、被连;只是图(数一数的风车)不写 */
  region: regionId.optional(),
  /** 连线的哪一头 */
  side: z.enum(['left', 'right']).optional(),
  /** 画面上本来就分好的组(第几盘草莓) */
  group: z.number().int().min(1).optional(),
});
export type RegionObject = z.infer<typeof RegionObjectSchema>;

export const AnswerSchema = z.object({
  /** 这条答案占的作答区,按书写顺序 */
  at: z.array(regionId).min(1),
  /** 都算对的写法;跨几格的照格子顺序连着写(「3×4=12」占乘号左、右、等号右三格) */
  ok: z.array(z.string().min(1)).min(1).optional(),
  /** 连线:[左端物件, 右端物件] */
  links: z.array(z.tuple([regionId, regionId])).min(1).optional(),
  /** 没有唯一答案时怎么看:「每个积木只圈一次,每组 4 个,圈法可以不同」 */
  note: z.string().min(1).optional(),
}).refine((a) => a.ok || a.links || a.note, { message: '答案要有 ok、links、note 之一' });
export type Answer = z.infer<typeof AnswerSchema>;

/** 只给老师(脑)的:这道题练什么、孩子卡住怎么引、答案 */
export const TeacherSchema = z.object({
  goal: z.string().min(1),
  hint: z.string().min(1).optional(),
  answers: z.array(AnswerSchema),
});
export type TeacherNote = z.infer<typeof TeacherSchema>;

/** 框里外:a 在 b 里面(容 slack 千分的出界,画框时的描边) */
export const boxWithin = (a: PermilleBox, b: PermilleBox, slack = 4): boolean =>
  a[0] >= b[0] - slack && a[1] >= b[1] - slack && a[2] <= b[2] + slack && a[3] <= b[3] + slack;
export const pointIn = ([x, y]: PermillePoint, b: PermilleBox): boolean => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/**
 * 一组作答区、物件、答案自己对不对得上(一道题、一块):框是正的、物件引的作答区在、连线两头有 side、描写区带 model、答案引的作答区与物件都在。
 * seen 记一页 / 一册里出现过的 id(重复的报);回要改的那几条,where 是这一组的名字,unit 是它叫什么(题、块),frame 是它的框
 */
export function regionProblems(where: string, unit: '题' | '块', regions: readonly Region[], objects: readonly RegionObject[], answers: readonly Answer[], seen: Set<string>, frame?: PermilleBox): string[] {
  const out: string[] = [];
  const here = unit === '题' ? '这道题里' : '这一块里';
  const dup = (at: string, key: string): void => {
    if (seen.has(key)) out.push(`${at}:id「${key}」重复`);
    seen.add(key);
  };
  const flat = (at: string, b: PermilleBox): void => {
    if (!(b[0] < b[2] && b[1] < b[3])) out.push(`${at}:框 [${b.join(', ')}] 不是左上到右下`);
  };
  const byId = new Map(regions.map((r) => [r.id, r]));
  for (const r of regions) {
    const at = `${where}「${r.label}」`;
    dup(at, r.id);
    flat(at, r.box);
    if (frame && !boxWithin(r.box, frame)) out.push(`${at}:作答区出了${unit}框`);
    if (r.kind === 'trace' && !r.model) out.push(`${at}:描写区要带 model`);
    if (r.model && r.kind !== 'trace' && r.kind !== 'write') out.push(`${at}:只有描写、书写的格子带 model`);
    if (r.fourLine && !r.fourLine.every((y, i) => i === 0 || y > r.fourLine![i - 1]!)) out.push(`${at}:四线要从上往下`);
  }
  const objs = new Map(objects.map((o) => [o.id, o]));
  for (const o of objects) {
    const at = `${where}「${o.label}」`;
    dup(at, o.id);
    flat(at, o.box);
    if (!pointIn(o.center, o.box)) out.push(`${at}:中心不在框里`);
    const r = o.region === undefined ? undefined : byId.get(o.region);
    if (o.region !== undefined && !r) out.push(`${at}:作答区「${o.region}」不在${here}`);
    if (o.side && r?.kind !== 'link') out.push(`${at}:只有连线的端点写 side`);
    else if (r?.kind === 'link' && !o.side) out.push(`${at}:连线的端点要写 side`);
  }
  for (const r of regions.filter((x) => x.kind === 'link')) {
    const ends = objects.filter((o) => o.region === r.id);
    if (!ends.some((o) => o.side === 'left') || !ends.some((o) => o.side === 'right')) out.push(`${where}「${r.label}」:连线区左右两头都要有端点`);
  }
  for (const a of answers) {
    for (const rid of a.at) if (!byId.has(rid)) out.push(`${where}答案:作答区「${rid}」不在${here}`);
    for (const [l, r] of a.links ?? []) {
      if (objs.get(l)?.side !== 'left') out.push(`${where}答案:「${l}」不是连线的左端`);
      if (objs.get(r)?.side !== 'right') out.push(`${where}答案:「${r}」不是连线的右端`);
    }
    if (a.links && !a.at.every((rid) => byId.get(rid)?.kind === 'link')) out.push(`${where}答案:links 只挂在连线区上`);
  }
  return out;
}

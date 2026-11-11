/**
 * 教具卡(数学卡):老师先画——挑一种画法(src/chalk/kit/:点阵、方向盘…)写几个参数,板上就是一幅画好的图;
 * 每种画法事先设计好孩子能做的操作(切、圈、涂、转),老师每张卡可以只开放其中几种。孩子在上面动手,「给老师看」。
 * 交回来三样:板那一刻的图(随那一轮直接附给老师,不经读图工具)、这一步请他做的操作、应用照几何算的大概(describe)。
 * 孩子的笔画不归整;大概和图对不上,老师信图。
 * 围栏的标签就是画法的名字(```点阵);写 ```kit 再在第一行写名字也认。
 * 2026-11-10 ray 检查作业「面向东,后面是什么」:8 轮全靠说,东西南北被听成冬、难、奶奶;孩子自己在纸上画了方向牌才全对。
 * 舞台在舞台包里(src/ui/stage/kit.tsx):画面现烤、逐笔画出来,落下就自己铺满打开;下一张还是同一种画法,舞台不关、只画差别。
 */
import { z } from 'zod';
import { KITS, KIT_MARK_MAX, KIT_MARK_POINTS, describeKit, kitOf, kitOps, kitParams, readKitLines, type KitState } from '../../chalk/index.ts';
import { bodyLines, type CardKind } from './kind.ts';

/** 题目最多几个字:顶栏一行,孩子一眼读完 */
export const KIT_PROMPT_MAX = 40;

export const KitPropsSchema = z.object({
  /** 哪种教具(src/chalk/kit 的 KITS) */
  kit: z.string().min(1),
  /** 参数(已经补齐缺省) */
  params: z.record(z.string(), z.string()),
  /** 这一步开放给孩子的操作(这种教具的操作里的几种;不写 = 全开) */
  ops: z.array(z.string()).optional(),
  /** 要孩子做什么(顶栏那一行);没有就只是给他看、随便转 */
  prompt: z.string().optional(),
});
export type KitProps = z.infer<typeof KitPropsSchema>;

const point = z.tuple([z.number().finite(), z.number().finite()]);

export const KitStateSchema = z.object({
  /** 每一组现在转到多少度(顺时针为正) */
  turn: z.record(z.string(), z.number().finite()).optional(),
  /** 一共按了几次转 */
  moves: z.number().int().min(0).max(999).optional(),
  /** 画的几笔(场景坐标) */
  marks: z.array(z.array(point).min(1).max(KIT_MARK_POINTS)).max(KIT_MARK_MAX).optional(),
  /** 照片做底的板:照片的高 ÷ 宽(舞台量的) */
  aspect: z.number().finite().min(0.05).max(20).optional(),
  /** 「给老师看」时板那一刻的图(相对 workspace 根,如 conversations/math-tutor/2026-11-11.1620-3.cards/0.png);服务端写,页面不填 */
  image: z.string().optional(),
});
export type KitCardState = z.infer<typeof KitStateSchema>;

/** 这张卡是不是教具卡的标签:kit,或一种教具的名字(```点阵) */
export function kitTag(name: string): boolean {
  return name === 'kit' || Boolean(kitOf(name));
}

export const kit: CardKind<KitProps, KitCardState> = {
  name: 'kit',
  props: KitPropsSchema,
  parse(body, mods) {
    const lines = bodyLines(body);
    // 教具名写在第一行;写在标签后面(```kit 方向盘)也认
    const name = mods[0] && kitOf(mods[0]) ? mods[0] : (lines.shift() ?? '');
    const k = kitOf(name);
    if (!k) throw new Error(`标签写教具的名字;现在有:${KITS.map((x) => x.name).join('、')}`);
    const { params, ops, prompt } = readKitLines(k, lines);
    const n = Array.from(prompt).length;
    if (n > KIT_PROMPT_MAX) throw new Error(`题目 ${n} 个字,最多 ${KIT_PROMPT_MAX} 个;一句话说清要他转什么、圈什么`);
    return { kit: k.name, params, ops, ...(prompt ? { prompt } : {}) };
  },
  state: KitStateSchema,
  describe(p, s) {
    const k = kitOf(p.kit);
    if (!k) return JSON.stringify(s);
    const st: KitState = { turn: s.turn, moves: s.moves, marks: s.marks, aspect: s.aspect };
    return `${describeKit(k, kitParams(k, p.params), st, kitOps(k, p.ops))}${s.image ? ';图随这一轮附上,以图为准' : ''}`;
  },
};

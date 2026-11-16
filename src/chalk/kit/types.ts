/**
 * 图形:一种预设的画法(点阵、方向盘)。老师在讲稿里写 [[摆 点阵 6 行 6 个]],这里排出画面(每样东西带名字)、说清哪一组能转;
 * 画面摆在白纸条上(src/board/strip.ts),孩子在上面转一转、圈一圈,应用照名字把他做了什么说成一句话给老师,不用看图。
 * 和 glyphs/(字母笔顺)一样是「参数 → 骨架」的纯函数;画、烤、逐笔露出来都是 chalk 现成的。
 */

import type { ChalkGroup, ChalkSkeleton } from '../types.ts';

/** 能转的一组:绕一个点转,一次转一格 */
export interface KitTurn {
  /** 状态里的键 */
  id: string;
  /** 给老师说的名字(「方向盘」) */
  label: string;
  /** 这一组的元素;在 skeletons 里要连着(舞台把它们收进一个 <g> 一起转) */
  elementIds: string[];
  /** 绕哪个点转(场景坐标) */
  pivot: [number, number];
  /** 一格多少度(顺时针为正) */
  step: number;
  /** 转的时候保持正着的元素(字):位置跟着转,自己不歪 */
  upright: string[];
}

/** 一幅教具的画面 */
export interface KitScene {
  /** 笔顺即数组顺序;带 label 的是孩子能指的东西(圈住了就说这个名字) */
  skeletons: ChalkSkeleton[];
  groups: ChalkGroup[];
  turns: KitTurn[];
  /** 画框(场景坐标 [x, y, 宽, 高]):给了就按它铺,添了线、少了线画面都不挪位置;不给 = 按画的东西的外框 */
  frame?: [number, number, number, number];
}

/** 孩子在教具上做的事 */
export interface KitState {
  /** 每一组现在转到多少度(顺时针为正,0–359) */
  turn?: Record<string, number>;
  /** 一共按了几次转 */
  moves?: number;
  /** 画的几笔(场景坐标,孩子画成什么样就是什么样,不归整) */
  marks?: [number, number][][];
}

/**
 * 一个参数:名字、给老师看的一句;能取的值两种写法——values 列举(第一个是缺省),或 read 自己读(返回规整后的值,读不成就抛,说清怎么写)。
 * 没写这个参数时:列举的取第一个,自己读的取 fallback。
 */
export interface KitParam {
  key: string;
  note: string;
  values?: readonly string[];
  read?(v: string): string;
  fallback?: string;
  /** 非写不可;没写就抛 */
  required?: boolean;
}

export interface Kit {
  /** 图形的名字:老师写 [[摆 点阵 …]] 就是它 */
  name: string;
  params: readonly KitParam[];
  /** 一行简写 → 参数(「2 行 9 个」→ 行、每行);不是简写回 null */
  shorthand?(line: string): Record<string, string> | null;
  /** 参数(已经补齐缺省、查过取值)→ 画面 */
  build(p: Readonly<Record<string, string>>): KitScene;
  /**
   * 孩子做了什么,应用照几何算的一句(给老师的「大概」):能算准的照实说(转了多少、圈住了哪个字),算不准的说大概(几道线、大致分成几份)。
   * 老师同时拿到一张图,以图为准;这句只帮它聚焦。
   */
  read(p: Readonly<Record<string, string>>, state: KitState, scene: KitScene): string;
}


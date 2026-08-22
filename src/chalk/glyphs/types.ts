/**
 * 字形资源包的数据面(小写拉丁字母,print 分写体)。
 *
 * 归一化坐标系与四线三格严格对齐(kid-canvas Write.tsx 的采集面同一套):
 * x 高 = 1 个单位,基线 y = 0,y 向上为负。
 *
 *   y = -2   top      升部顶(b d f h k l t)
 *   y = -1   xTop     x 高顶
 *   y =  0   base     基线
 *   y = +1   bottom   降部底(g j p q y)
 *
 * 每个字形自己的左边界是 x = 0,advance 是墨迹宽度(不含字间距,
 * 字间距由排版方按 letterSpacing 给)。消费方乘 xHeight 换算成 px。
 *
 * 笔画顺序 = 数组顺序 = 教学笔顺;一笔之内的段首尾相接。
 */

/** 直线到 (x, y) */
export interface SegLine {
  k: 'L';
  to: readonly [number, number];
}

/**
 * 椭圆弧。参数式 x = cx + rx·cos θ、y = cy + ry·sin θ(角度制)。
 * 屏幕坐标 y 向下为正,故 θ 递增 = 顺时针,θ 递减 = 逆时针
 * (写 o、a、c 的圈都是逆时针,即 a1 < a0)。
 * 弧的起点必须与前一段的终点重合,由 letters.test.ts 的连续性断言把关。
 */
export interface SegArc {
  k: 'A';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** 起始角(度) */
  a0: number;
  /** 终止角(度) */
  a1: number;
}

/** 三次贝塞尔到 to,控制点 c1、c2(s、r、t 的钩这类不规则曲线用) */
export interface SegCubic {
  k: 'C';
  c1: readonly [number, number];
  c2: readonly [number, number];
  to: readonly [number, number];
}

export type Seg = SegLine | SegArc | SegCubic;

/** 一笔:从 start 起,依次走完 segs */
export interface GlyphStroke {
  start: readonly [number, number];
  segs: readonly Seg[];
}

export interface Glyph {
  ch: string;
  /** 墨迹宽度(x 高为 1 单位),排版按此前进 */
  advance: number;
  /** 笔画序列,数组顺序即笔顺 */
  strokes: readonly GlyphStroke[];
}

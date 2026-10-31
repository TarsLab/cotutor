/**
 * 26 个小写拉丁字母的笔顺(print 分写体,英美小学通行写法)。大写在 capitals.ts。
 *
 * 一个字形一条记录,strokes 顺序 = 教学笔顺;圈类字母(a c d e g o q)逆时针,
 * 拱类(h m n r)先竖后拱,点(i j)最后落。选型口径见 docs/glyphs.md。
 *
 * 坐标是归一化的四线三格(metrics.ts):x 高 = 1,基线 = 0,升部 -2,降部 +1。
 * 数值经 snap 逐字调过;改动请重跑 `node --experimental-strip-types tests/letters.test.ts`
 * 与字母表 snap,几何断言(升降部到位、笔画连续、墨迹不越界)会挡住手滑。
 */

import type { Glyph } from './types.ts';
import { ASC, XT, BASE, DESC } from './metrics.ts';

/** 圈类字母的碗:圆心 (0.5, -0.5)、半径 0.5,从右上 -30° 逆时针整圈 */
const bowl = (a0 = -30, a1 = -390) =>
  ({ k: 'A', cx: 0.5, cy: -0.5, rx: 0.5, ry: 0.5, a0, a1 }) as const;

const LETTERS: Glyph[] = [
  {
    ch: 'a',
    advance: 1,
    strokes: [
      // 碗:从右上起逆时针一整圈,收回起点
      { start: [0.5 + 0.5 * Math.cos((-30 * Math.PI) / 180), -0.5 + 0.5 * Math.sin((-30 * Math.PI) / 180)], segs: [bowl()] },
      // 右竖
      { start: [1, XT], segs: [{ k: 'L', to: [1, BASE] }] },
    ],
  },
  {
    ch: 'b',
    advance: 1,
    strokes: [
      { start: [0, ASC], segs: [{ k: 'L', to: [0, BASE] }] },
      // 碗:与 a/d/g/o/q 同一个圆(圆心 0.5,-0.5 半径 0.5),从竖线腰顺时针绕满一圈
      { start: [0, -0.5], segs: [{ k: 'A', cx: 0.5, cy: -0.5, rx: 0.5, ry: 0.5, a0: 180, a1: 540 }] },
    ],
  },
  {
    ch: 'c',
    advance: 0.83,
    strokes: [
      // 开口朝右的弧;圆与 a/d/g/o/q 同一个,只是不闭合
      { start: [0.5 + 0.5 * Math.cos((-50 * Math.PI) / 180), -0.5 + 0.5 * Math.sin((-50 * Math.PI) / 180)],
        segs: [{ k: 'A', cx: 0.5, cy: -0.5, rx: 0.5, ry: 0.5, a0: -50, a1: -310 }] },
    ],
  },
  {
    ch: 'd',
    advance: 1,
    strokes: [
      { start: [0.5 + 0.5 * Math.cos((-30 * Math.PI) / 180), -0.5 + 0.5 * Math.sin((-30 * Math.PI) / 180)], segs: [bowl()] },
      { start: [1, ASC], segs: [{ k: 'L', to: [1, BASE] }] },
    ],
  },
  {
    ch: 'e',
    advance: 0.95,
    strokes: [
      // 一笔:先向右画横,再顺着圈逆时针绕回,收口在右下
      { start: [0, -0.5], segs: [
        { k: 'L', to: [0.95, -0.5] },
        { k: 'A', cx: 0.475, cy: -0.5, rx: 0.475, ry: 0.5, a0: 0, a1: -310 },
      ] },
    ],
  },
  {
    ch: 'f',
    advance: 0.8,
    strokes: [
      // 顶钩向右上翘,回到竖线顶后直下
      { start: [0.72, ASC], segs: [
        { k: 'A', cx: 0.72, cy: -1.7, rx: 0.34, ry: 0.3, a0: -90, a1: -180 },
        { k: 'L', to: [0.38, BASE] },
      ] },
      { start: [0.02, XT], segs: [{ k: 'L', to: [0.8, XT] }] },
    ],
  },
  {
    ch: 'g',
    advance: 1,
    strokes: [
      { start: [0.5 + 0.5 * Math.cos((-30 * Math.PI) / 180), -0.5 + 0.5 * Math.sin((-30 * Math.PI) / 180)], segs: [bowl()] },
      // 右竖下探降部,末端向左钩
      { start: [1, XT], segs: [
        { k: 'L', to: [1, 0.55] },
        { k: 'A', cx: 0.55, cy: 0.55, rx: 0.45, ry: 0.45, a0: 0, a1: 140 },
      ] },
    ],
  },
  {
    ch: 'h',
    advance: 1,
    strokes: [
      { start: [0, ASC], segs: [{ k: 'L', to: [0, BASE] }] },
      // 肩:上半圆从左到右,再直下
      { start: [0, -0.5], segs: [
        { k: 'A', cx: 0.5, cy: -0.5, rx: 0.5, ry: 0.5, a0: 180, a1: 360 },
        { k: 'L', to: [1, BASE] },
      ] },
    ],
  },
  {
    ch: 'i',
    advance: 0.32,
    strokes: [
      { start: [0.16, XT], segs: [{ k: 'L', to: [0.16, BASE] }] },
      // 点:极短一笔,freedraw 的圆端渲染成点
      { start: [0.16, -1.42], segs: [{ k: 'L', to: [0.16, -1.32] }] },
    ],
  },
  {
    ch: 'j',
    advance: 0.6,
    strokes: [
      { start: [0.6, XT], segs: [
        { k: 'L', to: [0.6, 0.55] },
        // rx 放宽、ry 压扁:尾巴伸得开,又不越过降部底线
        { k: 'A', cx: 0.05, cy: 0.55, rx: 0.55, ry: 0.45, a0: 0, a1: 95 },
      ] },
      { start: [0.6, -1.42], segs: [{ k: 'L', to: [0.6, -1.32] }] },
    ],
  },
  {
    ch: 'k',
    advance: 1.1,
    strokes: [
      { start: [0, ASC], segs: [{ k: 'L', to: [0, BASE] }] },
      // 一笔进出:右上斜进到竖线腰,再右下斜出
      { start: [1.1, XT], segs: [
        { k: 'L', to: [0.05, -0.35] },
        { k: 'L', to: [1.1, BASE] },
      ] },
    ],
  },
  {
    ch: 'l',
    advance: 0.3,
    strokes: [{ start: [0.15, ASC], segs: [{ k: 'L', to: [0.15, BASE] }] }],
  },
  {
    ch: 'm',
    advance: 1.68,
    strokes: [
      { start: [0, XT], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, -0.55], segs: [
        { k: 'A', cx: 0.42, cy: -0.55, rx: 0.42, ry: 0.45, a0: 180, a1: 360 },
        { k: 'L', to: [0.84, BASE] },
      ] },
      { start: [0.84, -0.55], segs: [
        { k: 'A', cx: 1.26, cy: -0.55, rx: 0.42, ry: 0.45, a0: 180, a1: 360 },
        { k: 'L', to: [1.68, BASE] },
      ] },
    ],
  },
  {
    ch: 'n',
    advance: 1,
    strokes: [
      { start: [0, XT], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, -0.55], segs: [
        { k: 'A', cx: 0.5, cy: -0.55, rx: 0.5, ry: 0.45, a0: 180, a1: 360 },
        { k: 'L', to: [1, BASE] },
      ] },
    ],
  },
  {
    ch: 'o',
    advance: 1,
    strokes: [
      // 从正上起,逆时针一整圈
      { start: [0.5, XT], segs: [{ k: 'A', cx: 0.5, cy: -0.5, rx: 0.5, ry: 0.5, a0: -90, a1: -450 }] },
    ],
  },
  {
    ch: 'p',
    advance: 1,
    strokes: [
      { start: [0, XT], segs: [{ k: 'L', to: [0, DESC] }] },
      { start: [0, -0.5], segs: [{ k: 'A', cx: 0.5, cy: -0.5, rx: 0.5, ry: 0.5, a0: 180, a1: 540 }] },
    ],
  },
  {
    ch: 'q',
    advance: 1,
    strokes: [
      { start: [0.5 + 0.5 * Math.cos((-30 * Math.PI) / 180), -0.5 + 0.5 * Math.sin((-30 * Math.PI) / 180)], segs: [bowl()] },
      { start: [1, XT], segs: [{ k: 'L', to: [1, DESC] }] },
    ],
  },
  {
    ch: 'r',
    advance: 0.74,
    strokes: [
      { start: [0, XT], segs: [{ k: 'L', to: [0, BASE] }] },
      // 小肩:从竖线腰向右上挑出
      { start: [0, -0.6], segs: [{ k: 'C', c1: [0.06, -0.96], c2: [0.42, -0.93], to: [0.74, -0.85] }] },
    ],
  },
  {
    ch: 's',
    advance: 0.85,
    strokes: [
      { start: [0.72, -0.82], segs: [
        { k: 'C', c1: [0.6, -1.06], c2: [0.18, -1.06], to: [0.12, -0.78] },
        { k: 'C', c1: [0.05, -0.5], c2: [0.8, -0.55], to: [0.72, -0.22] },
        { k: 'C', c1: [0.66, 0.05], c2: [0.24, 0.06], to: [0.1, -0.12] },
      ] },
    ],
  },
  {
    ch: 't',
    advance: 0.68,
    strokes: [
      // 竖到底后向右挑一个小钩
      { start: [0.3, -1.7], segs: [
        { k: 'L', to: [0.3, 0] },
        // 钩从基线起向右上挑:控制点都压在 y=0,曲线既不越线也不悬空
        { k: 'C', c1: [0.36, 0], c2: [0.5, 0], to: [0.62, -0.09] },
      ] },
      { start: [0.02, XT], segs: [{ k: 'L', to: [0.62, XT] }] },
    ],
  },
  {
    ch: 'u',
    advance: 1,
    strokes: [
      // 左竖下来接底弧,拐上去
      { start: [0, XT], segs: [
        { k: 'L', to: [0, -0.4] },
        { k: 'A', cx: 0.5, cy: -0.4, rx: 0.5, ry: 0.4, a0: 180, a1: 0 },
      ] },
      { start: [1, XT], segs: [{ k: 'L', to: [1, BASE] }] },
    ],
  },
  {
    ch: 'v',
    advance: 1.03,
    strokes: [
      { start: [0, XT], segs: [{ k: 'L', to: [0.515, BASE] }, { k: 'L', to: [1.03, XT] }] },
    ],
  },
  {
    ch: 'w',
    advance: 1.49,
    strokes: [
      { start: [0, XT], segs: [
        { k: 'L', to: [0.3725, BASE] },
        { k: 'L', to: [0.745, -0.78] },
        { k: 'L', to: [1.1175, BASE] },
        { k: 'L', to: [1.49, XT] },
      ] },
    ],
  },
  {
    ch: 'x',
    advance: 1.03,
    strokes: [
      { start: [0, XT], segs: [{ k: 'L', to: [1.03, BASE] }] },
      { start: [1.03, XT], segs: [{ k: 'L', to: [0, BASE] }] },
    ],
  },
  {
    ch: 'y',
    advance: 1.03,
    strokes: [
      { start: [0, XT], segs: [{ k: 'L', to: [0.54, BASE] }] },
      // 右斜一路探到降部
      { start: [1.03, XT], segs: [{ k: 'L', to: [0.28, DESC] }] },
    ],
  },
  {
    ch: 'z',
    advance: 0.85,
    strokes: [
      { start: [0, XT], segs: [
        { k: 'L', to: [0.85, XT] },
        { k: 'L', to: [0, BASE] },
        { k: 'L', to: [0.85, BASE] },
      ] },
    ],
  },
];

/** a–z → 字形;查不到的字符由调用方决定怎么办(本包不猜) */
export const LOWERCASE: ReadonlyMap<string, Glyph> = new Map(LETTERS.map((g) => [g.ch, g]));

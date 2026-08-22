/**
 * 26 个大写拉丁字母的笔顺(print 分写体,英美小学通行写法)。小写在 letters.ts。
 *
 * 顶到 CAP(= 升部顶,四线三格的第一线),坐在基线上;只有 Q 的尾巴探出基线。
 * 笔顺遵教学通行序:先竖后横(E F H L T)、先左后右(A M N V W)、圈类逆时针(C G O Q S)。
 * 宽度参考 Excalifont 实测比例后规整化——手写体的字宽起伏属于骨架,不跟。
 *
 * 改动请重跑 `pnpm test` 与 `scripts/glyph-sheet.mjs --caps`。
 */

import type { Glyph } from './types.ts';
import { CAP, XT, BASE } from './metrics.ts';

/** 大写的中腰:H 的横、E 的中横、A 的横都落在这一带 */
const MID = XT;

const CAPITALS: Glyph[] = [
  {
    ch: 'A',
    advance: 1.5,
    strokes: [
      { start: [0.75, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0.75, CAP], segs: [{ k: 'L', to: [1.5, BASE] }] },
      // 横落在两斜边上(y = -0.72 处两边的交点)
      { start: [0.27, -0.72], segs: [{ k: 'L', to: [1.23, -0.72] }] },
    ],
  },
  {
    ch: 'B',
    advance: 1.35,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      // 上碗小、下碗大,print B 的常规比例
      { start: [0, CAP], segs: [{ k: 'A', cx: 0, cy: -1.525, rx: 1.15, ry: 0.475, a0: -90, a1: 90 }] },
      { start: [0, -1.05], segs: [{ k: 'A', cx: 0, cy: -0.525, rx: 1.35, ry: 0.525, a0: -90, a1: 90 }] },
    ],
  },
  {
    ch: 'C',
    advance: 1.4,
    strokes: [
      { start: [0.85 + 0.85 * Math.cos((-50 * Math.PI) / 180), -1 + 1 * Math.sin((-50 * Math.PI) / 180)],
        segs: [{ k: 'A', cx: 0.85, cy: -1, rx: 0.85, ry: 1, a0: -50, a1: -310 }] },
    ],
  },
  {
    ch: 'D',
    advance: 1.5,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'A', cx: 0, cy: -1, rx: 1.5, ry: 1, a0: -90, a1: 90 }] },
    ],
  },
  {
    ch: 'E',
    advance: 1.25,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'L', to: [1.25, CAP] }] },
      // 中横略短,print E 的常规处理
      { start: [0, MID], segs: [{ k: 'L', to: [1.05, MID] }] },
      { start: [0, BASE], segs: [{ k: 'L', to: [1.25, BASE] }] },
    ],
  },
  {
    ch: 'F',
    advance: 1.2,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'L', to: [1.2, CAP] }] },
      { start: [0, MID], segs: [{ k: 'L', to: [1, MID] }] },
    ],
  },
  {
    ch: 'G',
    advance: 1.45,
    strokes: [
      // C 形弧收在右下后,向上一小竖再向左一横——print G 的钩
      { start: [0.775 + 0.775 * Math.cos((-40 * Math.PI) / 180), -1 + 1 * Math.sin((-40 * Math.PI) / 180)],
        segs: [
          { k: 'A', cx: 0.775, cy: -1, rx: 0.775, ry: 1, a0: -40, a1: -330 },
          { k: 'L', to: [1.446, MID] },
          { k: 'L', to: [0.85, MID] },
        ] },
    ],
  },
  {
    ch: 'H',
    advance: 1.3,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [1.3, CAP], segs: [{ k: 'L', to: [1.3, BASE] }] },
      { start: [0, MID], segs: [{ k: 'L', to: [1.3, MID] }] },
    ],
  },
  {
    ch: 'I',
    advance: 1,
    strokes: [
      // 带上下横:和小写 l 拉开距离,教学体的常规选择
      { start: [0.5, CAP], segs: [{ k: 'L', to: [0.5, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'L', to: [1, CAP] }] },
      { start: [0, BASE], segs: [{ k: 'L', to: [1, BASE] }] },
    ],
  },
  {
    ch: 'J',
    advance: 1,
    strokes: [
      { start: [1, CAP], segs: [
        { k: 'L', to: [1, -0.5] },
        { k: 'A', cx: 0.3, cy: -0.5, rx: 0.7, ry: 0.5, a0: 0, a1: 110 },
      ] },
    ],
  },
  {
    ch: 'K',
    advance: 1.35,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      // 一笔进出,与小写 k 同一套写法
      { start: [1.35, CAP], segs: [
        { k: 'L', to: [0.05, -0.85] },
        { k: 'L', to: [1.35, BASE] },
      ] },
    ],
  },
  {
    ch: 'L',
    advance: 1.15,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, BASE], segs: [{ k: 'L', to: [1.15, BASE] }] },
    ],
  },
  {
    ch: 'M',
    advance: 1.75,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'L', to: [0.875, -0.85] }] },
      { start: [0.875, -0.85], segs: [{ k: 'L', to: [1.75, CAP] }] },
      { start: [1.75, CAP], segs: [{ k: 'L', to: [1.75, BASE] }] },
    ],
  },
  {
    ch: 'N',
    advance: 1.4,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'L', to: [1.4, BASE] }] },
      { start: [1.4, CAP], segs: [{ k: 'L', to: [1.4, BASE] }] },
    ],
  },
  {
    ch: 'O',
    advance: 1.6,
    strokes: [
      { start: [0.8, CAP], segs: [{ k: 'A', cx: 0.8, cy: -1, rx: 0.8, ry: 1, a0: -90, a1: -450 }] },
    ],
  },
  {
    ch: 'P',
    advance: 1.3,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'A', cx: 0, cy: -1.475, rx: 1.3, ry: 0.525, a0: -90, a1: 90 }] },
    ],
  },
  {
    ch: 'Q',
    advance: 1.7,
    strokes: [
      { start: [0.8, CAP], segs: [{ k: 'A', cx: 0.8, cy: -1, rx: 0.8, ry: 1, a0: -90, a1: -450 }] },
      // 唯一探出基线的大写
      { start: [1, -0.45], segs: [{ k: 'L', to: [1.7, 0.25] }] },
    ],
  },
  {
    ch: 'R',
    advance: 1.35,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
      { start: [0, CAP], segs: [{ k: 'A', cx: 0, cy: -1.475, rx: 1.15, ry: 0.525, a0: -90, a1: 90 }] },
      { start: [0.55, -0.95], segs: [{ k: 'L', to: [1.35, BASE] }] },
    ],
  },
  {
    ch: 'S',
    advance: 1.3,
    strokes: [
      // 控制点 y 由 B(0.5)=0.125·P0+0.75·v+0.125·P3 反算,让上下弧正好触到大写线与基线
      { start: [1.1, -1.62], segs: [
        { k: 'C', c1: [0.92, -2.143], c2: [0.28, -2.143], to: [0.18, -1.52] },
        { k: 'C', c1: [0.04, -0.98], c2: [1.24, -1.08], to: [1.12, -0.44] },
        { k: 'C', c1: [1.0, 0.117], c2: [0.36, 0.117], to: [0.15, -0.26] },
      ] },
    ],
  },
  {
    ch: 'T',
    advance: 1.5,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [1.5, CAP] }] },
      { start: [0.75, CAP], segs: [{ k: 'L', to: [0.75, BASE] }] },
    ],
  },
  {
    ch: 'U',
    advance: 1.4,
    strokes: [
      { start: [0, CAP], segs: [
        { k: 'L', to: [0, -0.55] },
        { k: 'A', cx: 0.7, cy: -0.55, rx: 0.7, ry: 0.55, a0: 180, a1: 0 },
        { k: 'L', to: [1.4, CAP] },
      ] },
    ],
  },
  {
    ch: 'V',
    advance: 1.45,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0.725, BASE] }, { k: 'L', to: [1.45, CAP] }] },
    ],
  },
  {
    ch: 'W',
    advance: 2,
    strokes: [
      { start: [0, CAP], segs: [
        { k: 'L', to: [0.5, BASE] },
        { k: 'L', to: [1, -1.55] },
        { k: 'L', to: [1.5, BASE] },
        { k: 'L', to: [2, CAP] },
      ] },
    ],
  },
  {
    ch: 'X',
    advance: 1.4,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [1.4, BASE] }] },
      { start: [1.4, CAP], segs: [{ k: 'L', to: [0, BASE] }] },
    ],
  },
  {
    ch: 'Y',
    advance: 1.4,
    strokes: [
      { start: [0, CAP], segs: [{ k: 'L', to: [0.7, -1] }] },
      // 右斜进到交点后直下,一笔
      { start: [1.4, CAP], segs: [{ k: 'L', to: [0.7, -1] }, { k: 'L', to: [0.7, BASE] }] },
    ],
  },
  {
    ch: 'Z',
    advance: 1.4,
    strokes: [
      { start: [0, CAP], segs: [
        { k: 'L', to: [1.4, CAP] },
        { k: 'L', to: [0, BASE] },
        { k: 'L', to: [1.4, BASE] },
      ] },
    ],
  },
];

/** A–Z → 字形 */
export const UPPERCASE: ReadonlyMap<string, Glyph> = new Map(CAPITALS.map((g) => [g.ch, g]));

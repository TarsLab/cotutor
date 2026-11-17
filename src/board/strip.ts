/**
 * 白纸条怎么排(纯函数,舞台 book.tsx 照它画,服务端照它把孩子在白纸条上画的说给老师):
 * 白纸条紧贴那道题的下沿(Strip.box 的下边),页宽,从上往下一样一样摆:图形(点阵、方向盘,src/chalk/kit/ 的画法)、写的一行字,居中。
 * 大小是档(大 / 中 / 小),位置由应用排,老师不写坐标。白纸条至少 STRIP_MIN_H 高(页宽时差不多盖到窗底),东西多就更长。
 * 坐标都是页的场景坐标(一页宽 1000),所以白纸条跟着页一起滚,孩子的笔画和页上的字在同一套坐标里。
 */
import { elementBounds, kitOf, kitParams, type KitScene } from '../chalk/index.ts';
import type { Box, Size, Strip, StripItem } from '../schema/index.ts';

/** 页宽(同 src/chalk/kit/book.ts 的 BOOK_W) */
const W = 1000;
/** 白纸条和题之间、一样和一样之间空多少 */
const GAP = 24;
/** 白纸条至少多高:页宽铺满时横屏 iPad 一屏大约 700 */
export const STRIP_MIN_H = 760;
/** 图形多宽(页宽的几分之几)、最高多高 */
const SHAPE_W: Record<Size, number> = { 大: 760, 中: 540, 小: 340 };
const SHAPE_MAX_H: Record<Size, number> = { 大: 640, 中: 460, 小: 300 };
/** 写的字多大 */
const FONT: Record<Size, number> = { 大: 96, 中: 68, 小: 46 };
/** 手写体里一段字大约多宽(字号的倍数):汉字一个字宽,数字、字母、符号窄一些(同 white.ts) */
const widthOf = (s: string): number => Array.from(s).reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? 0.62 : 1), 0);

/** 一个图形的画面与外框(场景坐标) */
export function shapeScene(item: Extract<StripItem, { kind: 'shape' }>): { scene: KitScene; frame: Box } | null {
  const kit = kitOf(item.kit);
  if (!kit) return null;
  const scene = kit.build(kitParams(kit, item.params));
  if (scene.frame) { const [x, y, w, h] = scene.frame; return { scene, frame: [x, y, x + w, y + h] }; }
  const bs = scene.skeletons.map(elementBounds);
  if (!bs.length) return null;
  return { scene, frame: [Math.min(...bs.map((b) => b.minX)), Math.min(...bs.map((b) => b.minY)), Math.max(...bs.map((b) => b.maxX)), Math.max(...bs.map((b) => b.maxY))] };
}

/** 白纸条里的一样排在哪:box 是它在页上的框;图形另有 scale(画面坐标 × scale + 平移 = 页上)、原点 */
export interface StripSlot {
  item: StripItem;
  /** 第几样(孩子转方向盘的键:<白纸条>#<第几样>) */
  n: number;
  box: Box;
  /** 图形:画面坐标 (x, y) 到页上 = (ox + x × scale, oy + y × scale) */
  scale?: number;
  ox?: number;
  oy?: number;
  scene?: KitScene;
  /** 写的字:字号 */
  font?: number;
}

/** 白纸条的样子:盖住的那一块(页坐标)和每一样的位置 */
export function stripLayout(strip: Strip): { rect: Box; slots: StripSlot[] } {
  const top = strip.box[3] + GAP / 2;
  let y = top + GAP;
  const slots: StripSlot[] = [];
  strip.items.forEach((item, n) => {
    if (item.kind === 'write') {
      const font = Math.min(FONT[item.size], (W - 80) / Math.max(1, widthOf(item.text)));
      const w = widthOf(item.text) * font, h = font * 1.25;
      slots.push({ item, n, box: [(W - w) / 2, y, (W + w) / 2, y + h], font });
      y += h + GAP;
      return;
    }
    const sh = shapeScene(item);
    if (!sh) return;
    const [x1, y1, x2, y2] = sh.frame;
    const scale = Math.min(SHAPE_W[item.size] / (x2 - x1), SHAPE_MAX_H[item.size] / (y2 - y1));
    const w = (x2 - x1) * scale, h = (y2 - y1) * scale;
    const left = (W - w) / 2;
    slots.push({ item, n, box: [left, y, left + w, y + h], scale, ox: left - x1 * scale, oy: y - y1 * scale, scene: sh.scene });
    y += h + GAP;
  });
  return { rect: [0, top, W, Math.max(top + STRIP_MIN_H, y + GAP)], slots };
}

/** 页上的一笔换成某个图形画面里的坐标 */
export const toShape = (slot: StripSlot, pts: readonly [number, number][]): [number, number][] => pts.map(([x, y]) => [(x - slot.ox!) / slot.scale!, (y - slot.oy!) / slot.scale!]);

/**
 * 孩子在白纸条上做的,说给老师(每个图形一句,画法自己按几何算的大概,src/chalk/kit/ 的 read):
 * 「点阵 6 行 6 个:圈了一圈,里面大约 6 个」;笔画落在哪一样上看它的中点;方向盘转到多少度照 turns
 */
export function stripRead(strip: Strip, ink: readonly [number, number][][], turns: Readonly<Record<string, number>>): string[] {
  const { slots } = stripLayout(strip);
  const out: string[] = [];
  const mid = (st: readonly [number, number][]): [number, number] => { const xs = st.map((p) => p[0]), ys = st.map((p) => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
  for (const s of slots) {
    if (s.item.kind !== 'shape' || !s.scene) continue;
    const kit = kitOf(s.item.kit);
    if (!kit) continue;
    const mine = ink.filter((st) => { const [x, y] = mid(st); return x >= s.box[0] - 30 && x <= s.box[2] + 30 && y >= s.box[1] - 30 && y <= s.box[3] + 30; });
    const turn = turns[`${strip.key}#${s.n}`];
    if (!mine.length && turn === undefined) continue;
    const state = { marks: mine.map((st) => toShape(s, st)), ...(turn !== undefined ? { turn: Object.fromEntries(s.scene.turns.map((t) => [t.id, turn])), moves: 1 } : {}) };
    out.push(`白纸条上的${s.item.kit}:${kit.read(kitParams(kit, s.item.params), state, s.scene)}`);
  }
  const words = ink.filter((st) => { const [x, y] = mid(st); return !slots.some((s) => s.item.kind === 'shape' && x >= s.box[0] - 30 && x <= s.box[2] + 30 && y >= s.box[1] - 30 && y <= s.box[3] + 30); }).length;
  if (words) out.push(`白纸条上还写画了 ${words} 笔(写了什么看图)`);
  return out;
}

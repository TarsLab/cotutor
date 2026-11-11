/**
 * 方向盘:一个圆盘,东南西北四个字在盘上;中间站一个小人(面朝屏幕上方),盘外写着前面、后面、左面、右面。
 * 盘能转,一次一格(90°),字跟着走、自己不歪——课本上的方向牌就是这样:位置换了,字还是正的。
 * 为什么要它:孩子背的是「上北下南左西右东」,题目问的是「面向东,后面是什么」;把东转到小人前面,其余三个就在眼前。
 */

import type { ChalkSkeleton } from '../types.ts';
import type { Kit, KitScene, KitState } from './types.ts';
import { markPhrases, turnOf, turnWords } from './marks.ts';

/** 顺时针一圈:上、右、下、左各是谁(盘没转、上面是北时) */
const DIRS = ['北', '东', '南', '西'] as const;
const DIR_IDS = ['dir-n', 'dir-e', 'dir-s', 'dir-w'] as const;
/** 小人在:前、右、后、左;不在:上、右、下、左 */
const SIDES_ME = ['前面', '右面', '后面', '左面'] as const;
const SIDES_PAPER = ['上面', '右面', '下面', '左面'] as const;

const C = 320;
const DISC_R = 190;
const DIR_R = 128;
const SIDE_R = 236;
/** 老师的笔:盘和四个方向是主笔迹的墨色;不动的那一圈(小人、前后左右)淡一档的灰。蓝是孩子的笔(pointer.ts 的 KID_INK),这里不用 */
const INK = '#1e1e1e';
const ME = '#868e96';
const DIR_FONT = 46;
const SIDE_FONT = 28;
/** 手写字体里汉字的宽高(text-metrics.ts:CJK_EM = 1,LINE_HEIGHT = 1.25) */
const LINE = 1.25;

/** 第 k 格(0 上、1 右、2 下、3 左)离中心 r 远的那个点 */
const at = (k: number, r: number): [number, number] => [C + [0, r, 0, -r][k], C + [-r, 0, r, 0][k]];

/** 一段字,中心落在 (cx, cy) */
const text = (id: string, label: string, s: string, cx: number, cy: number, fontSize: number, strokeColor: string, animateDuration: number): ChalkSkeleton => {
  const w = [...s].length * fontSize;
  const h = fontSize * LINE;
  return { type: 'text', id, label, text: s, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h, fontSize, strokeColor, animateDuration };
};

const line = (id: string, a: [number, number], b: [number, number], strokeColor: string, animateDuration: number, label?: string): ChalkSkeleton => ({
  type: 'line', id, x: a[0], y: a[1], points: [[0, 0], [b[0] - a[0], b[1] - a[1]]], strokeColor, strokeWidth: 2, animateDuration, ...(label ? { label } : {}),
});

const quarter = (state: KitState): number => ((Math.round((state.turn?.disc ?? 0) / 90) % 4) + 4) % 4;
const topOf = (p: Readonly<Record<string, string>>): number => Math.max(0, DIRS.indexOf(p['上'] as (typeof DIRS)[number]));

/** 这一刻第 k 格上是哪个方向:盘顺时针转了 q 格,原来在 k − q 格的字到了 k 格 */
const dirAt = (p: Readonly<Record<string, string>>, state: KitState, k: number): string => DIRS[(((topOf(p) + k - quarter(state)) % 4) + 4) % 4];

export const compass: Kit = {
  name: '方向盘',
  about: '东南西北四个字在一个能转的圆盘上,中间站一个小人,盘外是前面、后面、左面、右面。孩子转一转盘,就看到面向哪边时四周各是什么方向。',
  ops: ['转', '圈'],
  params: [
    { key: '上', values: DIRS, note: '一开始盘上哪个方向朝上。缺省北,就是孩子背的「上北下南左西右东」。' },
    { key: '小人', values: ['有', '没有'], note: '中间画不画小人和前后左右。讲「面向哪边」要有;只讲方向牌怎么排,写没有。' },
  ],
  build(p): KitScene {
    const me = p['小人'] !== '没有';
    const top = topOf(p);
    const person: ChalkSkeleton[] = me
      ? [
          { type: 'ellipse', id: 'me-head', label: '小人', x: C - 15, y: C - 52, width: 30, height: 30, strokeColor: ME, strokeWidth: 2, animateDuration: 250 },
          line('me-body', [C, C - 22], [C, C + 20], ME, 150, '小人'),
          line('me-arms', [C - 24, C - 8], [C + 24, C - 8], ME, 150, '小人'),
          line('me-leg-l', [C, C + 20], [C - 16, C + 50], ME, 120, '小人'),
          line('me-leg-r', [C, C + 20], [C + 16, C + 50], ME, 120, '小人'),
          ...SIDES_ME.map((s, k) => text(`side-${k}`, s, s, ...at(k, SIDE_R), SIDE_FONT, ME, 220)),
        ]
      : [];
    const disc: ChalkSkeleton[] = [
      { type: 'ellipse', id: 'disc', x: C - DISC_R, y: C - DISC_R, width: DISC_R * 2, height: DISC_R * 2, strokeColor: INK, strokeWidth: 2, animateDuration: 800 },
      ...[0, 1, 2, 3].map((k) => line(`tick-${k}`, at(k, DISC_R), at(k, DISC_R - 18), INK, 100)),
      // 字按格子摆:第 k 格上是从「上」起顺时针数的第 k 个方向
      ...[0, 1, 2, 3].map((k) => { const d = (top + k) % 4; return text(DIR_IDS[d], DIRS[d], DIRS[d], ...at(k, DIR_R), DIR_FONT, INK, 350); }),
    ];
    return {
      skeletons: [...person, ...disc],
      groups: [],
      turns: [{ id: 'disc', label: '方向盘', elementIds: disc.map((e) => e.id), pivot: [C, C], step: 90, upright: [...DIR_IDS] }],
    };
  },
  read(p, state, scene) {
    const sides = p['小人'] !== '没有' ? SIDES_ME : SIDES_PAPER;
    const now = sides.map((s, k) => `${s}是${dirAt(p, state, k)}`).join('、');
    const where = (id: string): string | null => {
      const d = DIR_IDS.indexOf(id as (typeof DIR_IDS)[number]);
      if (d < 0) return null;
      for (let k = 0; k < 4; k++) if (dirAt(p, state, k) === DIRS[d]) return sides[k];
      return null;
    };
    const moves = typeof state.moves === 'number' && state.moves > 0 ? Math.round(state.moves) : 0;
    const t = scene.turns[0];
    const turned = moves > 0 || turnOf(t, state) !== 0;
    const parts = [turned ? `把${t.label}${turnWords(turnOf(t, state))}${moves ? `(按了 ${moves} 次)` : ''};现在${now}` : `没转(${now})`];
    const marks = markPhrases(scene, state, where);
    parts.push(...(marks.length ? marks : ['没有圈']));
    return parts.join(';');
  },
};

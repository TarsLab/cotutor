/**
 * 照片:孩子拍来的作业做底,裁出要讲的那一块,老师在上面圈一圈、标上方位、画个箭头;孩子接着在上面圈、画。
 * 题目本身带图(平面图、路线图、统计图)时用它:图就是孩子本子上那一幅,不另画。
 * 位置都写整张照片的千分比(左上角 0, 0,右下角 1000, 1000):老师看着照片给,孩子画的也换成这个数说回去——
 * 老师下一张要把记号画在孩子圈的地方,照抄那几个数就行,不用猜。
 * 2026-11-12 拿 ray 11-10 的「安全疏散示意图」试过:qwen3.8-max 框平面图、框「心理辅导室」,5 遍相差不到 5 个千分点,画回去都准。
 * 场景坐标:x 就是千分比,y 是千分比 × 照片的高宽比(这样圆是圆的);高宽比由舞台量了写进状态(KitState.aspect)。
 */

import type { ChalkSkeleton } from '../types.ts';
import type { Kit, KitEnv, KitScene } from './types.ts';

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
/** 老师的记号:强调红;字垫一小块纸色,压在照片上也读得出 */
const RED = '#e03131';
const PAPER = '#fffdf8';
const DIRS = ['北', '东', '南', '西'] as const;
const SIDES = ['上', '右', '下', '左'] as const;
const RING_MAX = 4;
const ARROW_MAX = 3;
/** 没量过高宽比时(服务端排画面只为读笔画)取的数:横着拍的 4:3 */
const ASPECT = 0.75;

const nums = (v: string): number[] => (v.match(/\d+(?:\.\d+)?/g) ?? []).map((x) => Math.round(Number(x)));
const inRange = (n: number): boolean => n >= 0 && n <= 1000;

function readPath(v: string): string {
  const s = v.trim();
  if (/^https?:\/\//.test(s) || s.startsWith('/') || s.includes('..') || !IMAGE.test(s)) throw new Error('照片的「图」照 photos: 里的路径原样写,如 captures/2026-11-10/2159-1.jpg');
  return s;
}

/** 「243, 601, 927, 971」→「243 601 927 971」;左上在前、右下在后 */
function readBox(name: string, v: string): string {
  const n = nums(v);
  if (n.length !== 4 || !n.every(inRange) || n[2] - n[0] < 10 || n[3] - n[1] < 10) throw new Error(`照片的「${name}」写四个数:左、上、右、下,整张照片的千分比(0 到 1000),如 243, 601, 927, 971`);
  return n.join(' ');
}

/** 几组数,用分号隔开;每组 size 个 */
const readGroups = (name: string, size: number, max: number, how: string) => (v: string): string => {
  const parts = v.split(/[;;]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > max) throw new Error(`照片的「${name}」最多 ${max} 处,用分号隔开`);
  return parts.map((part) => {
    if (size === 4 && name === '圈') return readBox(name, part);
    const n = nums(part);
    if (n.length !== size || !n.every(inRange)) throw new Error(`照片的「${name}」${how}`);
    return n.join(' ');
  }).join(';');
};

const groups = (v: string | undefined): number[][] => (v ?? '').split(';').map((x) => x.split(' ').filter(Boolean).map(Number)).filter((g) => g.length > 0);

interface Layout { a: number; frame: [number, number, number, number]; u: number }

/** 画框(场景坐标)与记号的尺寸:裁得越小,记号跟着小,铺到屏幕上是一样大 */
function layout(p: Readonly<Record<string, string>>, env?: KitEnv): Layout {
  const a = env?.aspect && env.aspect > 0 ? env.aspect : ASPECT;
  const b = groups(p['框'])[0];
  let [x1, y1, x2, y2] = b && b.length === 4 ? b : [0, 0, 1000, 1000];
  if (b) {
    // 老师给的框多留一圈边:框偏一点,要讲的东西也还在里面
    const mx = (x2 - x1) * 0.04, my = (y2 - y1) * 0.04;
    x1 = Math.max(0, x1 - mx); y1 = Math.max(0, y1 - my); x2 = Math.min(1000, x2 + mx); y2 = Math.min(1000, y2 + my);
  }
  const frame: [number, number, number, number] = [x1, y1 * a, x2 - x1, (y2 - y1) * a];
  return { a, frame, u: Math.max(frame[2], frame[3]) / 640 };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

export const photo: Kit = {
  name: '照片',
  about: '孩子拍来的作业做底,裁出要讲的那一块。你在上面圈一圈、标方位、画箭头,孩子接着在上面圈、画。题目本身带图时用它。',
  ops: ['圈', '画'],
  params: [
    { key: '图', note: '哪张照片。照 photos: 里的路径原样写;第一行直接写路径也行。', read: readPath, required: true },
    { key: '框', note: '只给孩子看照片的哪一块:左、上、右、下四个数,整张照片的千分比(左上角 0, 0,右下角 1000, 1000)。不写就是整张。', read: (v) => readBox('框', v), fallback: '' },
    { key: '圈', note: '你圈住的地方:左、上、右、下四个数,同样是千分比。几处用分号隔开,最多 4 处。', read: readGroups('圈', 4, RING_MAX, ''), fallback: '' },
    { key: '方位', note: '在这个点画一个东南西北的十字:横、竖两个数,千分比。', read: readGroups('方位', 2, 1, '写两个数:横、竖,整张照片的千分比,如 644, 708'), fallback: '' },
    { key: '北', values: SIDES, note: '照片上哪一边是北。缺省上。看图上的指北箭头定。' },
    { key: '箭头', note: '从一处指到另一处:起点的横、竖,终点的横、竖,四个数。几支用分号隔开,最多 3 支。', read: readGroups('箭头', 4, ARROW_MAX, '写四个数:起点的横、竖,终点的横、竖,如 644, 708 到 780, 708'), fallback: '' },
  ],
  shorthand(line) {
    const s = line.trim();
    return IMAGE.test(s) && !/[::]\s/.test(s) && !/\s/.test(s) ? { 图: s } : null;
  },
  build(p, env): KitScene {
    const { a, frame, u } = layout(p, env);
    const sk: ChalkSkeleton[] = [];
    const w = Math.max(1.5, 2.5 * u);
    for (const [x1, y1, x2, y2] of groups(p['圈'])) {
      const pad = 10 * u;
      sk.push({ type: 'ellipse', id: `ring-${x1}-${y1}-${x2}-${y2}`, label: '老师圈的', x: r1(x1 - pad), y: r1(y1 * a - pad), width: r1(x2 - x1 + pad * 2), height: r1((y2 - y1) * a + pad * 2), strokeColor: RED, strokeWidth: w, animateDuration: 700 });
    }
    for (const [x1, y1, x2, y2] of groups(p['箭头'])) {
      sk.push({ type: 'arrow', id: `arrow-${x1}-${y1}-${x2}-${y2}`, x: x1, y: r1(y1 * a), points: [[0, 0], [x2 - x1, r1((y2 - y1) * a)]], strokeColor: RED, strokeWidth: w, endArrowhead: 'arrow', animateDuration: 500 });
    }
    const rose = groups(p['方位'])[0];
    if (rose) {
      const cx = rose[0], cy = rose[1] * a;
      const north = Math.max(0, SIDES.indexOf(p['北'] as (typeof SIDES)[number]));
      const arm = 46 * u, far = arm + 17 * u, font = 19 * u, badge = 15 * u;
      const vec = (side: number, r: number): [number, number] => [[0, r, 0, -r][side], [-r, 0, r, 0][side]];
      for (let k = 0; k < 4; k++) {
        // 第 k 个方向(北东南西)画在哪一边:北在 north 那边,其余顺时针排
        const side = (north + k) % 4;
        const [ax, ay] = vec(side, arm);
        const [fx, fy] = vec(side, far);
        const id = `rose-${rose[0]}-${rose[1]}-${north}-${k}`;
        sk.push({ type: 'arrow', id: `${id}-arm`, x: r1(cx), y: r1(cy), points: [[0, 0], [r1(ax), r1(ay)]], strokeColor: RED, strokeWidth: w, endArrowhead: 'arrow', animateDuration: 220 });
        sk.push({ type: 'ellipse', id: `${id}-pad`, x: r1(cx + fx - badge), y: r1(cy + fy - badge), width: r1(badge * 2), height: r1(badge * 2), strokeColor: RED, strokeWidth: Math.max(1, u), backgroundColor: PAPER, fillStyle: 'solid', roughness: 0, animateDuration: 120 });
        sk.push({ type: 'text', id: `${id}-word`, label: DIRS[k], text: DIRS[k], x: r1(cx + fx - font / 2), y: r1(cy + fy - (font * 1.25) / 2), width: r1(font), height: r1(font * 1.25), fontSize: r1(font), strokeColor: RED, animateDuration: 180 });
      }
    }
    return { skeletons: sk, groups: [], turns: [], frame, photo: { src: p['图'] ?? '', width: 1000, height: 1000 * a } };
  },
  read(_p, state) {
    const marks = (state.marks ?? []).filter((s) => s.length);
    if (!marks.length) return '还没画';
    const a = state.aspect && state.aspect > 0 ? state.aspect : null;
    // 没量到高宽比:竖的那个数换不回千分比,只说画了什么,位置看图
    const pt = (x: number, y: number): string => (a ? `(${Math.round(x)}, ${Math.round(y / a)})` : '');
    const parts: string[] = [];
    for (const s of marks) {
      const xs = s.map((q) => q[0]), ys = s.map((q) => q[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const bw = maxX - minX, bh = maxY - minY, diag = Math.hypot(bw, bh);
      let len = 0;
      for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      const first = s[0], last = s[s.length - 1];
      const box = a ? `左上 ${pt(minX, minY)}、右下 ${pt(maxX, maxY)}` : '';
      if (diag < 14) parts.push(`点了一下${a ? `,在 ${pt(first[0], first[1])}` : ''}`);
      else if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= len * 0.3 && Math.min(bw, bh) >= Math.max(bw, bh) * 0.2) parts.push(`圈了一圈${a ? `,中间在 ${pt((minX + maxX) / 2, (minY + maxY) / 2)},${box}` : ''}`);
      else if (len <= diag * 1.3) parts.push(`画了一道线${a ? `,从 ${pt(first[0], first[1])} 到 ${pt(last[0], last[1])}` : ''}`);
      else parts.push(`画了一笔${a ? `,${box}` : ''}`);
    }
    parts.push(a ? '这些数是整张照片的千分比,和你写「圈」「方位」用的一样' : '位置看图');
    return parts.join(';');
  },
};

/**
 * 照片:孩子拍来的作业做底,裁出要讲的那一块,老师在上面圈一圈、标上方位、画个箭头;孩子接着在上面圈、画。
 * 题目本身带图(平面图、路线图、统计图)时用它:图就是孩子本子上那一幅,不另画。
 * 位置都写整张照片的千分比(左上角 0, 0,右下角 1000, 1000):老师看着照片给,孩子画的也换成这个数说回去——
 * 老师下一张要把记号画在孩子圈的地方,照抄那几个数就行,不用猜。
 * 2026-11-12 拿 ray 11-10 的「安全疏散示意图」试过:qwen3.8-max 框平面图、框「心理辅导室」,5 遍相差不到 5 个千分点,画回去都准。
 * 场景坐标:x 就是千分比,y 是千分比 × 照片的高宽比(这样圆是圆的);高宽比由舞台量了写进状态(KitState.aspect)。
 */

import type { ChalkSkeleton } from '../types.ts';
import { KIT_PICK_CHARS, type Kit, type KitEnv, type KitScene } from './types.ts';

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
/** 老师的记号:强调红;字垫一小块纸色,压在照片上也读得出 */
const RED = '#e03131';
const PAPER = '#fffdf8';
const DIRS = ['北', '东', '南', '西'] as const;
const SIDES = ['上', '右', '下', '左'] as const;
const RING_MAX = 4;
const WRITE_MAX = 6;
const WRITE_CHARS = 14;
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

/**
 * 「18 在 591, 860, 657, 948;3 在 693, 858, 752, 948」→「18|591 860 657 948;3|693 858 752 948」。
 * 不给位置 = 写在照片下面另起的一条纸上(不压着题目,不靠坐标;一道题做完把答案写给孩子看,用这种);
 * 四个数 = 写进这个框里(字照框的大小),两个数 = 写在这个点上。
 */
function readWrites(v: string): string {
  const parts = v.split(/[;;]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > WRITE_MAX) throw new Error(`照片的「写」最多 ${WRITE_MAX} 处,用分号隔开`);
  return parts.map((part) => {
    // 「字 在 数」是老师写的;「字|数」是存下来的样子(再读一遍也认)
    const m = /^(.+?)\s*(?:在|@|\|)\s*([\d\s,,.]+)$/.exec(part);
    const n = m ? nums(m[2]) : [];
    const text = (m ? m[1] : part.replace(/\|$/, '')).trim().replace(/\|/g, '');
    // 没有「在」:写在照片下面那条纸上
    if (!m && text && Array.from(text).length <= WRITE_CHARS + 6 && !/[在@]/.test(text)) return `${text}|`;
    if (!m || !text || Array.from(text).length > WRITE_CHARS || (n.length !== 2 && n.length !== 4) || !n.every(inRange) || (n.length === 4 && (n[2] <= n[0] || n[3] <= n[1]))) throw new Error('照片的「写」这样写:18 ÷ 3 = 6(写在照片下面),或 18 ÷ 3 = 6 在 600, 700(写在这个点上:横、竖,整张照片的千分比)');
    return `${text}|${n.join(' ')}`;
  }).join(';');
}

/** 手写体里一段字大约多宽(字号的倍数):汉字一个字宽,数字、符号窄一些 */
const widthOf = (s: string): number => Array.from(s).reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? 0.62 : 1), 0);

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

/** 「点字」这个操作的名字:孩子点一个字词、圈一个字词,板上弹出它的田字格 */
export const PHOTO_PICK = '点字';

/** 照片上认出的一项(src/scenes/photo-words/):字词与它的框,整张照片的千分比 [左, 上, 右, 下] */
export interface PhotoWord {
  text: string;
  box: readonly [number, number, number, number];
}

/** 照片上正文的一行(src/scenes/photo-words/):字照原样带标点,框是这一行汉字的位置(千分比) */
export interface PhotoLine {
  text: string;
  box: readonly [number, number, number, number];
}

/** 能弹田字格的:一到四个汉字 */
const HANZI = /^[\u3400-\u9fff]+$/;
export const pickable = (text: string): boolean => HANZI.test(text) && Array.from(text).length <= KIT_PICK_CHARS;

/**
 * 孩子的一笔指的是哪一项(纯函数;舞台在本地算,不等老师)。stroke 是场景坐标(横 = 千分比,竖 = 千分比 × 高宽比),aspect = 照片的高 ÷ 宽。
 * 点一下(一笔很小):落在哪一项的框里就是它,框外面一点(半个字高以内)也算最近的那一项——手指比字粗;
 * 圈一圈、划一道:这一笔的外框盖住了哪几项的中心,取离这一笔中心最近的一项。
 * 挑出来的字词都不沾,再看正文的行(lines):一行按字数等分,一格一个字(课文正文差不多等宽、标点占一格)——
 * 点一下是落在的那一格的字;圈一圈是圈住的那几格连着的汉字(最多四个,当一个词)。标点、拼音、空白都不算。都不沾 → null。
 */
export function photoPick(words: readonly PhotoWord[], stroke: readonly (readonly [number, number])[], aspect: number, lines: readonly PhotoLine[] = []): PhotoWord | null {
  // 先后:正落在一项的框里(或圈住了它)→ 正文里落在的那个字 → 框外面一点的最近一项。
  // 挑出来的字就在正文那一行里时(课后题的加点字),点它旁边的字要的是旁边那个字,不是它
  return pickWord(words, stroke, aspect, false) ?? pickInLines(lines, stroke, aspect) ?? pickWord(words, stroke, aspect, true);
}

const isHanzi = (ch: string): boolean => HANZI.test(ch);

function pickInLines(lines: readonly PhotoLine[], stroke: readonly (readonly [number, number])[], aspect: number): PhotoWord | null {
  if (!stroke.length || !(aspect > 0) || !lines.length) return null;
  const xs = stroke.map((q) => q[0]), ys = stroke.map((q) => q[1] / aspect);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const tap = Math.hypot(maxX - minX, (maxY - minY) * aspect) < 14;
  // 这一笔在哪一行:点一下要落在行里(上下各让出三成行高,手指比字粗);圈一圈取圈的中心最近的、被圈盖到的那一行
  const on = lines.filter((l) => {
    const h = l.box[3] - l.box[1];
    return tap ? cy >= l.box[1] - h * 0.3 && cy <= l.box[3] + h * 0.3 && cx >= l.box[0] && cx <= l.box[2] : (l.box[1] + l.box[3]) / 2 >= minY && (l.box[1] + l.box[3]) / 2 <= maxY && l.box[2] > minX && l.box[0] < maxX;
  });
  const line = on.reduce<PhotoLine | null>((best, l) => (!best || Math.abs((l.box[1] + l.box[3]) / 2 - cy) < Math.abs((best.box[1] + best.box[3]) / 2 - cy) ? l : best), null);
  if (!line) return null;
  const chars = Array.from(line.text);
  if (!chars.length) return null;
  const w = (line.box[2] - line.box[0]) / chars.length;
  const cell = (i: number, j: number): PhotoWord['box'] => [Math.round(line.box[0] + i * w), line.box[1], Math.round(line.box[0] + (j + 1) * w), line.box[3]];
  if (tap) {
    const i = Math.max(0, Math.min(chars.length - 1, Math.floor((cx - line.box[0]) / w)));
    return isHanzi(chars[i]) ? { text: chars[i], box: cell(i, i) } : null;
  }
  // 圈住的格:中心在圈的左右之间的;里面最长的一段连着的汉字(标点把它断开),最多四个
  let best: [number, number] | null = null;
  let from = -1;
  for (let i = 0; i <= chars.length; i++) {
    const inside = i < chars.length && isHanzi(chars[i]) && line.box[0] + (i + 0.5) * w >= minX && line.box[0] + (i + 0.5) * w <= maxX;
    if (inside && from < 0) from = i;
    if (!inside && from >= 0) { if (!best || i - from > best[1] - best[0] + 1) best = [from, i - 1]; from = -1; }
  }
  if (!best) return null;
  const to = Math.min(best[1], best[0] + KIT_PICK_CHARS - 1);
  return { text: chars.slice(best[0], to + 1).join(''), box: cell(best[0], to) };
}

/** loose = 点一下没落在任何一项的框里时,框外面半个字高以内的最近一项也算 */
function pickWord(words: readonly PhotoWord[], stroke: readonly (readonly [number, number])[], aspect: number, loose: boolean): PhotoWord | null {
  if (!stroke.length || !(aspect > 0)) return null;
  const xs = stroke.map((q) => q[0]), ys = stroke.map((q) => q[1] / aspect);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const ok = words.filter((w) => pickable(w.text));
  // 距离都按屏幕上的样子比(竖的那个数乘回高宽比),不然竖着拍的照片上下显得近
  const dist = (w: PhotoWord): number => Math.hypot((w.box[0] + w.box[2]) / 2 - cx, ((w.box[1] + w.box[3]) / 2 - cy) * aspect);
  const nearest = (list: readonly PhotoWord[]): PhotoWord | null => list.reduce<PhotoWord | null>((best, w) => (!best || dist(w) < dist(best) ? w : best), null);
  const tap = Math.hypot(maxX - minX, (maxY - minY) * aspect) < 14;
  if (tap) {
    const inside = ok.filter((w) => cx >= w.box[0] && cx <= w.box[2] && cy >= w.box[1] && cy <= w.box[3]);
    if (inside.length) return nearest(inside);
    if (!loose) return null;
    const near = ok.filter((w) => {
      const slack = ((w.box[3] - w.box[1]) * aspect) / 2;
      const dx = Math.max(w.box[0] - cx, 0, cx - w.box[2]), dy = Math.max(w.box[1] - cy, 0, cy - w.box[3]) * aspect;
      return Math.hypot(dx, dy) <= slack;
    });
    return nearest(near);
  }
  return nearest(ok.filter((w) => { const mx = (w.box[0] + w.box[2]) / 2, my = (w.box[1] + w.box[3]) / 2; return mx >= minX && mx <= maxX && my >= minY && my <= maxY; }));
}

export const photo: Kit = {
  name: '照片',
  about: '孩子拍来的作业、课本做底,裁出要讲的那一块。你在上面圈一圈、标方位、画箭头,孩子接着在上面圈、画;课本上的字词,孩子点一下就看到怎么写。',
  ops: ['圈', '画', PHOTO_PICK, '看'],
  params: [
    { key: '图', note: '哪张照片。不写就是孩子最近发的那张(板上现在垫着的);要换别的照 photos: 里的路径原样写,第一行直接写路径也行。', read: readPath, fallback: '' },
    { key: '框', note: '只给孩子看照片的哪一块:左、上、右、下四个数,整张照片的千分比(左上角 0, 0,右下角 1000, 1000)。不写就是整张。', read: (v) => readBox('框', v), fallback: '' },
    { key: '圈', note: '你圈住的地方:左、上、右、下四个数,同样是千分比。几处用分号隔开,最多 4 处。', read: readGroups('圈', 4, RING_MAX, ''), fallback: '' },
    { key: '方位', note: '在这个点画一个东南西北的十字:横、竖两个数,千分比。', read: readGroups('方位', 2, 1, '写两个数:横、竖,整张照片的千分比,如 644, 708'), fallback: '' },
    { key: '北', values: SIDES, note: '照片上哪一边是北。缺省上。看图上的指北箭头定。' },
    { key: '写', note: '你写上去的字(一道题做完,把答案写给孩子看):整条答案写成一行,写在照片下面。几行用分号隔开,最多 6 行。', read: readWrites, fallback: '' },
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
    // 没给位置的几行:照片下面另起一条纸,一行一行写在正中;画框跟着往下长
    let shown = frame;
    let below = 0;
    for (const item of (p['写'] ?? '').split(';').filter(Boolean)) {
      const [word, where] = item.split('|');
      const n = (where ?? '').split(' ').filter(Boolean).map(Number);
      if (word && !n.length) {
        const wide = widthOf(word);
        const font = Math.min(40 * u, (frame[2] * 0.9) / wide);
        const top = frame[1] + frame[3] + 14 * u + below * font * 1.6;
        sk.push({ type: 'text', id: `write-below-${below}-${word}`, label: '老师写的', text: word, x: r1(frame[0] + frame[2] / 2 - (wide * font) / 2), y: r1(top), width: r1(wide * font), height: r1(font * 1.25), fontSize: r1(font), strokeColor: RED, animateDuration: 260 * Array.from(word).length });
        below++;
        shown = [frame[0], frame[1], frame[2], r1(top + font * 1.6 - frame[1])];
        continue;
      }
      if (!word || (n.length !== 2 && n.length !== 4)) continue;
      const wide = widthOf(word);
      // 写进框里:字照框的大小(高的六成,宽放得下);写在点上:照画框的大小取个看得清的字号
      const font = n.length === 4 ? Math.max(6, Math.min((n[3] - n[1]) * a * 0.62, ((n[2] - n[0]) * 0.86) / wide)) : 20 * u;
      const cx = n.length === 4 ? (n[0] + n[2]) / 2 : n[0];
      const cy = (n.length === 4 ? (n[1] + n[3]) / 2 : n[1]) * a;
      // 写在点上的垫一块纸色的底(像贴了张条子):压在题目的字上也读得清,位置偏一点不要紧
      // 2026-11-12 真模型试纸鹤那道题:讲课时给的方框位置偏 15–25 个千分点,字压在框线上;整条算式贴在旁边不怕偏
      if (n.length === 2) sk.push({ type: 'rectangle', id: `write-pad-${word}-${n.join('-')}`, x: r1(cx - (wide * font) / 2 - font * 0.5), y: r1(cy - font * 0.95), width: r1(wide * font + font), height: r1(font * 1.9), strokeColor: RED, strokeWidth: Math.max(1, u), backgroundColor: PAPER, fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, animateDuration: 200 });
      sk.push({ type: 'text', id: `write-${word}-${n.join('-')}`, label: '老师写的', text: word, x: r1(cx - (wide * font) / 2), y: r1(cy - (font * 1.25) / 2), width: r1(wide * font), height: r1(font * 1.25), fontSize: r1(font), strokeColor: RED, animateDuration: 260 * Array.from(word).length });
    }
    // 那条纸:一块纸色的底,盖住照片在裁的那一块下面还露着的部分(照片是整张垫着的);排在字前面。
    // 往左右和下面多盖出去一大截:舞台的框和画框的宽高比差一点时,边上会多露出一条
    if (below) {
      const at = sk.findIndex((e) => e.id.startsWith('write-below-'));
      sk.splice(at, 0, { type: 'rectangle', id: 'write-strip', x: r1(frame[0] - 1500), y: r1(frame[1] + frame[3]), width: r1(frame[2] + 3000), height: r1(shown[3] - frame[3] + 1500), strokeColor: PAPER, strokeWidth: 1, backgroundColor: PAPER, fillStyle: 'solid', roughness: 0, animateDuration: 60 });
    }
    return { skeletons: sk, groups: [], turns: [], frame: shown, photo: { src: p['图'] ?? '', width: 1000, height: 1000 * a } };
  },
  read(_p, state) {
    const marks = (state.marks ?? []).filter((s) => s.length);
    const picked = (state.picked ?? []).filter(Boolean);
    // 点字:他点开看了哪几个字的笔顺(应用弹的田字格,你没出卡);这几个是他自己想看的,多半是不会写、不认识的
    const looked = picked.length ? `点开看了笔顺:${picked.map((w) => `「${w}」`).join('')}` : '';
    if (!marks.length) return looked || '还没画';
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
    if (looked) parts.unshift(looked);
    return parts.join(';');
  },
};

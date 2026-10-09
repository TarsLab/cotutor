/**
 * 圈住了什么(纯函数,浏览器外可用):孩子在课的某一刻停下,在画面上圈了一圈(场景坐标的一串点)→ 那一刻画面上已经有的东西里,哪些被圈住了。
 * 认的顺序:分组(groups,圈住大半就说组名)> 命中块(blocks,说块的字)> 带 label 的元素 > 文字(说字)> 其余按第几步、什么、颜色归堆。
 * circleHits 给数据,describeCircle 把它说成一句中文(「散的 3 根小棒;文字『3』」),给老师、家长看。
 */

import type { ChalkBlock, ChalkGroup, ChalkSkeleton } from '../player/types.ts';
import { clockAt, type LessonClock } from './clock.ts';
import { isAction } from './actions.ts';
import { boundsGap, boundsOfPoints, elementBounds, insidePolygon, pointsOf, samplePoints, unionBounds, type Bounds, type BoundsTuple } from './geometry.ts';

/** 画面的语义:分组、命中块、build 时量好的包围盒(都可缺) */
export interface LessonPicture {
  groups?: readonly ChalkGroup[];
  blocks?: readonly ChalkBlock[];
  bounds?: Readonly<Record<string, BoundsTuple>>;
}

/** 圈住的一样东西 */
export type CircleHit =
  | { kind: 'group'; id: string; label: string; ids: string[]; of: number }
  | { kind: 'block'; id: string; text: string; ids: string[] }
  | { kind: 'label'; label: string; ids: string[] }
  | { kind: 'text'; text: string; ids: string[] }
  | { kind: 'shapes'; step: number; type: string; color: string; ids: string[]; nearText?: string };

export interface CircleResult {
  /** 那一刻在第几段(0 起)、念哪句 */
  index: number;
  line: string;
  /** tiny = 圈得太小看不出;hit = 圈住了东西;near = 没圈住,旁边有东西;empty = 那一带还没画东西 */
  kind: 'tiny' | 'hit' | 'near' | 'empty';
  hits: CircleHit[];
  /** 没圈住时离圈最近的那样东西 */
  near?: CircleHit;
  /** 圈住的元素 id(全部,不论归到哪一样) */
  ids: string[];
}

/** 样点有多少在圈里算圈住了 */
const HIT_SHARE = 0.5;
/** 一组里圈住多少算圈住了这一组 */
const GROUP_SHARE = 0.5;
/** 没圈住时,离圈多近的东西算「旁边」;没字的东西「旁边写着」的字要多近(场景坐标) */
const NEAR = 80;

const flat = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim();

/** 笔画颜色 → 一个字(黑、灰、太浅的不说) */
export function colorWord(hex: unknown): string {
  const m = typeof hex === 'string' ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return '';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.3 || l < 0.15 || l > 0.92) return '';
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return h < 15 || h >= 340 ? '红' : h < 40 ? '橙' : h < 70 ? '黄' : h < 170 ? '绿' : h < 255 ? '蓝' : '紫';
}

/** 点到线段的距离 */
function segmentGap([px, py]: readonly [number, number], [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 橡皮那一笔擦完了这个元素:元素画在橡皮之前,样点大半落在橡皮的笔迹里(离橡皮的线不到半个笔宽) */
function erasedBy(eraser: ChalkSkeleton, e: ChalkSkeleton, start: number, clock: LessonClock, boundsOf: (e: ChalkSkeleton) => Bounds): boolean {
  const ew = clock.elements.get(eraser.id);
  const line = pointsOf(eraser);
  if (!ew || start >= ew.start || !line || !line.length) return false;
  const half = (typeof eraser.strokeWidth === 'number' ? eraser.strokeWidth : 1) / 2 + 1;
  const s = samplePoints(e, boundsOf(e));
  const covered = (p: [number, number]): boolean => (line.length === 1 ? Math.hypot(p[0] - line[0][0], p[1] - line[0][1]) <= half : line.slice(1).some((b, i) => segmentGap(p, line[i], b) <= half));
  return s.length > 0 && s.filter(covered).length / s.length >= HIT_SHARE;
}

export function circleHits(clock: LessonClock, ms: number, path: readonly [number, number][], picture: LessonPicture = {}): CircleResult {
  const at = clockAt(clock, ms);
  const base = { index: at.index, line: clock.segments[at.index]?.line ?? '' };
  if (path.length < 3) return { ...base, kind: 'tiny', hits: [], ids: [] };
  const boundsOf = (e: ChalkSkeleton): Bounds => {
    const t = picture.bounds?.[e.id];
    return t ? { minX: t[0], minY: t[1], maxX: t[2], maxY: t[3] } : elementBounds(e);
  };
  // 那一刻画面上已经有的(开始画了就算;动作与橡皮笔画不算东西;擦掉了的不算:擦除动作擦完的、换画板换走的,橡皮笔画盖住大半的)
  const erasers = clock.skeletons.filter((e) => e.customData?.tool === 'eraser' && (clock.elements.get(e.id)?.end ?? Infinity) <= at.svgMs);
  const shown = clock.skeletons.filter((e) => {
    const w = clock.elements.get(e.id);
    if (w === undefined || w.start >= at.svgMs || isAction(e) || e.customData?.tool === 'eraser') return false;
    if (w.erased && w.erased.end <= at.svgMs) return false;
    return !erasers.some((x) => erasedBy(x, e, w.start, clock, boundsOf));
  });
  const shownIds = new Set(shown.map((e) => e.id));
  const ring = boundsOfPoints(path);
  const hit = shown.filter((e) => {
    const b = boundsOf(e);
    const s = samplePoints(e, b);
    if (s.length && s.filter((p) => insidePolygon(path, p)).length / s.length >= HIT_SHARE) return true;
    // 长的一行字里圈了几个字:圈整个落在这行字里
    return e.type === 'text' && ring.minX >= b.minX - 8 && ring.maxX <= b.maxX + 8 && ring.minY >= b.minY - 8 && ring.maxY <= b.maxY + 8;
  });
  const stepOf = (e: ChalkSkeleton): number => clock.elements.get(e.id)?.step ?? -1;
  const describeOne = (e: ChalkSkeleton): CircleHit => {
    const g = (picture.groups ?? []).find((x) => x.elementIds.includes(e.id));
    if (typeof e.label === 'string' && e.label) return { kind: 'label', label: e.label, ids: [e.id] };
    if (g) return { kind: 'group', id: g.id, label: g.label, ids: [e.id], of: g.elementIds.length };
    if (e.type === 'text') return { kind: 'text', text: flat(String(e.text ?? '')), ids: [e.id] };
    return { kind: 'shapes', step: stepOf(e), type: String(e.type), color: colorWord(e.strokeColor), ids: [e.id] };
  };

  if (!hit.length) {
    const center: Bounds = { minX: (ring.minX + ring.maxX) / 2, maxX: (ring.minX + ring.maxX) / 2, minY: (ring.minY + ring.maxY) / 2, maxY: (ring.minY + ring.maxY) / 2 };
    const near = shown
      .map((e) => ({ e, d: boundsGap(boundsOf(e), ring), c: boundsGap(boundsOf(e), center) }))
      .filter((x) => x.d <= NEAR)
      .sort((a, b) => a.d - b.d || a.c - b.c)[0];
    return near ? { ...base, kind: 'near', hits: [], near: describeOne(near.e), ids: [] } : { ...base, kind: 'empty', hits: [], ids: [] };
  }

  const hits: CircleHit[] = [];
  const taken = new Set<string>();
  // 1. 分组:这一组画面上已经有的成员,圈住了大半 → 说组名;圈得更满的组先认,一样满先认小的(「13 根小棒」不吞掉圈满了的「散的 3 根」)
  const hitIds = new Set(hit.map((e) => e.id));
  const groups = (picture.groups ?? [])
    .map((g) => {
      const members = g.elementIds.filter((id) => shownIds.has(id));
      const got = members.filter((id) => hitIds.has(id));
      return { g, members, got, share: members.length ? got.length / members.length : 0 };
    })
    .filter((x) => x.got.length && x.share >= GROUP_SHARE)
    .sort((a, b) => b.share - a.share || a.members.length - b.members.length);
  for (const x of groups) {
    const fresh = x.got.filter((id) => !taken.has(id));
    if (!fresh.length) continue;
    fresh.forEach((id) => taken.add(id));
    hits.push({ kind: 'group', id: x.g.id, label: x.g.label, ids: x.got, of: x.members.length });
  }
  // 2. 命中块:圈住了块里的字就说整个块
  for (const b of picture.blocks ?? []) {
    const got = b.elementIds.filter((id) => hitIds.has(id) && !taken.has(id));
    if (!got.length) continue;
    got.forEach((id) => taken.add(id));
    hits.push({ kind: 'block', id: b.id, text: b.text, ids: got });
  }
  const rest = hit.filter((e) => !taken.has(e.id));
  // 3. 带 label 的元素(同一个 label 归一样)、文字
  const labels = new Map<string, string[]>();
  for (const e of rest) if (typeof e.label === 'string' && e.label) labels.set(e.label, [...(labels.get(e.label) ?? []), e.id]);
  for (const [label, ids] of labels) { ids.forEach((id) => taken.add(id)); hits.push({ kind: 'label', label, ids }); }
  for (const e of rest) if (!taken.has(e.id) && e.type === 'text') { taken.add(e.id); hits.push({ kind: 'text', text: flat(String(e.text ?? '')), ids: [e.id] }); }
  // 4. 没字的:按(第几步、什么、颜色)归堆,附上离这一堆最近、没被圈住的字
  const piles = new Map<string, ChalkSkeleton[]>();
  for (const e of rest) {
    if (taken.has(e.id)) continue;
    const k = `${stepOf(e)}|${String(e.type)}|${colorWord(e.strokeColor)}`;
    piles.set(k, [...(piles.get(k) ?? []), e]);
  }
  const texts = shown.filter((e) => e.type === 'text' && !hitIds.has(e.id));
  for (const [k, els] of piles) {
    const [step, type, color] = k.split('|');
    const gb = unionBounds(els.map(boundsOf))!;
    const label = texts.map((t) => ({ t, d: boundsGap(boundsOf(t), gb) })).filter((x) => x.d <= NEAR / 2).sort((a, b) => a.d - b.d)[0];
    hits.push({ kind: 'shapes', step: Number(step), type, color, ids: els.map((e) => e.id), ...(label ? { nearText: flat(String(label.t.text ?? '')) } : {}) });
  }
  return { ...base, kind: 'hit', hits, ids: hit.map((e) => e.id) };
}

const SHAPE_WORD: Record<string, [string, string]> = { line: ['条', '线'], arrow: ['个', '箭头'], rectangle: ['个', '框'], ellipse: ['个', '圈'], diamond: ['个', '菱形'], freedraw: ['处', '笔画'], image: ['张', '图'] };

/** 一样东西说成几个字 */
export function hitPhrase(h: CircleHit): string {
  switch (h.kind) {
    case 'group':
      return h.ids.length < h.of ? `${h.label}(圈住了其中 ${h.ids.length} 个)` : h.label;
    case 'block':
      return `『${h.text}』`;
    case 'label':
      return h.label;
    case 'text':
      return `文字『${h.text}』`;
    case 'shapes': {
      const [m, noun] = SHAPE_WORD[h.type] ?? ['样', '东西'];
      const n = h.ids.length;
      const step = h.step >= 0 ? `第 ${h.step + 1} 步画的` : '';
      return `${step}${n > 1 ? ` ${n} ${m}` : ''}${h.color ? `${h.color}色的` : ''}${noun}${h.nearText ? `(旁边写着『${h.nearText}』)` : ''}`.trim();
    }
  }
}

/**
 * 圈住了什么,说成一句:「散的 3 根小棒;文字『3』」/「没圈住东西,圈在文字『3』旁边」/「圈的地方那时还没画东西」/「圈得太小,看不出圈的是什么」。
 * 不带时刻与讲稿(应用自己拼:「0:26 圈的,那时在讲『…』;」)。
 */
export function describeCircle(r: CircleResult): string {
  switch (r.kind) {
    case 'tiny':
      return '圈得太小,看不出圈的是什么';
    case 'empty':
      return '圈的地方那时还没画东西';
    case 'near':
      return `没圈住东西,圈在${hitPhrase(r.near!)}旁边`;
    case 'hit':
      return `圈住了:${r.hits.map(hitPhrase).join(';')}`;
  }
}

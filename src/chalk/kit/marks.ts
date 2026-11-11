/**
 * 教具上孩子做的事怎么读(纯函数):这一组转到多少度、转过以后每样东西在哪、一笔指着什么(圈住了 / 画在上面 / 点了 / 旁边 / 空白)。
 * 各教具的 read 用它们拼自己的那一句;入口在 ./index.ts。
 */

import { lessonClock } from '../clock.ts';
import { circleHits, hitPhrase } from '../circle.ts';
import { boundsOfPoints, elementBounds, type Bounds } from '../geometry.ts';
import type { ChalkSkeleton } from '../types.ts';
import { KIT_MARK_MAX, type KitScene, type KitState, type KitTurn } from './types.ts';

/** 这一组现在转到多少度(0–359,落在格上) */
export function turnOf(t: KitTurn, state: KitState): number {
  const raw = state.turn?.[t.id];
  const deg = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw / t.step) * t.step : 0;
  return ((deg % 360) + 360) % 360;
}

/** 绕 pivot 顺时针转 deg 度(屏幕坐标,y 朝下;同 SVG 的 rotate) */
export function turnPoint([x, y]: readonly [number, number], [cx, cy]: readonly [number, number], deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx, dy = y - cy;
  const r = (n: number): number => Math.round(n * 100) / 100;
  return [r(cx + dx * Math.cos(a) - dy * Math.sin(a)), r(cy + dx * Math.sin(a) + dy * Math.cos(a))];
}

/**
 * 转过以后的画面(给「圈住了什么」用):每个能转的组里的元素挪到现在的位置。
 * 保持正着的(字)只挪中心;有点的(线)逐点转;框、圆转中心,转了奇数个直角就宽高对调(只有直角的倍数是准的,别的角度按中心近似)。
 */
export function turnedSkeletons(scene: KitScene, state: KitState): ChalkSkeleton[] {
  const moved = new Map<string, ChalkSkeleton>();
  for (const t of scene.turns) {
    const deg = turnOf(t, state);
    if (!deg) continue;
    for (const e of scene.skeletons) {
      if (!t.elementIds.includes(e.id)) continue;
      const b = elementBounds(e);
      const w = b.maxX - b.minX, h = b.maxY - b.minY;
      const [nx, ny] = turnPoint([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], t.pivot, deg);
      if (t.upright.includes(e.id)) { moved.set(e.id, { ...e, x: nx - w / 2, y: ny - h / 2 }); continue; }
      if (Array.isArray(e.points)) {
        const pts = (e.points as [number, number][]).map((p) => turnPoint([(e.x ?? 0) + p[0], (e.y ?? 0) + p[1]], t.pivot, deg));
        moved.set(e.id, { ...e, x: pts[0][0], y: pts[0][1], points: pts.map((p) => [p[0] - pts[0][0], p[1] - pts[0][1]]) });
        continue;
      }
      const swap = Math.round(deg / 90) % 2 === 1;
      const [nw, nh] = swap ? [h, w] : [w, h];
      moved.set(e.id, { ...e, x: nx - nw / 2, y: ny - nh / 2, width: nw, height: nh });
    }
  }
  return scene.skeletons.map((e) => moved.get(e.id) ?? e);
}

/** 孩子画的一笔指着什么:圈住了几样 / 画在一样东西上 / 点了一样 / 画在一样旁边 / 空白处 */
export type KitMark =
  | { kind: 'circle'; items: { id: string; label: string }[] }
  | { kind: 'on' | 'tap' | 'near'; id: string; label: string }
  | { kind: 'empty' };

/** 一笔小到这个数以内算「点了一下」(场景坐标) */
const TAP = 14;
/** 点、画在离一样东西多近算「旁边」 */
const NEAR = 60;

const pad = (b: Bounds, n: number): Bounds => ({ minX: b.minX - n, minY: b.minY - n, maxX: b.maxX + n, maxY: b.maxY + n });
const inside = (b: Bounds, [x, y]: readonly [number, number]): boolean => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
const gap = (b: Bounds, [x, y]: readonly [number, number]): number => Math.hypot(Math.max(0, b.minX - x, x - b.maxX), Math.max(0, b.minY - y, y - b.maxY));

/**
 * 每一笔指着什么(对着转过以后的画面)。只认带 label 的东西(盘的边、刻度不是孩子要指的)。
 * 圈:样点大半落在圈里(circle.ts 的规矩);没圈住的:笔迹落在一样东西上算「画在它上面」,最近的一样在 NEAR 以内算「旁边」。
 */
export function kitMarks(scene: KitScene, state: KitState): KitMark[] {
  const named = turnedSkeletons(scene, state).filter((e) => typeof e.label === 'string' && e.label);
  if (!named.length) return [];
  const clock = lessonClock(named, [{ step: 1, elementIds: named.map((e) => e.id), line: '', pauseAfter: false }]);
  const boxes = named.map((e) => ({ e, b: elementBounds(e) }));
  const labelOf = (id: string): string => String(named.find((e) => e.id === id)?.label ?? '');
  const nearest = (p: readonly [number, number]): { id: string; d: number } | null => {
    const best = boxes.map((x) => ({ id: x.e.id, d: gap(x.b, p) })).sort((a, b) => a.d - b.d)[0];
    return best ? best : null;
  };
  const out: KitMark[] = [];
  for (const stroke of (state.marks ?? []).slice(0, KIT_MARK_MAX)) {
    if (!stroke.length) continue;
    const ring = boundsOfPoints(stroke);
    const center: [number, number] = [(ring.minX + ring.maxX) / 2, (ring.minY + ring.maxY) / 2];
    if (Math.max(ring.maxX - ring.minX, ring.maxY - ring.minY) < TAP) {
      const hit = boxes.find((x) => inside(pad(x.b, 10), center));
      const n = hit ? null : nearest(center);
      out.push(hit ? { kind: 'tap', id: hit.e.id, label: labelOf(hit.e.id) } : n && n.d <= NEAR ? { kind: 'near', id: n.id, label: labelOf(n.id) } : { kind: 'empty' });
      continue;
    }
    // 一条直线只有两个点:补一个中点,照样走「圈住了什么」(圈不住东西,落到下面的「画在上面 / 旁边」)
    const path = stroke.length >= 3 ? stroke : [stroke[0], center, stroke[stroke.length - 1]];
    const r = circleHits(clock, clock.total, path);
    if (r.kind === 'hit') {
      // 带 label 的东西按名字归成一样(小人的头、身子、腿是一样「小人」);位置看其中第一个
      out.push({ kind: 'circle', items: r.hits.map((h) => ({ id: h.ids[0], label: hitPhrase(h) })) });
      continue;
    }
    const on = boxes.map((x) => ({ id: x.e.id, n: stroke.filter((p) => inside(x.b, p)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
    if (on) { out.push({ kind: 'on', id: on.id, label: labelOf(on.id) }); continue; }
    const n = nearest(center);
    out.push(n && n.d <= NEAR ? { kind: 'near', id: n.id, label: labelOf(n.id) } : { kind: 'empty' });
  }
  return out;
}

/** 转了多少说成几个字:顺时针 90° / 半圈 / 逆时针 90°(转回原处 = 一圈) */
export function turnWords(deg: number): string {
  if (deg === 0) return '转了一圈回到原处';
  if (deg === 180) return '转了半圈';
  return deg < 180 ? `顺时针转了 ${deg}°` : `逆时针转了 ${360 - deg}°`;
}


/**
 * 每一笔说成几个字(同一句只说一遍):「圈住了:西(在后面)」「点了:东」「画在「西」上」「画在「西」旁边,没圈住」「有一笔画在空白处」。
 * where 给出这样东西这一刻在哪(「后面」),说不出回 null。
 */
export function markPhrases(scene: KitScene, state: KitState, where: (id: string) => string | null = () => null): string[] {
  const at = (id: string): string => { const w = where(id); return w ? `(在${w})` : ''; };
  const out: string[] = [];
  for (const m of kitMarks(scene, state)) {
    const s = m.kind === 'circle' ? `圈住了:${m.items.map((x) => x.label + at(x.id)).join('、')}`
      : m.kind === 'tap' ? `点了:${m.label}${at(m.id)}`
        : m.kind === 'on' ? `画在「${m.label}」上${at(m.id)}`
          : m.kind === 'near' ? `画在「${m.label}」旁边,没圈住`
            : '有一笔画在空白处';
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

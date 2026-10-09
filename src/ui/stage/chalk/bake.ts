/**
 * 在浏览器里把一幅场景烤成 bake.json 的画面部分(《重新设计.md》第 4 步;格式与渲染在 core/bake.ts)。
 * excalidraw 只在这里跑一次:静态导出(和播放器原来用的同一个 exportToSvg,画面一模一样),
 * 挂进文档量每条路径的长度、笔尖要走的轨迹;字体是导出时内嵌的那份。drawtell bake 用 playwright 打开播放页的 ?bake= 来调它。
 */

import type { BakedBoard, BakedElement, BakedNode, BakedPicture } from '../core/bake.ts';
import { isAction, resolveActions } from '../core/actions.ts';
import { BAKE_VERSION, bakedPaths, strokeGroups } from '../core/bake.ts';
import { exportStaticSvg } from './excalidraw-io.ts';
import type { ChalkBackground, ChalkSkeleton } from './types.ts';

/** 轨迹上每隔多远取一个点(SVG 坐标),一条路径最多几个 */
const TRACK_STEP = 6;
const TRACK_MAX_PER_PATH = 80;

const isNone = (v: string | null | undefined): boolean => !v || v === 'none' || v === 'transparent';
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** 序列化时顺手记下:每条有描边的 path 在根坐标里的样点(笔尖轨迹用) */
type Samples = Map<BakedNode, [number, number][]>;

function sampleAlong(svg: SVGSVGElement, path: SVGPathElement, len: number): [number, number][] {
  const map = toRoot(svg, path);
  const k = Math.max(1, Math.min(TRACK_MAX_PER_PATH, Math.ceil(len / TRACK_STEP)));
  const out: [number, number][] = [];
  for (let q = 0; q <= k; q++) {
    const pt = path.getPointAtLength((len * q) / k);
    out.push(map(pt.x, pt.y));
  }
  return out;
}

/**
 * 一个 SVG 节点 → BakedNode。手绘(rough.js)的描边一条 path 里是好几段 M,每一笔描两遍(两段挨着、走同一条边):
 * 拆成一段一条 path,同一笔的两遍记同一个 pass——播放时两遍一起画,笔不会画完一遍又跳回起点再画一遍(同 excalidraw-animate:
 * 虚线一段一拨,其余两段一拨;段数是单数就一段一拨)。实心填充(没描边)不拆,最后淡入。
 */
function serialize(svg: SVGSVGElement, el: Element, keepText: boolean, samples: Samples, pass: { n: number }, stroke?: string | null): BakedNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  const myStroke = el.getAttribute('stroke') ?? stroke;
  if (el.tagName === 'path') {
    const p = el as SVGPathElement;
    const d = el.getAttribute('d') ?? '';
    const subs = d.split(/(?=M)/).map((x) => x.trim()).filter(Boolean);
    if (isNone(myStroke) || subs.length < 2) {
      const node: BakedNode = { tag: 'path', attrs, len: r2(p.getTotalLength()) };
      if (!isNone(myStroke) && node.len) samples.set(node, sampleAlong(svg, p, node.len));
      return node;
    }
    const dups = el.getAttribute('stroke-dasharray') || subs.length % 2 ? 1 : 2;
    const parts: BakedNode[] = subs.map((sub, k) => {
      const tmp = p.cloneNode(false) as SVGPathElement;
      tmp.setAttribute('d', sub);
      p.parentNode!.insertBefore(tmp, p);
      const len = r2(tmp.getTotalLength());
      const node: BakedNode = { tag: 'path', attrs: { ...attrs, d: sub }, len, pass: pass.n + Math.floor(k / dups) };
      if (len) samples.set(node, sampleAlong(svg, tmp, len));
      tmp.remove();
      return node;
    });
    pass.n += Math.ceil(subs.length / dups);
    return { tag: 'g', attrs: {}, children: parts };
  }
  const children = Array.from(el.children).map((c) => serialize(svg, c, keepText, samples, pass, myStroke));
  const node: BakedNode = { tag: el.tagName, attrs, ...(children.length ? { children } : {}) };
  if (!children.length && keepText && el.textContent) node.text = el.textContent;
  return node;
}

/** 点从元素自己的坐标换到 SVG 根(viewBox)坐标 */
function toRoot(svg: SVGSVGElement, el: SVGGraphicsElement): (x: number, y: number) => [number, number] {
  const m = svg.getScreenCTM()!.inverse().multiply(el.getScreenCTM()!);
  return (x, y) => {
    const p = new DOMPoint(x, y).matrixTransform(m);
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  };
}

/** 一块区域(SVG 坐标)上橡皮来回走的轨迹:沿长边一趟一趟,至少来回三趟;[x, y, 走到这里是全程的几分之几] */
function zigzag([x0, y0, x1, y1]: readonly [number, number, number, number]): [number, number, number][] {
  const horiz = x1 - x0 >= y1 - y0;
  const [a0, a1, b0, b1] = horiz ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
  const rows = Math.max(3, Math.min(7, Math.ceil((b1 - b0) / 60) + 1));
  const pts: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const b = b0 + ((b1 - b0) * (r + 0.5)) / rows;
    const ends: [number, number][] = [[a0, b], [a1, b]];
    for (const [a, bb] of r % 2 ? ends.reverse() : ends) pts.push(horiz ? [a, bb] : [bb, a]);
  }
  const lens = pts.map((pt, i) => (i ? Math.hypot(pt[0] - pts[i - 1][0], pt[1] - pts[i - 1][1]) : 0));
  const total = lens.reduce((x, y) => x + y, 0);
  let at = 0;
  return pts.map((pt, i) => {
    at += lens[i];
    return [Math.round(pt[0] * 10) / 10, Math.round(pt[1] * 10) / 10, total ? Math.round((at / total) * 10000) / 10000 : 1];
  });
}

type Box = [number, number, number, number];
const union = (bs: readonly Box[]): Box | null => (bs.length ? [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] : null);
const pad = (b: Box, d: number): Box => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
const r1 = (n: number): number => Math.round(n * 10) / 10;

export async function bakeSkeletons(
  skeletons: readonly ChalkSkeleton[],
  options: { background?: ChalkBackground; exportPadding?: number } = {},
): Promise<BakedPicture> {
  // 动作(擦掉、换画板)不交给 excalidraw:只画画的元素,动作按笔顺插回去
  const acts = resolveActions(skeletons, options.background);
  const drawn = skeletons.filter((e) => !isAction(e));
  const exportPadding = options.exportPadding ?? 24;
  const { svg, elements, offset } = await exportStaticSvg(drawn, { exportPadding });
  const fonts = Array.from(svg.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
  const defsEl = svg.querySelector('defs');
  const defs = defsEl ? Array.from(defsEl.children).filter((c) => c.tagName !== 'style').map((c) => c.outerHTML).join('') : '';
  const groups = Array.from(svg.children).filter((n) => n.tagName === 'g' || n.tagName === 'use') as SVGGElement[];
  if (groups.length !== elements.length) throw new Error(`导出的 SVG 有 ${groups.length} 个顶层 <g>,元素 ${elements.length} 个,对不上(excalidraw 导出结构变了)`);
  let viewBox = (svg.getAttribute('viewBox') ?? '0 0 100 100').split(/[\s,]+/).map(Number) as [number, number, number, number];
  const bgOf = (b: ChalkBackground) => ({ src: b.src, x: offset[0], y: offset[1], width: b.width, height: b.height });
  const background = options.background ? bgOf(options.background) : undefined;
  if (background) viewBox = [background.x, background.y, background.width, background.height];

  // 挂进文档才量得了长度与坐标
  svg.style.position = 'absolute';
  svg.style.visibility = 'hidden';
  document.body.appendChild(svg);
  try {
    const boxes = new Map<string, Box>();
    const boxesOf = (ids: readonly string[]): Box[] => ids.map((id) => boxes.get(id)).filter((b): b is Box => !!b);
    const baked: BakedElement[] = elements.map((meta, i) => {
      const g = groups[i];
      const isText = meta.type === 'text';
      const samples: Samples = new Map();
      const node = serialize(svg, g, isText, samples, { n: 0 });
      const track: [number, number, number][] = [];
      if (isText) {
        // 字从左往右露:笔尖沿字的中线走(元素局部坐标 → 根坐标)
        const map = toRoot(svg, g);
        const k = Math.max(2, Math.min(TRACK_MAX_PER_PATH, Math.ceil(meta.width / TRACK_STEP)));
        for (let j = 0; j <= k; j++) track.push([...map((meta.width * j) / k, meta.height * 0.55), j / k]);
      } else {
        // 一拨一拨首尾相接(同 paintElement 的揭示顺序);笔尖走每拨的第一遍
        const paths = bakedPaths(node);
        const groups = strokeGroups(paths);
        const total = groups.reduce((a, x) => a + x.len, 0);
        let at = 0;
        for (const grp of groups) {
          const pts = samples.get(paths[grp.idx[0]].node) ?? [];
          pts.forEach((pt, q) => track.push([...pt, total ? Math.round(((at + (grp.len * q) / Math.max(1, pts.length - 1)) / total) * 10000) / 10000 : 1]));
          at += grp.len;
        }
      }
      const id = drawn[i]?.id ?? meta.id;
      if (acts.boards.length > 1 || acts.targets.size) {
        // 根坐标里的包围盒:擦的范围、每块画板的视口用它
        const bb = g.getBBox();
        const map = toRoot(svg, g);
        const cs = [map(bb.x, bb.y), map(bb.x + bb.width, bb.y), map(bb.x, bb.y + bb.height), map(bb.x + bb.width, bb.y + bb.height)];
        boxes.set(id, [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))]);
      }
      const eraser = (meta.customData as { tool?: unknown } | undefined)?.tool === 'eraser';
      return { id, node, ...(isText ? { reveal: { width: Math.round(meta.width * 10) / 10, height: Math.round(meta.height * 10) / 10 } } : {}), track, ...(eraser ? { eraser: true } : {}) };
    });
    // 换过画板:每块画板自己的视口(有背景图 = 图片;没有 = 这块板上画的东西的包围盒留白);第 0 块也照这样算,顶层的 viewBox / background 就是它
    let boards: BakedBoard[] | undefined;
    if (acts.boards.length > 1) {
      boards = acts.boards.map((b, k) => {
        if (b.background) {
          const bg = bgOf(b.background);
          return { viewBox: [bg.x, bg.y, bg.width, bg.height], background: bg };
        }
        const u = union(boxesOf(drawn.filter((e) => acts.boardOf.get(e.id) === k).map((e) => e.id)));
        const p = u ? pad(u, exportPadding) : null;
        return { viewBox: p ? [r1(p[0]), r1(p[1]), r1(p[2] - p[0]), r1(p[3] - p[1])] : viewBox };
      });
      viewBox = boards[0].viewBox;
    }
    const byId = new Map(baked.map((e) => [e.id, e]));
    const out: BakedElement[] = skeletons.map((e) => {
      if (!isAction(e)) return byId.get(e.id)!;
      // 动作:不画东西;橡皮在要擦的地方来回走(擦除 = 要擦的那几样的包围盒;换画板 = 旧板的整个视口)
      const targets = acts.targets.get(e.id) ?? [];
      const old = boards?.[acts.boardOf.get(e.id) ?? 0]?.viewBox ?? viewBox;
      const area: Box | null = e.type === 'board' ? [old[0], old[1], old[0] + old[2], old[1] + old[3]] : union(boxesOf(targets));
      return { id: e.id, node: { tag: 'g', attrs: {} }, track: area ? zigzag(e.type === 'board' ? area : pad(area, 8)) : [], eraser: true, action: e.type as 'erase' | 'board', targets };
    });
    return {
      schema: 'drawtell-bake',
      version: BAKE_VERSION,
      viewBox,
      offset: [Math.round(offset[0] * 10) / 10, Math.round(offset[1] * 10) / 10],
      fonts,
      defs,
      ...(boards ? (boards[0].background ? { background: boards[0].background } : {}) : background ? { background } : {}),
      ...(boards ? { boards } : {}),
      elements: out,
    };
  } finally {
    document.body.removeChild(svg);
  }
}

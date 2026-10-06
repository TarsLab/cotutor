/**
 * 在浏览器里把一幅场景烤成 bake.json 的画面部分(《重新设计.md》第 4 步;格式与渲染在 core/bake.ts)。
 * excalidraw 只在这里跑一次:静态导出(和播放器原来用的同一个 exportToSvg,画面一模一样),
 * 挂进文档量每条路径的长度、笔尖要走的轨迹;字体是导出时内嵌的那份。drawtell bake 用 playwright 打开播放页的 ?bake= 来调它。
 */

import type { BakedElement, BakedLesson, BakedNode } from '../core/bake.ts';
import { bakedPaths } from '../core/bake.ts';
import { exportStaticSvg } from './excalidraw-io.ts';
import type { ChalkBackground, ChalkSkeleton } from './types.ts';

/** 轨迹上每隔多远取一个点(SVG 坐标),一条路径最多几个 */
const TRACK_STEP = 6;
const TRACK_MAX_PER_PATH = 80;

function serialize(el: Element, keepText: boolean): BakedNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  const children = Array.from(el.children).map((c) => serialize(c, keepText));
  const node: BakedNode = { tag: el.tagName, attrs, ...(children.length ? { children } : {}) };
  if (!children.length && keepText && el.textContent) node.text = el.textContent;
  if (el.tagName === 'path') node.len = Math.round((el as SVGPathElement).getTotalLength() * 100) / 100;
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

export async function bakeSkeletons(
  skeletons: readonly ChalkSkeleton[],
  options: { background?: ChalkBackground; exportPadding?: number } = {},
): Promise<Omit<BakedLesson, 'source'>> {
  const { svg, elements, offset } = await exportStaticSvg(skeletons, { exportPadding: options.exportPadding });
  const fonts = Array.from(svg.querySelectorAll('style')).map((s) => s.textContent ?? '').join('\n');
  const defsEl = svg.querySelector('defs');
  const defs = defsEl ? Array.from(defsEl.children).filter((c) => c.tagName !== 'style').map((c) => c.outerHTML).join('') : '';
  const groups = Array.from(svg.children).filter((n) => n.tagName === 'g' || n.tagName === 'use') as SVGGElement[];
  if (groups.length !== elements.length) throw new Error(`导出的 SVG 有 ${groups.length} 个顶层 <g>,元素 ${elements.length} 个,对不上(excalidraw 导出结构变了)`);
  let viewBox = (svg.getAttribute('viewBox') ?? '0 0 100 100').split(/[\s,]+/).map(Number) as [number, number, number, number];
  const background = options.background ? { src: options.background.src, x: offset[0], y: offset[1], width: options.background.width, height: options.background.height } : undefined;
  if (background) viewBox = [background.x, background.y, background.width, background.height];

  // 挂进文档才量得了长度与坐标
  svg.style.position = 'absolute';
  svg.style.visibility = 'hidden';
  document.body.appendChild(svg);
  try {
    const baked: BakedElement[] = elements.map((meta, i) => {
      const g = groups[i];
      const isText = meta.type === 'text';
      const node = serialize(g, isText);
      const track: [number, number, number][] = [];
      if (isText) {
        // 字从左往右露:笔尖沿字的中线走(元素局部坐标 → 根坐标)
        const map = toRoot(svg, g);
        const k = Math.max(2, Math.min(TRACK_MAX_PER_PATH, Math.ceil(meta.width / TRACK_STEP)));
        for (let j = 0; j <= k; j++) track.push([...map((meta.width * j) / k, meta.height * 0.55), j / k]);
      } else {
        // 有描边的路径(虚线也算)按长度首尾相接(同 paintElement 的揭示顺序)
        const domPaths = Array.from(g.querySelectorAll('path')) as SVGPathElement[];
        const paths = bakedPaths(node);
        const total = paths.reduce((a, x) => a + (x.stroke ? x.node.len! : 0), 0);
        let at = 0;
        paths.forEach((x, j) => {
          if (!x.stroke || !total) return;
          const dom = domPaths[j];
          const map = toRoot(svg, dom);
          const len = x.node.len!;
          const k = Math.max(1, Math.min(TRACK_MAX_PER_PATH, Math.ceil(len / TRACK_STEP)));
          for (let q = 0; q <= k; q++) {
            const pt = dom.getPointAtLength((len * q) / k);
            track.push([...map(pt.x, pt.y), Math.round(((at + (len * q) / k) / total) * 10000) / 10000]);
          }
          at += len;
        });
      }
      const id = skeletons[i]?.id ?? meta.id;
      const eraser = (meta.customData as { tool?: unknown } | undefined)?.tool === 'eraser';
      return { id, node, ...(isText ? { reveal: { width: Math.round(meta.width * 10) / 10, height: Math.round(meta.height * 10) / 10 } } : {}), track, ...(eraser ? { eraser: true } : {}) };
    });
    return { schema: 'drawtell-bake', version: 1, viewBox, offset: [Math.round(offset[0] * 10) / 10, Math.round(offset[1] * 10) / 10], fonts, defs, ...(background ? { background } : {}), elements: baked };
  } finally {
    document.body.removeChild(svg);
  }
}

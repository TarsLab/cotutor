/**
 * excalidraw 的窄接口层:只剩静态导出(bake 用)。深路径类型脆弱,包内一律走这层。
 * 播放不再经过这里(《重新设计.md》第 4 步):画面烤成 bake.json,运行时由 drawtell/render 现画。
 */

import { convertToExcalidrawElements, exportToSvg, getCommonBounds } from '@excalidraw/excalidraw';
import { PAPER_COLOR } from './pointer.ts';
import { seedFromId } from './seed.ts';
import type { ChalkSkeleton } from './types.ts';

/**
 * excalidraw 的文字宽度是在字体未必加载完时用 canvas 量的(场景字体由 Fonts 类
 * 在组件挂载时才注册,纯导出路径拿不到),量偏了,字的揭示框就短于真实字宽
 * (实测"9:20"露成"9:2")。
 * 对策:导出的 SVG 已内嵌 data-URI 字体,隐藏挂进文档、等字体就绪后用
 * getComputedTextLength 量真实宽度回写 element.width——测量与渲染同源(bake 的字宽、裁剪框都靠它)。
 */
async function correctTextWidths<T extends { type: string; width: number }>(
  svg: SVGSVGElement,
  elements: readonly T[],
): Promise<readonly T[]> {
  const gNodes = Array.from(svg.childNodes).filter((n): n is SVGGElement => {
    const tag = (n as Element).tagName;
    return tag === 'g' || tag === 'use';
  });
  // 对不齐说明导出结构变了,不动,让 bake 自己报错
  if (gNodes.length !== elements.length) return elements;
  svg.style.visibility = 'hidden';
  svg.style.position = 'absolute';
  document.body.appendChild(svg);
  try {
    const loads: Promise<unknown>[] = [];
    elements.forEach((el, i) => {
      if (el.type !== 'text') return;
      for (const t of gNodes[i].querySelectorAll('text')) {
        const font = `${t.getAttribute('font-size') || '20px'} ${t.getAttribute('font-family') || 'sans-serif'}`;
        loads.push(document.fonts.load(font, t.textContent || '').catch(() => []));
      }
    });
    await Promise.all(loads);
    await document.fonts.ready;
    return elements.map((el, i) => {
      if (el.type !== 'text') return el;
      let width = 0;
      for (const t of gNodes[i].querySelectorAll('text')) {
        width = Math.max(width, t.getComputedTextLength());
      }
      return width > el.width ? { ...el, width } : el;
    });
  } finally {
    document.body.removeChild(svg);
    svg.style.visibility = '';
    svg.style.position = '';
  }
}

function withStableSeeds(skeletons: readonly ChalkSkeleton[]): readonly ChalkSkeleton[] {
  return skeletons.map((el) => (typeof el.seed === 'number' ? el : { ...el, seed: seedFromId(el.id) }));
}

const isEraser = (el: { customData?: unknown }): boolean => (el.customData as { tool?: unknown } | undefined)?.tool === 'eraser';

/** 橡皮笔画的缺省外观:纸色、不抖(抖了盖不严);作者显式给的值优先 */
function withEraserDefaults(skeletons: readonly ChalkSkeleton[]): readonly ChalkSkeleton[] {
  return skeletons.map((el) => (isEraser(el) ? { strokeColor: PAPER_COLOR, roughness: 0, ...el } : el));
}

/** 静态导出的结果:SVG(没有动画)、量过字宽的元素(和 SVG 顶层的 <g> 一一对应)、场景坐标 → SVG 坐标的平移 */
export interface StaticScene {
  svg: SVGSVGElement;
  elements: readonly { id: string; type: string; width: number; height: number; customData?: unknown }[];
  offset: [number, number];
}

/** skeleton → 元素 → 静态 SVG(字宽在浏览器里量过、回写后重导) */
export async function exportStaticSvg(skeletons: readonly ChalkSkeleton[], options: { exportPadding?: number } = {}): Promise<StaticScene> {
  const prepared = withStableSeeds(withEraserDefaults(skeletons));
  // regenerateIds: false —— id 是与 manifest 的对齐键
  const elements = convertToExcalidrawElements(
    prepared as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  );
  const exportPadding = options.exportPadding ?? 24;
  const exportOpts = { appState: { exportBackground: false, exportWithDarkMode: false }, files: null, exportPadding };
  let svg = await exportToSvg({ ...exportOpts, elements });
  const corrected = await correctTextWidths(svg, elements);
  // 量宽回写后若有文本变宽,用校正后的元素重导一次:viewBox 才会把真实字宽算进去,
  // 否则最右侧的长文本(尤其中文)会被画面边缘裁掉(第一批真题 palou / zuohua 踩中)
  if (corrected.some((el, i) => el !== elements[i])) {
    svg = await exportToSvg({ ...exportOpts, elements: corrected as unknown as typeof elements });
  }
  const [minX, minY] = getCommonBounds(corrected as unknown as Parameters<typeof getCommonBounds>[0]);
  return { svg, elements: corrected as unknown as StaticScene['elements'], offset: [exportPadding - minX, exportPadding - minY] };
}

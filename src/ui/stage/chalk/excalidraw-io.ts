/**
 * excalidraw / excalidraw-animate 的窄接口层。
 * 与 kid-canvas/excalidraw-api.ts 同一纪律:深路径类型脆弱,包内一律走这层。
 */

import { convertToExcalidrawElements, exportToSvg, getCommonBounds } from '@excalidraw/excalidraw';
import { animateSvg } from 'excalidraw-animate';
import { ERASER_POINTER_IMG, PAPER_COLOR } from './pointer.ts';
import type { ChalkSkeleton } from './types.ts';

export interface AnimatedScene {
  svg: SVGSVGElement;
  finishedMs: number;
}

export interface BuildOptions {
  pointerImg?: string;
  pointerWidth?: string;
  exportPadding?: number;
  /** 背景图:href 是已解析好的 URL;画板(viewBox)收成图片矩形,场景坐标 = 图片像素 */
  background?: { href: string; width: number; height: number };
}

/**
 * excalidraw 的文字宽度是在字体未必加载完时用 canvas 量的(场景字体由 Fonts 类
 * 在组件挂载时才注册,纯导出路径拿不到),量偏就会让 animateSvg 的 textPath
 * 揭示路径短于真实字宽,尾字形被 SVG 规则丢弃(实测"9:20"变"9:2")。
 * 对策:导出的 SVG 已内嵌 data-URI 字体,隐藏挂进文档、等字体就绪后用
 * getComputedTextLength 量真实宽度回写 element.width——测量与渲染同源。
 */
async function correctTextWidths<T extends { type: string; width: number }>(
  svg: SVGSVGElement,
  elements: readonly T[],
): Promise<readonly T[]> {
  const gNodes = Array.from(svg.childNodes).filter((n): n is SVGGElement => {
    const tag = (n as Element).tagName;
    return tag === 'g' || tag === 'use';
  });
  // 对不齐说明导出结构变了,不动,让 animateSvg 自己抛错
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

/** 创作层 animateDuration 字段 → excalidraw-animate 的 id 约定(0.7.2 只认 id 中的
 *  `animateDuration:N`),这个 hack 隔离在本层,创作面与课包 JSON 保持干净字段 */
function withDurationIds(skeletons: readonly ChalkSkeleton[]): readonly ChalkSkeleton[] {
  return skeletons.map((el) =>
    el.animateDuration == null
      ? el
      : { ...el, animateDuration: undefined, id: `${el.id}-animateDuration:${el.animateDuration}` },
  );
}

/** 无 seed 的元素按 id 派生一个稳定 seed(FNV-1a):手绘抖动不再每次渲染重新随机,
 *  snap 帧间可 diff、播放可复现;作者显式给了 seed 则尊重 */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 2147483647) + 1;
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

/** skeleton → 元素 → 静态 SVG(字宽在浏览器里量过、回写后重导)。withDurations = 把时长注进 id(只有 excalidraw-animate 要) */
export async function exportStaticSvg(skeletons: readonly ChalkSkeleton[], options: { exportPadding?: number; withDurations?: boolean } = {}): Promise<StaticScene> {
  const prepared = withStableSeeds(withEraserDefaults(skeletons));
  // regenerateIds: false —— id 是与 manifest 的对齐键
  const elements = convertToExcalidrawElements(
    (options.withDurations ? withDurationIds(prepared) : prepared) as unknown as Parameters<typeof convertToExcalidrawElements>[0],
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

/** skeleton → 元素 → 静态 SVG → 原地打上 SMIL 逐笔动画(含笔尖跟随),返回时暂停在 0 */
export async function buildAnimatedSvg(
  skeletons: readonly ChalkSkeleton[],
  options: BuildOptions = {},
): Promise<AnimatedScene> {
  const exportOpts = { exportPadding: options.exportPadding ?? 24 };
  const { svg, elements: corrected, offset } = await exportStaticSvg(skeletons, { ...exportOpts, withDurations: true });
  const { finishedMs } = animateSvg(
    svg,
    corrected as unknown as Parameters<typeof animateSvg>[1],
    { pointerImg: options.pointerImg, pointerWidth: options.pointerWidth },
  );
  if (options.pointerImg) {
    // animateSvg 给每一笔各挂一个笔尖 <image>(在该元素的 <g> 里):橡皮笔画的换成橡皮
    const gNodes = Array.from(svg.childNodes).filter((n) => ['g', 'use'].includes((n as Element).tagName)) as Element[];
    if (gNodes.length === corrected.length) {
      corrected.forEach((el, i) => {
        if (!isEraser(el as { customData?: unknown })) return;
        for (const img of gNodes[i].querySelectorAll('image')) {
          if (img.getAttribute('href') !== options.pointerImg) continue;
          img.setAttribute('href', ERASER_POINTER_IMG);
          img.setAttribute('width', '36');
          img.setAttribute('x', '-5');
          img.setAttribute('y', '-5');
        }
      });
    }
  }
  if (options.background) {
    // 导出时元素整体平移了 (padding − minX, padding − minY);图片按同一偏移垫到最底层,
    // 放在 animateSvg 之后——它按子节点与元素一一对齐,先插会错位
    const { href, width, height } = options.background;
    const [ox, oy] = offset;
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', href);
    img.setAttribute('x', String(ox));
    img.setAttribute('y', String(oy));
    img.setAttribute('width', String(width));
    img.setAttribute('height', String(height));
    img.setAttribute('preserveAspectRatio', 'none');
    const firstDrawn = Array.from(svg.childNodes).find((n) => ['g', 'use'].includes((n as Element).tagName)) ?? null;
    svg.insertBefore(img, firstDrawn);
    svg.setAttribute('viewBox', `${ox} ${oy} ${width} ${height}`);
  }
  svg.pauseAnimations();
  svg.setCurrentTime(0);
  return { svg, finishedMs };
}

/**
 * excalidraw / excalidraw-animate 的窄接口层。
 * 与 kid-canvas/excalidraw-api.ts 同一纪律:深路径类型脆弱,包内一律走这层。
 */

import { convertToExcalidrawElements, exportToSvg } from '@excalidraw/excalidraw';
import { animateSvg } from 'excalidraw-animate';
import type { ChalkSkeleton } from './types';

export interface AnimatedScene {
  svg: SVGSVGElement;
  finishedMs: number;
}

export interface BuildOptions {
  pointerImg?: string;
  pointerWidth?: string;
  exportPadding?: number;
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

/** skeleton → 元素 → 静态 SVG → 原地打上 SMIL 逐笔动画(含笔尖跟随),返回时暂停在 0 */
export async function buildAnimatedSvg(
  skeletons: readonly ChalkSkeleton[],
  options: BuildOptions = {},
): Promise<AnimatedScene> {
  // regenerateIds: false —— id 是与 manifest 的对齐键(时长指令已在上面注入)
  const elements = convertToExcalidrawElements(
    withDurationIds(skeletons) as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  );
  const svg = await exportToSvg({
    elements,
    appState: { exportBackground: false, exportWithDarkMode: false },
    files: null,
    exportPadding: options.exportPadding ?? 24,
  });
  const corrected = await correctTextWidths(svg, elements);
  const { finishedMs } = animateSvg(
    svg,
    corrected as unknown as Parameters<typeof animateSvg>[1],
    { pointerImg: options.pointerImg, pointerWidth: options.pointerWidth },
  );
  svg.pauseAnimations();
  svg.setCurrentTime(0);
  return { svg, finishedMs };
}
